import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AdapterRegistry, build, importNativePlugin, lint } from "@loom/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importOpencode } from "../src/import";
import opencodeAdapter from "../src/index";

const PLUGIN = fileURLToPath(new URL("../../../fixtures/sample-plugin", import.meta.url));

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "loom-opencode-import-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function write(path: string, contents: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

describe("importOpencode round-trip", () => {
  it("rebuilds a valid Loom plugin from an OpenCode build output", async () => {
    const built = join(tmp, "built");
    await build({
      pluginDir: PLUGIN,
      outDir: built,
      registry: new AdapterRegistry().register(opencodeAdapter),
      targets: ["opencode"],
    });
    const builtPluginDir = join(built, "opencode/plugins/sample-plugin");

    const res = importOpencode(builtPluginDir, { namespace: "com.acme" });
    if (res?.kind !== "plugin") throw new Error("expected a plugin import");
    expect(res.plugin.name).toBe("sample-plugin");
    expect(res.plugin.owner.namespace).toBe("com.acme");
    // The verbatim mcp/weather/server.json was reused, not reconstructed.
    expect(res.files.find((f) => f.relPath === "mcp/weather/server.json")).toBeDefined();

    const loomOut = join(tmp, "imported");
    const out = importNativePlugin({
      dir: builtPluginDir,
      adapter: opencodeAdapter,
      outDir: loomOut,
      namespace: "com.acme",
    });
    expect(out.kind).toBe("plugin");
    expect(existsSync(join(loomOut, "loom.yaml"))).toBe(true);
    expect(existsSync(join(loomOut, "mcp/weather/server.json"))).toBe(true);

    const linted = lint(loomOut);
    expect(linted.diagnostics.hasErrors).toBe(false);
    expect(linted.id).toBe("com.acme/sample-plugin");
    expect(Object.keys(linted.aliases).sort()).toEqual(["code-review", "weather"]);
  });
});

describe("importOpencode plugin (synthetic dirs)", () => {
  it("imports skills + agents + commands and reconstructs server.json for each mcp variant", () => {
    const dir = join(tmp, "synthetic");
    write(join(dir, "skills/greet/SKILL.md"), "---\nname: greet\ndescription: hi\n---\nbody");
    write(join(dir, "agents/helper.md"), "agent");
    write(join(dir, "commands/do.md"), "cmd");
    write(
      join(dir, "opencode.json"),
      JSON.stringify({
        mcp: {
          npmsrv: { type: "local", command: ["npx", "-y", "@a/b@2.0.0"], enabled: true },
          remote: {
            type: "remote",
            url: "https://x/mcp",
            headers: { Authorization: "Bearer t" },
            enabled: true,
          },
          bare: {
            type: "local",
            command: ["node", "s.js"],
            environment: { K: "v" },
            enabled: true,
          },
        },
      }),
    );

    const res = importOpencode(dir, { namespace: "com.test" });
    if (res?.kind !== "plugin") throw new Error("expected a plugin import");
    expect(res.plugin.name).toBe("synthetic");
    expect(res.plugin.owner.namespace).toBe("com.test");

    const file = (rel: string) => res.files.find((f) => f.relPath === rel);
    expect(file("skills/greet/SKILL.md")).toBeDefined();
    expect(file("agents/helper.md")).toBeDefined();
    expect(file("commands/do.md")).toBeDefined();
    expect(res.plugin.components).toEqual([
      { skill: "skills/greet" },
      { agent: "agents/helper.md" },
      { command: "commands/do.md" },
      { mcp: "mcp/npmsrv" },
      { mcp: "mcp/remote" },
      { mcp: "mcp/bare" },
    ]);

    const npm = JSON.parse(String(file("mcp/npmsrv/server.json")?.contents));
    expect(npm.packages[0]).toMatchObject({
      registryType: "npm",
      identifier: "@a/b",
      version: "2.0.0",
    });
    const remote = JSON.parse(String(file("mcp/remote/server.json")?.contents));
    expect(remote.remotes[0]).toMatchObject({
      type: "streamable-http",
      url: "https://x/mcp",
      headers: [{ name: "Authorization", value: "Bearer t" }],
    });
    const bare = JSON.parse(String(file("mcp/bare/server.json")?.contents));
    expect(bare).toMatchObject({ command: "node", args: ["s.js"], env: { K: "v" } });
  });

  it("prefers a verbatim mcp/<leaf>/server.json over reconstruction", () => {
    const dir = join(tmp, "verbatim");
    write(join(dir, "skills/x/SKILL.md"), "---\nname: x\ndescription: y\n---\nb");
    write(
      join(dir, "mcp/weather/server.json"),
      JSON.stringify({ name: "com.acme/weather", version: "1.0.0", packages: [] }),
    );
    // An opencode.json mcp block that should be IGNORED because the verbatim copy wins.
    write(
      join(dir, "opencode.json"),
      JSON.stringify({ mcp: { other: { type: "local", command: ["foo"], enabled: true } } }),
    );

    const res = importOpencode(dir, { namespace: "com.acme" });
    if (res?.kind !== "plugin") throw new Error("expected a plugin import");
    expect(res.plugin.components).toContainEqual({ mcp: "mcp/weather" });
    expect(res.plugin.components).not.toContainEqual({ mcp: "mcp/other" });
    const wx = JSON.parse(
      String(res.files.find((f) => f.relPath === "mcp/weather/server.json")?.contents),
    );
    expect(wx.name).toBe("com.acme/weather");
  });

  it("uses the opencode.json name when present, else the directory basename", () => {
    const named = join(tmp, "named-dir");
    write(join(named, "opencode.json"), JSON.stringify({ name: "custom", mcp: {} }));
    const res = importOpencode(named, { namespace: "com.test" });
    if (res?.kind !== "plugin") throw new Error("expected a plugin import");
    expect(res.plugin.name).toBe("custom");
  });

  it("returns null for a directory with no plugin or marketplace", () => {
    const empty = join(tmp, "empty");
    mkdirSync(empty, { recursive: true });
    expect(importOpencode(empty)).toBeNull();
  });
});

describe("importOpencode marketplace", () => {
  it("maps every source form to a Loom source string", () => {
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
        ],
      }),
    );
    const res = importOpencode(dir, { namespace: "com.test" });
    if (res?.kind !== "marketplace") throw new Error("expected a marketplace import");
    expect(res.marketplace.owner.namespace).toBe("com.test");
    expect(res.marketplace.owner.email).toBe("o@x");
    expect(res.marketplace.plugins.map((p) => p.plugin)).toEqual([
      "./plugins/a",
      "github:o/b#v1",
      "https://g/c.git",
      "npm:pkg@1.0.0",
    ]);
    expect(res.marketplace.plugins[0]).toMatchObject({
      version: "1.0.0",
      category: "c",
      tags: ["t"],
    });
  });
});
