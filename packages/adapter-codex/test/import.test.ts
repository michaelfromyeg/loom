import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AdapterRegistry, build, importNativePlugin, lint } from "@michaelfromyeg/loom-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importCodex } from "../src/import";
import codexAdapter from "../src/index";

const PLUGIN = fileURLToPath(new URL("../../../fixtures/sample-plugin", import.meta.url));

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "loom-codex-import-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function write(path: string, contents: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

describe("importCodex round-trip", () => {
  it("re-imports a Loom-built Codex plugin into a valid Loom plugin", async () => {
    // Loom -> Codex plugin (verbatim mcp/<leaf>/server.json + skill sidecars).
    const built = join(tmp, "built");
    await build({
      pluginDir: PLUGIN,
      outDir: built,
      registry: new AdapterRegistry().register(codexAdapter),
      targets: ["codex"],
    });
    const builtPlugin = join(built, "codex/plugins/sample-plugin");

    const res = importCodex(builtPlugin, { namespace: "com.acme" });
    if (res?.kind !== "plugin") throw new Error("expected a plugin import");
    expect(res.plugin.owner.namespace).toBe("com.acme");
    expect(res.plugin.name).toBe("sample-plugin");
    // The verbatim server.json is reused, NOT reconstructed from config.toml.
    expect(res.files.find((f) => f.relPath === "mcp/weather/server.json")).toBeDefined();

    // Write the imported plugin to disk and lint it; both components survive.
    const loomOut = join(tmp, "imported");
    importNativePlugin({
      dir: builtPlugin,
      adapter: codexAdapter,
      outDir: loomOut,
      namespace: "com.acme",
    });
    expect(existsSync(join(loomOut, "loom.yaml"))).toBe(true);
    const linted = lint(loomOut);
    expect(linted.diagnostics.hasErrors).toBe(false);
    expect(linted.id).toBe("com.acme/sample-plugin");
    expect(Object.keys(linted.aliases).sort()).toEqual(["code-review", "weather"]);
  });
});

