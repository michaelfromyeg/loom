import { describe, expect, it } from "vitest";
import { mcpRunConfig, mcpServerName } from "../src/mcp";

describe("opencode mcpRunConfig branches", () => {
  it("npm -> npx command array", () => {
    expect(
      mcpRunConfig({ packages: [{ registryType: "npm", identifier: "@a/b", version: "1.0.0" }] }),
    ).toEqual({ type: "local", command: ["npx", "-y", "@a/b@1.0.0"], enabled: true });
  });
  it("pypi -> uvx command array", () => {
    expect(mcpRunConfig({ packages: [{ registryType: "pypi", identifier: "p" }] })).toEqual({
      type: "local",
      command: ["uvx", "p"],
      enabled: true,
    });
  });
  it("oci -> docker command array", () => {
    expect(mcpRunConfig({ packages: [{ registryType: "oci", identifier: "img" }] })).toEqual({
      type: "local",
      command: ["docker", "run", "-i", "--rm", "img"],
      enabled: true,
    });
  });
  it("remote with and without headers (note env key is on local, headers on remote)", () => {
    expect(
      mcpRunConfig({ remotes: [{ url: "https://x", headers: [{ name: "A", value: "b" }] }] }),
    ).toEqual({ type: "remote", url: "https://x", enabled: true, headers: { A: "b" } });
    expect(mcpRunConfig({ remotes: [{ url: "https://x" }] })).toEqual({
      type: "remote",
      url: "https://x",
      enabled: true,
    });
  });
  it("bare command -> local with `environment` (not `env`)", () => {
    expect(mcpRunConfig({ command: "node", args: ["s"], env: { X: "1" } })).toEqual({
      type: "local",
      command: ["node", "s"],
      environment: { X: "1" },
      enabled: true,
    });
  });
  it("fallback when no runnable transport", () => {
    expect(mcpRunConfig({})).toEqual({
      type: "local",
      command: ["echo", "server.json declares no runnable transport"],
      enabled: true,
    });
  });
  it("server name fallback", () => {
    expect(mcpServerName({})).toBe("server");
  });
});
