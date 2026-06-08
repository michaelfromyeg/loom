import { homedir } from "node:os";
import { join } from "node:path";
import type { Component, Plugin } from "@michaelfromyeg/weft-schema";
import { describe, expect, it } from "vitest";
import type { PluginCtx } from "../src/adapter";
import { genericSkillsAdapter } from "../src/generic";

const files: Record<string, string> = {
  "skills/code-review/SKILL.md": "---\nname: code-review\ndescription: Review code.\n---\nBody.",
  "skills/code-review/ref.md": "extra asset",
};

const plugin: Plugin = {
  name: "sample",
  version: "1.0.0",
  owner: { name: "Acme", namespace: "com.acme" },
  components: [{ skill: "skills/code-review" }, { mcp: "mcp/weather" }],
};

const ctx: PluginCtx = {
  plugin,
  read: (p) => Buffer.from(files[p] ?? "", "utf8"),
  list: (dir) =>
    Object.keys(files)
      .filter((f) => f.startsWith(`${dir}/`))
      .sort(),
  aliasFor: (id) => id,
};

const zed = genericSkillsAdapter({
  target: "zed",
  projectRoot: ".agents",
  globalRoot: "~/.agents",
});

describe("genericSkillsAdapter", () => {
  it("is flat and resolves the .agents/skills convention per scope", () => {
    expect(zed.flat).toBe(true);
    const project = zed.detect("project", "/work");
    expect(project.plugins).toBe("/work/.agents");
    expect(project.skills).toBe("/work/.agents/skills");
    const user = zed.detect("user", "/work");
    expect(user.skills).toBe(join(homedir(), ".agents", "skills"));
  });

  it("compiles a skill flatly to skills/<leaf>/, copying every file", () => {
    const arts = zed.transform({ skill: "skills/code-review" } as Component, ctx);
    expect(arts.map((a) => a.relPath).sort()).toEqual([
      "skills/code-review/SKILL.md",
      "skills/code-review/ref.md",
    ]);
    expect(arts[0].kind).toBe("skill");
  });

  it("emits nothing for non-skill kinds, manifests, or catalogs (skills-only)", () => {
    expect(zed.transform({ mcp: "mcp/weather" } as Component, ctx)).toEqual([]);
    expect(zed.emitManifest(plugin, ctx)).toEqual([]);
    expect(zed.emitCatalog({ name: "m", owner: plugin.owner, entries: [] })).toEqual([]);
  });
});
