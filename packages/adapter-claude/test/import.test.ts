import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importClaude } from "../src/import";

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "loom-claude-import-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function write(path: string, contents: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

describe("importClaude plugin", () => {
  it("imports components and reconstructs server.json from each mcp run config", () => {
    const dir = join(tmp, "plugin");
    write(
      join(dir, ".claude-plugin/plugin.json"),
      JSON.stringify({
        name: "p",
        version: "1.2.0",
        description: "d",
        author: { name: "A", email: "a@b.c" },
        mcpServers: {
          npmsrv: { command: "npx", args: ["-y", "@a/b@2.0.0"] },
          remote: { type: "sse", url: "https://x/mcp" },
          bare: { command: "node", args: ["s.js"], env: { K: "v" } },
        },
      }),
    );
    write(join(dir, "skills/greet/SKILL.md"), "---\nname: greet\ndescription: hi\n---\nbody");
    write(join(dir, "agents/helper.md"), "agent");
    write(join(dir, "commands/do.md"), "cmd");

    const res = importClaude(dir, { namespace: "com.test" });
    if (res?.kind !== "plugin") throw new Error("expected a plugin import");
    expect(res.plugin.owner.namespace).toBe("com.test");
    expect(res.plugin.owner.email).toBe("a@b.c");
    expect(res.plugin.version).toBe("1.2.0");

    const file = (rel: string) => res.files.find((f) => f.relPath === rel);
    expect(file("skills/greet/SKILL.md")).toBeDefined();
    expect(file("agents/helper.md")).toBeDefined();
    expect(file("commands/do.md")).toBeDefined();

    const npm = JSON.parse(String(file("mcp/npmsrv/server.json")?.contents));
    expect(npm.packages[0]).toMatchObject({
      registryType: "npm",
      identifier: "@a/b",
      version: "2.0.0",
    });
    const remote = JSON.parse(String(file("mcp/remote/server.json")?.contents));
    expect(remote.remotes[0]).toMatchObject({ type: "sse", url: "https://x/mcp" });
    const bare = JSON.parse(String(file("mcp/bare/server.json")?.contents));
    expect(bare).toMatchObject({ command: "node", args: ["s.js"], env: { K: "v" } });
  });

  it("imports a bare plugin layout with no manifest", () => {
    const dir = join(tmp, "bare");
    write(join(dir, "skills/x/SKILL.md"), "---\nname: x\ndescription: y\n---\nb");
    const res = importClaude(dir);
    if (res?.kind !== "plugin") throw new Error("expected a plugin import");
    expect(res.plugin.name).toBe("imported-plugin");
  });

  it("returns null when the directory is not a Claude plugin", () => {
    const dir = join(tmp, "empty");
    mkdirSync(dir, { recursive: true });
    expect(importClaude(dir)).toBeNull();
  });
});

describe("importClaude marketplace", () => {
  it("maps every Claude source form to a Loom source string", () => {
    const dir = join(tmp, "mkt");
    write(
      join(dir, ".claude-plugin/marketplace.json"),
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
    const res = importClaude(dir, { namespace: "com.test" });
    if (res?.kind !== "marketplace") throw new Error("expected a marketplace import");
    expect(res.marketplace.owner.namespace).toBe("com.test");
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
