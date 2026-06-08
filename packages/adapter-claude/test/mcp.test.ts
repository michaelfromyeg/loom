import { describe, expect, it } from "vitest";
import { mcpRunConfig, mcpServerName } from "../src/mcp";

describe("mcpServerName", () => {
  it("strips the reverse-DNS namespace to the part after the last slash", () => {
    expect(mcpServerName({ name: "com.acme/weather" })).toBe("weather");
  });

  it("returns a plain name unchanged when there is no slash", () => {
    expect(mcpServerName({ name: "plain" })).toBe("plain");
  });

  it("falls back to 'server' when name is missing", () => {
    expect(mcpServerName({})).toBe("server");
  });
});

describe("mcpRunConfig", () => {
  it("runs an npm package via npx with a pinned version", () => {
    expect(
      mcpRunConfig({ packages: [{ registryType: "npm", identifier: "@a/b", version: "1.0.0" }] }),
    ).toEqual({ command: "npx", args: ["-y", "@a/b@1.0.0"] });
  });

  it("runs an npm package via npx without a version", () => {
    expect(mcpRunConfig({ packages: [{ registryType: "npm", identifier: "@a/b" }] })).toEqual({
      command: "npx",
      args: ["-y", "@a/b"],
    });
  });

  it("runs a pypi package via uvx", () => {
    expect(mcpRunConfig({ packages: [{ registryType: "pypi", identifier: "mypkg" }] })).toEqual({
      command: "uvx",
      args: ["mypkg"],
    });
  });

  it("runs an oci image via docker", () => {
    expect(mcpRunConfig({ packages: [{ registryType: "oci", identifier: "img:tag" }] })).toEqual({
      command: "docker",
      args: ["run", "-i", "--rm", "img:tag"],
    });
  });

  it("passes through a remote transport", () => {
    expect(mcpRunConfig({ remotes: [{ type: "sse", url: "https://x/mcp" }] })).toEqual({
      type: "sse",
      url: "https://x/mcp",
    });
  });

  it("maps the MCP standard streamable-http transport to Claude's http", () => {
    expect(mcpRunConfig({ remotes: [{ type: "streamable-http", url: "https://x/mcp" }] })).toEqual({
      type: "http",
      url: "https://x/mcp",
    });
  });

  it("defaults a remote with no declared type to http", () => {
    expect(mcpRunConfig({ remotes: [{ url: "https://x/mcp" }] })).toEqual({
      type: "http",
      url: "https://x/mcp",
    });
  });

  it("maps remote headers into a record", () => {
    expect(
      mcpRunConfig({
        remotes: [
          {
            type: "sse",
            url: "https://x/mcp",
            headers: [{ name: "Authorization", value: "Bearer k" }],
          },
        ],
      }),
    ).toEqual({
      type: "sse",
      url: "https://x/mcp",
      headers: { Authorization: "Bearer k" },
    });
  });

  it("passes a bare command/args/env through", () => {
    expect(mcpRunConfig({ command: "node", args: ["s.js"], env: { A: "b" } })).toEqual({
      command: "node",
      args: ["s.js"],
      env: { A: "b" },
    });
  });

  it("falls back to echo when nothing runnable is declared", () => {
    expect(mcpRunConfig({})).toEqual({
      command: "echo",
      args: ["server.json declares no runnable transport"],
    });
  });
});
