import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginCtx } from "@michaelfromyeg/loom-adapter-kit";
import type { Component, Plugin } from "@michaelfromyeg/loom-schema";
import { describe, expect, it } from "vitest";
import codexAdapter from "../src/index";
import { mcpRunConfig, mcpServerName, renderMcpServersToml } from "../src/mcp";

const SERVER_JSON = JSON.stringify({
  name: "com.acme/weather",
  description: "Weather server.",
  version: "1.0.0",
  packages: [{ registryType: "npm", identifier: "@acme/weather-mcp", version: "1.0.0" }],
});

const files: Record<string, string> = {
  "skills/code-review/SKILL.md": "---\nname: code-review\ndescription: Review code.\n---\nBody.",
  "skills/code-review/reference.md": "extra asset",
  "agents/triage.md": "---\nname: triage\ndescription: Triage issues.\n---\nDo the triage.",
  "mcp/weather/server.json": SERVER_JSON,
};

const plugin: Plugin = {
  name: "sample-plugin",
  version: "0.1.0",
  owner: { name: "Acme", namespace: "com.acme", email: "a@acme.example" },
  description: "Sample.",
  components: [
    { skill: "skills/code-review" },
    { agent: "agents/triage.md" },
    { mcp: "mcp/weather" },
  ],
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

  it("maps a remote server to a url-only config (no transport key)", () => {
    expect(mcpRunConfig({ remotes: [{ type: "sse", url: "https://x/mcp" }] })).toEqual({
      url: "https://x/mcp",
    });
  });

  it("shortens the reverse-DNS server name", () => {
    expect(mcpServerName({ name: "com.acme/weather" })).toBe("weather");
  });

  it("renders an [mcp_servers.<name>] table with args array", () => {
    const toml = renderMcpServersToml({
      weather: { command: "npx", args: ["-y", "@acme/weather-mcp@1.0.0"] },
    });
    expect(toml).toContain("[mcp_servers.weather]");
    expect(toml).toContain('command = "npx"');
    expect(toml).toContain('args = ["-y", "@acme/weather-mcp@1.0.0"]');
    expect(toml).not.toContain("transport");
  });

  it("renders env as a nested [mcp_servers.<name>.env] table", () => {
    const toml = renderMcpServersToml({
      svc: { command: "run", env: { TOKEN: "abc" } },
    });
    expect(toml).toContain("[mcp_servers.svc.env]");
    expect(toml).toContain('TOKEN = "abc"');
  });
});

describe("codex adapter detect", () => {
  it("places skills on the shared .agents/skills path for user scope", () => {
    const paths = codexAdapter.detect("user", "/proj");
    expect(paths.root).toBe(join(homedir(), ".codex"));
    expect(paths.skills).toBe(join(homedir(), ".agents", "skills"));
    expect(paths.mcp).toBe(join(homedir(), ".codex"));
  });

  it("places skills on the project .agents/skills path for project scope", () => {
    const paths = codexAdapter.detect("project", "/proj");
    expect(paths.root).toBe(join("/proj", ".codex"));
    expect(paths.skills).toBe(join("/proj", ".agents", "skills"));
  });
});

describe("codex adapter transform", () => {
  it("copies a skill dir verbatim and adds an openai.yaml sidecar", () => {
    const arts = codexAdapter.transform({ skill: "skills/code-review" } as Component, ctx);
    const paths = arts.map((a) => a.relPath).sort();
    expect(paths).toEqual([
      "skills/code-review/SKILL.md",
      "skills/code-review/agents/openai.yaml",
      "skills/code-review/reference.md",
    ]);
    const sidecar = arts
      .find((a) => a.relPath === "skills/code-review/agents/openai.yaml")
      ?.contents.toString();
    expect(sidecar).toContain('display_name: "code-review"');
    expect(sidecar).toContain('short_description: "Review code."');
    expect(sidecar).toContain("allow_implicit_invocation: true");
    expect(sidecar).toContain("tools: []");
  });

  it("renders a subagent as agents/<leaf>.toml", () => {
    const arts = codexAdapter.transform({ agent: "agents/triage.md" } as Component, ctx);
    expect(arts).toHaveLength(1);
    expect(arts[0].relPath).toBe("agents/triage.toml");
    expect(arts[0].kind).toBe("agent");
    const toml = arts[0].contents.toString();
    expect(toml).toContain('name = "triage"');
    expect(toml).toContain('description = "Triage issues."');
    expect(toml).toContain("developer_instructions = ");
    expect(toml).toContain("Do the triage.");
  });

  it("copies an mcp dir verbatim under mcp/<leaf>/", () => {
    const arts = codexAdapter.transform({ mcp: "mcp/weather" } as Component, ctx);
    expect(arts.map((a) => a.relPath)).toEqual(["mcp/weather/server.json"]);
    expect(arts[0].kind).toBe("mcp");
  });
});

describe("codex adapter emitManifest", () => {
  it("emits a config.toml fragment with [mcp_servers.<name>] and a plugin.json", () => {
    const arts = codexAdapter.emitManifest(plugin, ctx);
    const configToml = arts.find((a) => a.relPath === "config.toml");
    expect(configToml).toBeDefined();
    const toml = configToml?.contents.toString() ?? "";
    expect(toml).toContain("[mcp_servers.weather]");
    expect(toml).toContain('command = "npx"');
    expect(toml).toContain('args = ["-y", "@acme/weather-mcp@1.0.0"]');

    const pluginJson = arts.find((a) => a.relPath === "plugin.json");
    expect(pluginJson).toBeDefined();
    const manifest = JSON.parse(pluginJson?.contents.toString() ?? "{}");
    expect(manifest).toMatchObject({
      name: "sample-plugin",
      version: "0.1.0",
      description: "Sample.",
    });
  });

  it("omits config.toml when there are no mcp components", () => {
    const noMcp: Plugin = { ...plugin, components: [{ skill: "skills/code-review" }] };
    const arts = codexAdapter.emitManifest(noMcp, ctx);
    expect(arts.find((a) => a.relPath === "config.toml")).toBeUndefined();
    expect(arts.find((a) => a.relPath === "plugin.json")).toBeDefined();
  });
});

describe("codex adapter emitCatalog", () => {
  it("emits a best-effort loom-marketplace.json index", () => {
    const arts = codexAdapter.emitCatalog({
      name: "sample-plugin",
      owner: plugin.owner,
      description: "Sample.",
      entries: [
        { name: "sample-plugin", source: "plugins/sample-plugin", version: "0.1.0" },
        { name: "other", source: "./plugins/other", description: "Another." },
      ],
    });
    expect(arts).toHaveLength(1);
    expect(arts[0].relPath).toBe("loom-marketplace.json");
    expect(arts[0].kind).toBe("catalog");
    const catalog = JSON.parse(arts[0].contents.toString());
    expect(catalog.owner).toEqual({ name: "Acme", email: "a@acme.example" });
    expect(catalog.plugins).toHaveLength(2);
    expect(catalog.plugins[0]).toMatchObject({
      name: "sample-plugin",
      source: "./plugins/sample-plugin",
      version: "0.1.0",
    });
    expect(catalog.plugins[1].source).toBe("./plugins/other");
  });
});
