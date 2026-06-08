import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import claudeAdapter from "@michaelfromyeg/loom-adapter-claude";
import { Plugin } from "@michaelfromyeg/loom-schema";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdapterRegistry,
  install,
  loadPluginDir,
  resolveConfig,
  resolveDependencies,
  resolvePluginRefFull,
  update,
} from "../src/index";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/sample-plugin", import.meta.url));
const registry = () => new AdapterRegistry().register(claudeAdapter);

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "loom-p1t-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function writeConsumer(dir: string, depends: string): string {
  cpSync(FIXTURE, dir, { recursive: true });
  writeFileSync(
    join(dir, "loom.yaml"),
    `name: consumer\nversion: 1.0.0\nowner: { name: A, namespace: com.consumer }\ncomponents: []\ndepends:\n${depends}\n`,
  );
  return dir;
}

describe("secrets (declare-not-store, spec §11)", () => {
  it("resolves declared config to a gitignored local file, never leaking values", () => {
    const plugin = Plugin.parse({
      name: "p",
      version: "1.0.0",
      owner: { name: "A", namespace: "com.a" },
      components: [
        {
          mcp: "mcp/x",
          config: [
            { env: "API_KEY", secret: true },
            { env: "REGION", default: "us" },
          ],
        },
      ],
    });
    const cwd = mkdtempSync(join(tmp, "secrets-"));
    const res = resolveConfig(plugin, cwd, { API_KEY: "xyz" });

    expect(res.resolved).toEqual([
      { env: "API_KEY", source: "env", secret: true },
      { env: "REGION", source: "default", secret: false },
    ]);
    // The summary contains no secret values.
    expect(JSON.stringify(res.resolved)).not.toContain("xyz");

    const values = JSON.parse(readFileSync(join(cwd, ".loom/secrets.local.json"), "utf8"));
    expect(values).toEqual({ API_KEY: "xyz", REGION: "us" });
    expect(readFileSync(join(cwd, ".loom/.gitignore"), "utf8")).toContain("*");
  });
});

describe("dependency resolution (spec §9.1 step 2)", () => {
  it("vendors a local dependency's components into the merged tree", async () => {
    const consumer = writeConsumer(join(tmp, "dep-all"), `  - plugin: ${FIXTURE}`);
    const fb = loadPluginDir(consumer);
    if (!fb.ok) throw new Error("load failed");
    const { fb: merged, dependencies } = await resolveDependencies(fb.value);

    expect(merged.plugin.components).toHaveLength(2);
    expect(existsSync(join(merged.root, "_deps/sample-plugin/skills/code-review/SKILL.md"))).toBe(
      true,
    );
    expect(dependencies[0].id).toBe("com.acme/sample-plugin");
  });

  it("honors piecemeal `components:` selection", async () => {
    const consumer = writeConsumer(
      join(tmp, "dep-piece"),
      `  - plugin: ${FIXTURE}\n    components: [code-review]`,
    );
    const fb = loadPluginDir(consumer);
    if (!fb.ok) throw new Error("load failed");
    const { fb: merged } = await resolveDependencies(fb.value);
    expect(merged.plugin.components).toHaveLength(1);
  });

  it("detects a dependency cycle", async () => {
    const self = writeConsumer(join(tmp, "dep-cycle"), `  - plugin: ${join(tmp, "dep-cycle")}`);
    // Make the dep id equal the consumer id to force a cycle.
    writeFileSync(
      join(self, "loom.yaml"),
      `name: consumer\nversion: 1.0.0\nowner: { name: A, namespace: com.consumer }\ncomponents: []\ndepends:\n  - plugin: ${self}\n`,
    );
    const fb = loadPluginDir(self);
    if (!fb.ok) throw new Error("load failed");
    await expect(resolveDependencies(fb.value)).rejects.toThrow(/cycle/);
  });
});

describe("remote resolution (git clone)", () => {
  it("clones a file:// git repo and pins a SHA", async () => {
    const repo = mkdtempSync(join(tmp, "repo-"));
    cpSync(FIXTURE, repo, { recursive: true });
    await execa("git", ["init", "-q"], { cwd: repo });
    await execa("git", ["add", "-A"], { cwd: repo });
    // Inline identity so the test does not depend on a global git config (CI has none).
    await execa(
      "git",
      ["-c", "user.email=ci@loom.test", "-c", "user.name=loom", "commit", "-q", "-m", "init"],
      { cwd: repo },
    );

    const resolved = await resolvePluginRefFull(`file://${repo}`, tmp);
    expect(resolved.fb.plugin.name).toBe("sample-plugin");
    expect(resolved.sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("update (content-addressed re-place)", () => {
  it("re-places only artifacts whose hash changed", async () => {
    const pluginDir = mkdtempSync(join(tmp, "upd-plugin-"));
    cpSync(FIXTURE, pluginDir, { recursive: true });
    const sandbox = mkdtempSync(join(tmp, "upd-sandbox-"));

    await install({
      pluginDir,
      scope: "project",
      cwd: sandbox,
      registry: registry(),
      now: "2026-01-01T00:00:00.000Z",
    });

    // Nothing changed -> update is a no-op.
    const noop = await update({
      pluginDir,
      scope: "project",
      cwd: sandbox,
      registry: registry(),
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(noop.changed).toHaveLength(0);

    // Edit a source file -> exactly that artifact is re-placed.
    writeFileSync(
      join(pluginDir, "skills/code-review/SKILL.md"),
      "---\nname: code-review\ndescription: Updated description for the review skill.\n---\nNew body.\n",
    );
    const changed = await update({
      pluginDir,
      scope: "project",
      cwd: sandbox,
      registry: registry(),
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(changed.changed.length).toBeGreaterThanOrEqual(1);
    expect(changed.changed.some((p) => p.endsWith("SKILL.md"))).toBe(true);
  });
});
