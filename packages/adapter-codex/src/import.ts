import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  artifact,
  type CompiledArtifact,
  type ImportedMarketplace,
  type ImportedPlugin,
  type ImportOptions,
  type ImportResult,
} from "@loom/adapter-kit";
import type { Component, Marketplace, Plugin } from "@loom/schema";

const MCP_SCHEMA = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
const json = (o: unknown): string => `${JSON.stringify(o, null, 2)}\n`;

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Subdirectories of `dir` that contain `marker`. */
function subdirsWith(dir: string, marker: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((n) => statSync(join(dir, n)).isDirectory() && existsSync(join(dir, n, marker)))
    .sort();
}

function filesWithExt(dir: string, ext: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(ext) && statSync(join(dir, n)).isFile())
    .sort();
}

function copyTree(
  srcDir: string,
  destPrefix: string,
  kind: CompiledArtifact["kind"],
): CompiledArtifact[] {
  const out: CompiledArtifact[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const abs = join(d, n);
      if (statSync(abs).isDirectory()) walk(abs);
      else
        out.push(artifact(`${destPrefix}/${relative(srcDir, abs)}`, readFileSync(abs), { kind }));
    }
  };
  walk(srcDir);
  return out;
}

/** A Loom source string from a Codex `loom-marketplace.json` entry `source`. */
function sourceToString(source: unknown): string {
  if (typeof source === "string") return source;
  const s = source as Record<string, unknown>;
  switch (s?.source) {
    case "github":
      return `github:${s.repo}${s.ref ? `#${s.ref}` : ""}`;
    case "url":
    case "git-subdir":
      return String(s.url);
    case "npm":
      return `npm:${s.package}${s.version ? `@${s.version}` : ""}`;
    default:
      return String(source);
  }
}

interface McpServerCfg {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
  url?: string;
}

/** Reconstruct an MCP-standard server.json from a Codex run config (lossy but functional). */
function synthesizeServerJson(namespace: string, name: string, cfg: McpServerCfg): unknown {
  const base = {
    $schema: MCP_SCHEMA,
    name: `${namespace}/${name}`,
    description: `Imported ${name} MCP server.`,
    version: "0.0.0",
  };
  if (cfg.url) return { ...base, remotes: [{ type: cfg.type ?? "streamable-http", url: cfg.url }] };
  if (cfg.command === "npx" && Array.isArray(cfg.args)) {
    const ident = cfg.args.find((a) => a !== "-y" && !a.startsWith("-"));
    if (ident) {
      const at = ident.lastIndexOf("@");
      const id = at > 0 ? ident.slice(0, at) : ident;
      const version = at > 0 ? ident.slice(at + 1) : undefined;
      return {
        ...base,
        packages: [
          {
            registryType: "npm",
            identifier: id,
            ...(version ? { version } : {}),
            transport: { type: "stdio" },
          },
        ],
      };
    }
  }
  return {
    ...base,
    ...(cfg.command ? { command: cfg.command } : {}),
    ...(cfg.args ? { args: cfg.args } : {}),
    ...(cfg.env ? { env: cfg.env } : {}),
  };
}

/**
 * Parse the `[mcp_servers.<name>]` tables from a Codex `config.toml` fragment.
 * This is a deliberately small, hand-rolled parser for the subset our adapter
 * emits: `command = ".."`, `args = ["..", ..]`, `url = ".."`, and a nested
 * `[mcp_servers.<name>.env]` table of `KEY = ".."` string pairs.
 * TODO(verify): full Codex config.toml grammar (cwd, bearer_token_env_var,
 * http_headers, enabled_tools, etc.) is not parsed; verbatim mcp/ is preferred.
 */
function parseMcpServersToml(toml: string): Record<string, McpServerCfg> {
  const servers: Record<string, McpServerCfg> = {};
  let current: McpServerCfg | null = null;
  let envOf: McpServerCfg | null = null;

  const unquote = (v: string): string =>
    v
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  const parseArray = (v: string): string[] => {
    const inner = v.trim().replace(/^\[(.*)\]$/s, "$1");
    const matches = inner.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
    return matches.map((m) => unquote(m));
  };

  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const envHeader = line.match(/^\[mcp_servers\.([^.\]]+)\.env\]$/);
    if (envHeader) {
      const name = envHeader[1];
      servers[name] ??= {};
      const server = servers[name];
      server.env ??= {};
      envOf = server;
      current = null;
      continue;
    }
    const serverHeader = line.match(/^\[mcp_servers\.([^.\]]+)\]$/);
    if (serverHeader) {
      const name = serverHeader[1];
      servers[name] ??= {};
      current = servers[name];
      envOf = null;
      continue;
    }
    if (line.startsWith("[")) {
      current = null;
      envOf = null;
      continue;
    }

    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    if (envOf) {
      envOf.env ??= {};
      envOf.env[key] = unquote(value);
      continue;
    }
    if (!current) continue;
    if (key === "command") current.command = unquote(value);
    else if (key === "url") current.url = unquote(value);
    else if (key === "args") current.args = parseArray(value);
  }
  return servers;
}