describe("importCodex plugin (synthetic)", () => {
  it("imports skills + toml agents and reconstructs server.json from each config.toml variant", () => {
    const dir = join(tmp, "plugin");
    write(
      join(dir, "plugin.json"),
      JSON.stringify({
        name: "p",
        version: "1.2.0",
        description: "d",
        author: { name: "A", email: "a@b.c" },
      }),
    );
    write(join(dir, "skills/greet/SKILL.md"), "---\nname: greet\ndescription: hi\n---\nbody");
    // The per-skill sidecar must be carried verbatim but never treated as an agent.
    write(join(dir, "skills/greet/agents/openai.yaml"), "interface:\n  display_name: greet\n");
    write(join(dir, "agents/helper.toml"), 'name = "helper"\ndescription = "h"\n');
    // No mcp/ dir => reconstruct from config.toml, covering every server variant.
    write(
      join(dir, "config.toml"),
      [
        "# a leading comment is skipped",
        "[other.section]",
        'ignored = "value"',
        "",
        "[mcp_servers.npmsrv]",
        'command = "npx"',
        'args = ["-y", "@a/b@2.0.0"]',
        "",
        "[mcp_servers.remote]",
        'url = "https://x/mcp"',
        "",
        "[mcp_servers.bare]",
        'command = "node"',
        'args = ["s.js"]',
        "",
        "[mcp_servers.bare.env]",
        'K = "v"',
        "",
      ].join("\n"),
    );

    const res = importCodex(dir, { namespace: "com.test" });
    if (res?.kind !== "plugin") throw new Error("expected a plugin import");
    expect(res.plugin.owner.namespace).toBe("com.test");
    expect(res.plugin.owner.email).toBe("a@b.c");
    expect(res.plugin.version).toBe("1.2.0");

    const file = (rel: string) => res.files.find((f) => f.relPath === rel);
    expect(file("skills/greet/SKILL.md")).toBeDefined();
    expect(file("skills/greet/agents/openai.yaml")).toBeDefined();
    expect(file("agents/helper.toml")).toBeDefined();
    // The sidecar is a skill asset, not an agent component.
    expect(res.plugin.components).toContainEqual({ agent: "agents/helper.toml" });
    expect(res.plugin.components).not.toContainEqual({ agent: "skills/greet/agents/openai.yaml" });

    const npm = JSON.parse(String(file("mcp/npmsrv/server.json")?.contents));
    expect(npm.packages[0]).toMatchObject({
      registryType: "npm",
      identifier: "@a/b",
      version: "2.0.0",
    });
    const remote = JSON.parse(String(file("mcp/remote/server.json")?.contents));
    expect(remote.remotes[0]).toMatchObject({ type: "streamable-http", url: "https://x/mcp" });
    const bare = JSON.parse(String(file("mcp/bare/server.json")?.contents));
    expect(bare).toMatchObject({ command: "node", args: ["s.js"], env: { K: "v" } });
  });

  it("prefers verbatim mcp/<leaf>/server.json over config.toml when present", () => {
    const dir = join(tmp, "verbatim");
    write(join(dir, "skills/x/SKILL.md"), "---\nname: x\ndescription: y\n---\nb");
    write(
      join(dir, "mcp/weather/server.json"),
      JSON.stringify({ name: "com.x/weather", version: "1.0.0", packages: [] }),
    );
    // A config.toml is also present, but the verbatim copy wins.
    write(join(dir, "config.toml"), '[mcp_servers.weather]\ncommand = "should-not-run"\n');

    const res = importCodex(dir, { namespace: "com.test" });
    if (res?.kind !== "plugin") throw new Error("expected a plugin import");
    const server = JSON.parse(
      String(res.files.find((f) => f.relPath === "mcp/weather/server.json")?.contents),
    );
    expect(server.name).toBe("com.x/weather");
  });

  it("imports a bare plugin layout with no plugin.json, naming from the directory", () => {
    const dir = join(tmp, "bare-named");
    write(join(dir, "skills/x/SKILL.md"), "---\nname: x\ndescription: y\n---\nb");
    const res = importCodex(dir);
    if (res?.kind !== "plugin") throw new Error("expected a plugin import");
    expect(res.plugin.name).toBe("bare-named");
    expect(res.plugin.owner.namespace).toBe("com.imported");
  });

  it("returns null when the directory is not a Codex plugin", () => {
    const dir = join(tmp, "empty");
    mkdirSync(dir, { recursive: true });
    expect(importCodex(dir)).toBeNull();
  });
});

describe("importCodex marketplace", () => {
  it("maps every loom-marketplace source form to a Loom source string", () => {
    const dir = join(tmp, "mkt");
    write(
      join(dir, "loom-marketplace.json"),
      JSON.stringify({
        name: "m",
        owner: { name: "O", email: "o@x" },
        description: "md",
        plugins: [
          { name: "a", source: "./plugins/a", version: "1.0.0", category: "c", tags: ["t"] },
          { name: "b", source: { source: "github", repo: "o/b", ref: "v1" } },
          { name: "c", source: { source: "url", url: "https://g/c.git" } },
          { name: "d", source: { source: "npm", package: "pkg", version: "1.0.0" } },
          { name: "e", source: { source: "mystery", id: "z" } },
        ],
      }),
    );
    const res = importCodex(dir, { namespace: "com.test" });
    if (res?.kind !== "marketplace") throw new Error("expected a marketplace import");
    expect(res.marketplace.owner.namespace).toBe("com.test");
    expect(res.marketplace.plugins.map((p) => p.plugin)).toEqual([
      "./plugins/a",
      "github:o/b#v1",
      "https://g/c.git",
      "npm:pkg@1.0.0",
      "[object Object]",
    ]);
    expect(res.marketplace.plugins[0]).toMatchObject({
      version: "1.0.0",
      category: "c",
      tags: ["t"],
    });
  });
});
