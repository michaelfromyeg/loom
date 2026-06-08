import type { PluginCtx } from "@michaelfromyeg/loom-adapter-kit";
import type { Component, Plugin } from "@michaelfromyeg/loom-schema";
import { describe, expect, it } from "vitest";
import opencodeAdapter from "../src/index";
import { mcpRunConfig, mcpServerName } from "../src/mcp";

const SERVER_JSON = JSON.stringify({
  name: "com.acme/weather",
  description: "Weather server.",
  version: "1.0.0",
  packages: [{ registryType: "npm", identifier: "@acme/weather-mcp", version: "1.0.0" }],
});

const files: Record<string, string> = {
  "skills/code-review/SKILL.md": "---\nname: code-review\ndescription: Review code.\n---\nBody.",
  "skills/code-review/reference.md": "extra asset",
  "agents/reviewer.md": "---\nname: reviewer\n---\nReview things.",
  "commands/ship.md": "---\nname: ship\n---\nShip it.",
  "mcp/weather/server.json": SERVER_JSON,
  "plugins/notify.ts": "export default async () => {};",
};

const plugin: Plugin = {
  name: "sample-plugin",
  version: "0.1.0",
  owner: { name: "Acme", namespace: "com.acme", email: "a@acme.example" },
  description: "Sample.",
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

describe("opencode mcp run config derivation", () => {
  it("maps an npm package to a local command array (npx)", () => {
    expect(mcpRunConfig(JSON.parse(SERVER_JSON))).toEqual({
      type: "local",
      command: ["npx", "-y", "@acme/weather-mcp@1.0.0"],
      enabled: true,
    });
  });

  it("maps a remote server to a remote url config", () => {
    expect(mcpRunConfig({ remotes: [{ type: "sse", url: "https://x/mcp" }] })).toEqual({
      type: "remote",
      url: "https://x/mcp",
      enabled: true,
    });
  });

  it("maps a bare command to a local command array with environment key", () => {
    expect(
      mcpRunConfig({ command: "my-server", args: ["--port", "1"], env: { TOKEN: "x" } }),
    ).toEqual({
      type: "local",
      command: ["my-server", "--port", "1"],
      environment: { TOKEN: "x" },
      enabled: true,
    });
  });

  it("shortens the reverse-DNS server name", () => {
    expect(mcpServerName({ name: "com.acme/weather" })).toBe("weather");
  });
});

describe("opencode adapter detect", () => {
  it("uses XDG config root for user scope with plural subdirs", () => {
    const paths = opencodeAdapter.detect("user", "/proj");
    expect(paths.root.endsWith("/.config/opencode")).toBe(true);
    expect(paths.skills.endsWith("/.config/opencode/skills")).toBe(true);
    expect(paths.agents.endsWith("/.config/opencode/agents")).toBe(true);
    expect(paths.commands.endsWith("/.config/opencode/commands")).toBe(true);
    // mcp/catalog both resolve to the config root (opencode.json lives there).
    expect(paths.mcp).toBe(paths.root);
    expect(paths.catalog).toBe(paths.root);
    // hooks share the plugins dir (executable plugins).
    expect(paths.hooks).toBe(paths.plugins);
  });

  it("uses .opencode under cwd for project scope", () => {
    const paths = opencodeAdapter.detect("project", "/proj");
    expect(paths.root).toBe("/proj/.opencode");
    expect(paths.plugins).toBe("/proj/.opencode/plugins");
  });
});

describe("opencode adapter transform", () => {
  it("copies a skill directory verbatim under skills/<leaf>/", () => {
    const arts = opencodeAdapter.transform({ skill: "skills/code-review" } as Component, ctx);
    const paths = arts.map((a) => a.relPath).sort();
    expect(paths).toEqual(["skills/code-review/SKILL.md", "skills/code-review/reference.md"]);
    expect(arts.every((a) => a.kind === "skill")).toBe(true);
  });

  it("places an agent file at agents/<leaf>.md", () => {
    const arts = opencodeAdapter.transform({ agent: "agents/reviewer.md" } as Component, ctx);
    expect(arts).toHaveLength(1);
    expect(arts[0].relPath).toBe("agents/reviewer.md");
    expect(arts[0].kind).toBe("agent");
  });

  it("places a command file at commands/<leaf>.md", () => {
    const arts = opencodeAdapter.transform({ command: "commands/ship.md" } as Component, ctx);
    expect(arts).toHaveLength(1);
    expect(arts[0].relPath).toBe("commands/ship.md");
    expect(arts[0].kind).toBe("command");
  });

  it("copies an mcp directory verbatim under mcp/<leaf>/", () => {
    const arts = opencodeAdapter.transform({ mcp: "mcp/weather" } as Component, ctx);
    expect(arts.map((a) => a.relPath)).toEqual(["mcp/weather/server.json"]);
    expect(arts[0].kind).toBe("mcp");
  });

  it("places a passthrough plugin under plugins/, disabled (executable)", () => {
    const arts = opencodeAdapter.transform(
      { passthrough: "plugins/notify.ts", target: "opencode", kind: "plugin" } as Component,
      ctx,
    );
    expect(arts).toHaveLength(1);
    expect(arts[0].relPath).toBe("plugins/notify.ts");
    expect(arts[0].executable).toBe(true);
  });
});

describe("opencode adapter emitManifest", () => {
  it("emits opencode.json with an aggregated mcp block (local command array)", () => {
    const arts = opencodeAdapter.emitManifest(plugin, ctx);
    expect(arts).toHaveLength(1);
    expect(arts[0].relPath).toBe("opencode.json");
    const manifest = JSON.parse(arts[0].contents.toString());
    expect(manifest.mcp.weather).toEqual({
      type: "local",
      command: ["npx", "-y", "@acme/weather-mcp@1.0.0"],
      enabled: true,
    });
  });

  it("returns [] when there are no mcp components", () => {
    const noMcp: Plugin = { ...plugin, components: [{ skill: "skills/code-review" }] };
    expect(opencodeAdapter.emitManifest(noMcp, ctx)).toEqual([]);
  });
});

describe("opencode adapter emitCatalog", () => {
  it("emits a Loom-only loom-marketplace.json index", () => {
    const arts = opencodeAdapter.emitCatalog({
      name: "sample-plugin",
      owner: plugin.owner,
      description: "Sample.",
      entries: [
        { name: "sample-plugin", source: "./plugins/sample-plugin", version: "0.1.0" },
        { name: "other", source: "plugins/other", description: "Another." },
      ],
    });
    expect(arts).toHaveLength(1);
    expect(arts[0].relPath).toBe("loom-marketplace.json");
    expect(arts[0].kind).toBe("catalog");
    const catalog = JSON.parse(arts[0].contents.toString());
    expect(catalog.plugins).toHaveLength(2);
    expect(catalog.plugins[0]).toMatchObject({
      name: "sample-plugin",
      source: "./plugins/sample-plugin",
      version: "0.1.0",
    });
    // bare sources are normalized to a "./"-relative form.
    expect(catalog.plugins[1].source).toBe("./plugins/other");
  });
});