function importPlugin(
  dir: string,
  manifest: Record<string, unknown> | null,
  name: string,
  namespace: string,
): ImportedPlugin {
  const components: Component[] = [];
  const files: CompiledArtifact[] = [];

  // Skills: each skills/<name> dir with a SKILL.md. The per-skill
  // agents/openai.yaml sidecar inside is harness metadata, not a component; it
  // is carried along verbatim as a skill asset but never wired as an agent.
  for (const sk of subdirsWith(join(dir, "skills"), "SKILL.md")) {
    components.push({ skill: `skills/${sk}` });
    files.push(...copyTree(join(dir, "skills", sk), `skills/${sk}`, "skill"));
  }
  // Codex subagents are TOML files at agents/<file>.toml.
  for (const f of filesWithExt(join(dir, "agents"), ".toml")) {
    components.push({ agent: `agents/${f}` });
    files.push(artifact(`agents/${f}`, readFileSync(join(dir, "agents", f)), { kind: "agent" }));
  }

  // MCP: prefer the verbatim server.json copies a Loom build leaves under mcp/.
  // Only when there is no mcp/ dir do we reconstruct from the config.toml tables.
  const mcpDir = join(dir, "mcp");
  if (existsSync(mcpDir) && statSync(mcpDir).isDirectory()) {
    for (const leaf of subdirsWith(mcpDir, "server.json")) {
      components.push({ mcp: `mcp/${leaf}` });
      files.push(
        artifact(`mcp/${leaf}/server.json`, readFileSync(join(mcpDir, leaf, "server.json")), {
          kind: "mcp",
        }),
      );
    }
  } else if (existsSync(join(dir, "config.toml"))) {
    const servers = parseMcpServersToml(readFileSync(join(dir, "config.toml"), "utf8"));
    for (const [serverName, cfg] of Object.entries(servers)) {
      components.push({ mcp: `mcp/${serverName}` });
      files.push(
        artifact(
          `mcp/${serverName}/server.json`,
          json(synthesizeServerJson(namespace, serverName, cfg)),
          { kind: "mcp" },
        ),
      );
    }
  }

  const author = manifest?.author as { name?: string; email?: string } | undefined;
  const plugin: Plugin = {
    name,
    version: String(manifest?.version ?? "0.1.0"),
    owner: {
      name: author?.name ?? name,
      namespace,
      ...(author?.email ? { email: author.email } : {}),
    },
    ...(manifest?.description ? { description: String(manifest.description) } : {}),
    components,
  };
  return { kind: "plugin", plugin, files };
}

function importMarketplace(
  manifest: Record<string, unknown>,
  namespace: string,
): ImportedMarketplace {
  const owner = manifest.owner as { name?: string; email?: string } | undefined;
  const plugins = ((manifest.plugins as Array<Record<string, unknown>>) ?? []).map((p) => ({
    plugin: sourceToString(p.source),
    ...(p.version ? { version: String(p.version) } : {}),
    ...(p.category ? { category: String(p.category) } : {}),
    ...(Array.isArray(p.tags) ? { tags: p.tags as string[] } : {}),
  }));
  const marketplace: Marketplace = {
    name: String(manifest.name),
    owner: {
      name: owner?.name ?? String(manifest.name),
      namespace,
      ...(owner?.email ? { email: owner.email } : {}),
    },
    ...(manifest.description ? { description: String(manifest.description) } : {}),
    plugins,
  };
  return { kind: "marketplace", marketplace };
}

/** Reverse-compile a Codex plugin or marketplace dir into the Loom model. */
export function importCodex(dir: string, opts?: ImportOptions): ImportResult | null {
  const namespace = opts?.namespace ?? "com.imported";

  // Codex has no native marketplace; our adapter emits a Loom-only index.
  const marketplace = readJson(join(dir, "loom-marketplace.json"));
  if (marketplace) return importMarketplace(marketplace, namespace);

  const manifest = readJson(join(dir, "plugin.json"));
  const basename = dir.replace(/\/+$/, "").split("/").pop() || "imported-plugin";
  const name = typeof manifest?.name === "string" ? manifest.name : basename;

  // A plugin is anything with the Codex component layout (manifest is best-effort).
  if (manifest || existsSync(join(dir, "skills")) || existsSync(join(dir, "agents"))) {
    return importPlugin(dir, manifest, name, namespace);
  }
  return null;
}
