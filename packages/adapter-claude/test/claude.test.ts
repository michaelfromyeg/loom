import type { PluginCtx } from "@michaelfromyeg/loom-adapter-kit";
import type { Component, Plugin } from "@michaelfromyeg/loom-schema";
import { describe, expect, it } from "vitest";
import claudeAdapter from "../src/index";
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
  "mcp/weather/server.json": SERVER_JSON,
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

describe("mcp run config derivation", () => {
  it("maps an npm package to npx", () => {
    expect(mcpRunConfig(JSON.parse(SERVER_JSON))).toEqual({
      command: "npx",
      args: ["-y", "@acme/weather-mcp@1.0.0"],
    });
  });

  it("maps a remote server to a url config", () => {
    expect(mcpRunConfig({ remotes: [{ type: "sse", url: "https://x/mcp" }] })).toEqual({
      type: "sse",
      url: "https://x/mcp",
    });
  });

  it("shortens the reverse-DNS server name", () => {
    expect(mcpServerName({ name: "com.acme/weather" })).toBe("weather");
  });
});

describe("claude adapter transform", () => {
  it("copies a skill directory verbatim under skills/<leaf>/", () => {
    const arts = claudeAdapter.transform({ skill: "skills/code-review" } as Component, ctx);
    const paths = arts.map((a) => a.relPath).sort();
    expect(paths).toEqual(["skills/code-review/SKILL.md", "skills/code-review/reference.md"]);
    expect(arts.every((a) => a.kind === "skill")).toBe(true);
  });

  it("emits plugin.json with inline mcpServers aggregated from all mcp components", () => {
    const arts = claudeAdapter.emitManifest(plugin, ctx);
    expect(arts).toHaveLength(1);
    const manifest = JSON.parse(arts[0].contents.toString());
    expect(manifest.name).toBe("sample-plugin");
    expect(manifest.author).toEqual({ name: "Acme", email: "a@acme.example" });
    expect(manifest.mcpServers.weather).toEqual({
      command: "npx",
      args: ["-y", "@acme/weather-mcp@1.0.0"],
    });
  });

  it("emits a marketplace catalog with a relative plugin source", () => {
    const arts = claudeAdapter.emitCatalog({
      name: "sample-plugin",
      owner: plugin.owner,
      description: "Sample.",
      entries: [
        { name: "sample-plugin", source: "./plugins/sample-plugin", version: "0.1.0" },
        { name: "other", source: "./plugins/other", description: "Another." },
      ],
    });
    const catalog = JSON.parse(arts[0].contents.toString());
    expect(catalog.plugins).toHaveLength(2);
    expect(catalog.plugins[0]).toMatchObject({
      name: "sample-plugin",
      source: "./plugins/sample-plugin",
      version: "0.1.0",
    });
  });
});
