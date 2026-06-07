/**
 * Derives a runnable Copilot `mcpServers` entry from an MCP-standard `server.json`
 * (the registry's ServerJSON shape: packages[] / remotes[] / a bare command).
 * Stored standards stay verbatim in the plugin; this is the tool-specific view.
 *
 * Copilot's per-server shape (verified, research §Copilot): `type` is one of
 * `local|stdio|http|sse`; `command`+`args`+`env` for local/stdio; `url`+`headers`
 * for http/sse; `tools` is `"*"` or an explicit list.
 */

export interface McpServerConfig {
  type: "local" | "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  tools?: string[] | "*";
}

interface McpPackage {
  registryType?: string;
  identifier?: string;
  version?: string;
  transport?: { type?: string };
}
interface McpRemote {
  type?: string;
  url?: string;
  headers?: Array<{ name: string; value: string }>;
}
interface ServerJson {
  name?: string;
  packages?: McpPackage[];
  remotes?: McpRemote[];
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/** The short server key Copilot uses (the part after the reverse-DNS namespace). */
export function mcpServerName(server: ServerJson): string {
  const raw = server.name ?? "server";
  const afterSlash = raw.includes("/") ? raw.slice(raw.lastIndexOf("/") + 1) : raw;
  return afterSlash || "server";
}

const RUNNERS: Record<string, string> = { npm: "npx", pypi: "uvx" };

export function mcpRunConfig(server: ServerJson): McpServerConfig {
  const pkg = server.packages?.[0];
  if (pkg?.identifier) {
    if (pkg.registryType === "oci") {
      return {
        type: "local",
        command: "docker",
        args: ["run", "-i", "--rm", pkg.identifier],
        tools: ["*"],
      };
    }
    const runner = RUNNERS[pkg.registryType ?? "npm"] ?? "npx";
    const ident = pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier;
    const args = runner === "npx" ? ["-y", ident] : [ident];
    return { type: "local", command: runner, args, tools: ["*"] };
  }

  const remote = server.remotes?.[0];
  if (remote?.url) {
    // Copilot uses http|sse for remote transports; the MCP registry's
    // "streamable-http" maps to "http".
    const type = remote.type === "sse" ? "sse" : "http";
    const config: McpServerConfig = { type, url: remote.url, tools: ["*"] };
    if (remote.headers?.length) {
      config.headers = Object.fromEntries(remote.headers.map((h) => [h.name, h.value]));
    }
    return config;
  }

  if (server.command) {
    const config: McpServerConfig = { type: "local", command: server.command, tools: ["*"] };
    if (server.args) config.args = server.args;
    if (server.env) config.env = server.env;
    return config;
  }

  return {
    type: "local",
    command: "echo",
    args: ["server.json declares no runnable transport"],
    tools: ["*"],
  };
}
