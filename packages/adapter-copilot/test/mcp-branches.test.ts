import { describe, expect, it } from "vitest";
import { mcpRunConfig, mcpServerName } from "../src/mcp";

describe("copilot mcpRunConfig branches", () => {
  it("pypi -> uvx (type local, tools *)", () => {
    expect(mcpRunConfig({ packages: [{ registryType: "pypi", identifier: "p" }] })).toEqual({
      type: "local",
      command: "uvx",
      args: ["p"],
      tools: ["*"],
    });
  });
  it("oci -> docker", () => {
    expect(mcpRunConfig({ packages: [{ registryType: "oci", identifier: "img" }] })).toEqual({
      type: "local",
      command: "docker",
      args: ["run", "-i", "--rm", "img"],
      tools: ["*"],
    });
  });
  it("remote maps sse->sse and others->http, with headers", () => {
    expect(mcpRunConfig({ remotes: [{ type: "sse", url: "https://x" }] })).toEqual({
      type: "sse",
      url: "https://x",
      tools: ["*"],
    });
    expect(
      mcpRunConfig({ remotes: [{ url: "https://x", headers: [{ name: "A", value: "b" }] }] }),
    ).toEqual({ type: "http", url: "https://x", tools: ["*"], headers: { A: "b" } });
  });
  it("bare command passthrough", () => {
    expect(mcpRunConfig({ command: "node", args: ["s"], env: { X: "1" } })).toEqual({
      type: "local",
      command: "node",
      args: ["s"],
      env: { X: "1" },
      tools: ["*"],
    });
  });
  it("fallback when no runnable transport", () => {
    expect(mcpRunConfig({})).toEqual({
      type: "local",
      command: "echo",
      args: ["server.json declares no runnable transport"],
      tools: ["*"],
    });
  });
  it("server name fallback", () => {
    expect(mcpServerName({})).toBe("server");
  });
});
