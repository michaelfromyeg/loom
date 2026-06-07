/**
 * Derives a runnable Claude `mcpServers` entry from an MCP-standard `server.json`
 * (the registry's ServerJSON shape: packages[] / remotes[] / a bare command).
 * Stored standards stay verbatim in the plugin; this is the tool-specific view.
 */

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
  url?: string;
  headers?: Record<string, string>;
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

/** The short server key Claude uses (the part after the reverse-DNS namespace). */
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
    const config: McpServerConfig = { type: remote.type ?? "http", url: remote.url };
    if (remote.headers?.length) {
      config.headers = Object.fromEntries(remote.headers.map((h) => [h.name, h.value]));
    }
    return config;
  }

  if (server.command) {
    const config: McpServerConfig = { command: server.command };
    if (server.args) config.args = server.args;
    if (server.env) config.env = server.env;
    return config;
  }

  return { command: "echo", args: ["server.json declares no runnable transport"] };
}
