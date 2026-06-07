import { describe, expect, it } from "vitest";
import { mcpRunConfig, mcpServerName, renderMcpServersToml } from "../src/mcp";

describe("codex mcpRunConfig branches", () => {
  it("pypi -> uvx", () => {
    expect(mcpRunConfig({ packages: [{ registryType: "pypi", identifier: "p" }] })).toEqual({
      command: "uvx",
      args: ["p"],
    });
  });
  it("oci -> docker", () => {
    expect(mcpRunConfig({ packages: [{ registryType: "oci", identifier: "img" }] })).toEqual({
      command: "docker",
      args: ["run", "-i", "--rm", "img"],
    });
  });
  it("remote -> url only (no transport key)", () => {
    expect(mcpRunConfig({ remotes: [{ url: "https://x" }] })).toEqual({ url: "https://x" });
  });
  it("bare command passthrough", () => {
    expect(mcpRunConfig({ command: "node", args: ["s"], env: { X: "1" } })).toEqual({
      command: "node",
      args: ["s"],
      env: { X: "1" },
    });
  });
  it("fallback when no runnable transport", () => {
    expect(mcpRunConfig({})).toEqual({
      command: "echo",
      args: ["server.json declares no runnable transport"],
    });
  });
  it("server name fallback", () => {
    expect(mcpServerName({})).toBe("server");
  });
});

describe("codex TOML rendering", () => {
  it("renders [mcp_servers.<name>] with args and a nested env table", () => {
    const toml = renderMcpServersToml({
      weather: { command: "npx", args: ["-y", "@a/b"], env: { KEY: "v" } },
    });
    expect(toml).toContain("[mcp_servers.weather]");
    expect(toml).toContain('command = "npx"');
    expect(toml).toContain('args = ["-y", "@a/b"]');
    expect(toml).toContain("[mcp_servers.weather.env]");
    expect(toml).toContain('KEY = "v"');
  });
  it("renders a url server and escapes quotes/backslashes", () => {
    expect(renderMcpServersToml({ s: { url: 'https://x/"q"' } })).toContain(
      'url = "https://x/\\"q\\""',
    );
  });
  it("returns empty string for no servers", () => {
    expect(renderMcpServersToml({})).toBe("");
  });
});
