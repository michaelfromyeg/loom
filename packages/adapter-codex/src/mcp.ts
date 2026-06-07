/**
 * Derives a runnable Codex MCP server config from an MCP-standard `server.json`
 * (the registry's ServerJSON shape: packages[] / remotes[] / a bare command) and
 * renders it as a `config.toml` fragment under `[mcp_servers.<name>]`.
 *
 * Codex infers the transport from the keys present (`command` => stdio, `url` =>
 * http); there is NO `transport` key (harness-research.md, Codex MCP section).
 * Stored standards stay verbatim in the plugin; this is the tool-specific view.
 */

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
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

/** The short server key Codex uses (the part after the reverse-DNS namespace). */
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
      return { command: "docker", args: ["run", "-i", "--rm", pkg.identifier] };
    }
    const runner = RUNNERS[pkg.registryType ?? "npm"] ?? "npx";
    const ident = pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier;
    const args = runner === "npx" ? ["-y", ident] : [ident];
    return { command: runner, args };
  }

  const remote = server.remotes?.[0];
  if (remote?.url) {
    // Codex http servers carry only `url` here; headers/bearer-token live under
    // documented sub-keys we don't synthesize without provenance.
    return { url: remote.url };
  }

  if (server.command) {
    const config: McpServerConfig = { command: server.command };
    if (server.args) config.args = server.args;
    if (server.env) config.env = server.env;
    return config;
  }

  return { command: "echo", args: ["server.json declares no runnable transport"] };
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

/**
 * Render the `[mcp_servers.<name>]` tables for a set of servers as a single
 * `config.toml` fragment. `env` becomes a nested `[mcp_servers.<name>.env]`
 * table; transport is implied by `command` vs `url`.
 */
export function renderMcpServersToml(servers: Record<string, McpServerConfig>): string {
  const blocks: string[] = [];
  for (const [name, config] of Object.entries(servers)) {
    const lines = [`[mcp_servers.${name}]`];
    if (config.command !== undefined) lines.push(`command = ${tomlString(config.command)}`);
    if (config.args !== undefined) lines.push(`args = ${tomlArray(config.args)}`);
    if (config.url !== undefined) lines.push(`url = ${tomlString(config.url)}`);
    if (config.env && Object.keys(config.env).length > 0) {
      lines.push("");
      lines.push(`[mcp_servers.${name}.env]`);
      for (const [key, val] of Object.entries(config.env)) {
        lines.push(`${key} = ${tomlString(val)}`);
      }
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.length > 0 ? `${blocks.join("\n\n")}\n` : "";
}
