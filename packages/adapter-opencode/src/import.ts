import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import {
  artifact,
  type CompiledArtifact,
  type ImportedMarketplace,
  type ImportedPlugin,
  type ImportOptions,
  type ImportResult,
} from "@michaelfromyeg/weft-adapter-kit";
import type { Component, Marketplace, Plugin } from "@michaelfromyeg/weft-schema";
import type { OpencodeMcpServer } from "./mcp";

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
  if (!(existsSync(dir) && statSync(dir).isDirectory())) return [];
  return readdirSync(dir)
    .filter((n) => statSync(join(dir, n)).isDirectory() && existsSync(join(dir, n, marker)))
    .sort();
}

function filesWithExt(dir: string, ext: string): string[] {
  if (!(existsSync(dir) && statSync(dir).isDirectory())) return [];
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

/** A Loom source string from a Loom-marketplace `source` (string or object). */
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

/**
 * Reconstruct an MCP-standard server.json from OpenCode's runnable `mcp` entry
 * (lossy but functional). OpenCode's local `command` is a STRING ARRAY (argv)
 * and the env key is `environment`, not `env`.
 */
function synthesizeServerJson(namespace: string, name: string, cfg: OpencodeMcpServer): unknown {
  const base = {
    $schema: MCP_SCHEMA,
    name: `${namespace}/${name}`,
    description: `Imported ${name} MCP server.`,
    version: "0.0.0",
  };
  if (cfg.type === "remote") {
    const headers = cfg.headers
      ? Object.entries(cfg.headers).map(([n, value]) => ({ name: n, value }))
      : undefined;
    return {
      ...base,
      remotes: [{ type: "streamable-http", url: cfg.url, ...(headers?.length ? { headers } : {}) }],
    };
  }
  const command = cfg.command ?? [];
  // npm-style: ["npx","-y","<ident>"] -> npm package (parse the ident after -y).
  if (command[0] === "npx") {
    const ident = command.slice(1).find((a) => a !== "-y" && !a.startsWith("-"));
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
  // Bare command: first element is the executable, the rest are args.
  return {
    ...base,
    ...(command.length ? { command: command[0], args: command.slice(1) } : {}),
    ...(cfg.environment ? { env: cfg.environment } : {}),
  };
}

function importPlugin(dir: string, namespace: string): ImportedPlugin {
  const components: Component[] = [];
  const files: CompiledArtifact[] = [];

  for (const sk of subdirsWith(join(dir, "skills"), "SKILL.md")) {
    components.push({ skill: `skills/${sk}` });
    files.push(...copyTree(join(dir, "skills", sk), `skills/${sk}`, "skill"));
  }
  for (const f of filesWithExt(join(dir, "agents"), ".md")) {
    components.push({ agent: `agents/${f}` });
    files.push(artifact(`agents/${f}`, readFileSync(join(dir, "agents", f)), { kind: "agent" }));
  }
  for (const f of filesWithExt(join(dir, "commands"), ".md")) {
    components.push({ command: `commands/${f}` });
    files.push(
      artifact(`commands/${f}`, readFileSync(join(dir, "commands", f)), { kind: "command" }),
    );
  }

  // Prefer verbatim mcp/<leaf>/server.json copies the adapter wrote; only if there
  // is NO mcp/ dir do we reconstruct server.json from opencode.json's mcp block.
  const mcpDir = join(dir, "mcp");
  const verbatim = subdirsWith(mcpDir, "server.json");
  if (verbatim.length > 0) {
    for (const leaf of verbatim) {
      components.push({ mcp: `mcp/${leaf}` });
      files.push(
        artifact(`mcp/${leaf}/server.json`, readFileSync(join(mcpDir, leaf, "server.json")), {
          kind: "mcp",
        }),
      );
    }
  } else {
    const config = readJson(join(dir, "opencode.json"));
    const servers = (config?.mcp as Record<string, OpencodeMcpServer> | undefined) ?? {};
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

  // OpenCode has no plugin manifest; the name is the directory basename, with the
  // opencode.json "name" (if any) preferred.
  const config = readJson(join(dir, "opencode.json"));
  const name = config?.name ? String(config.name) : basename(dir);
  const plugin: Plugin = {
    name,
    version: "0.1.0",
    owner: { name, namespace },
    components,
  };
  return { kind: "plugin", plugin, files };
}

function importMarketplace(
  manifest: Record<string, unknown>,
  namespace: string,
): ImportedMarketplace {
  const owner = manifest.owner as { name?: string; email?: string } | undefined;
  const plugins = ((manifest.plugins as Record<string, unknown>[]) ?? []).map((p) => ({
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

/** Reverse-compile an OpenCode plugin or Loom-marketplace dir into the Loom model. */
export function importOpencode(dir: string, opts?: ImportOptions): ImportResult | null {
  const namespace = opts?.namespace ?? "com.imported";

  // OpenCode has no native marketplace; the adapter emits a Loom-only catalog.
  const marketplace = readJson(join(dir, "loom-marketplace.json"));
  if (marketplace) return importMarketplace(marketplace, namespace);

  // Directory convention: any plural component dir makes this an importable plugin.
  if (
    existsSync(join(dir, "skills")) ||
    existsSync(join(dir, "agents")) ||
    existsSync(join(dir, "commands")) ||
    existsSync(join(dir, "mcp")) ||
    existsSync(join(dir, "opencode.json"))
  ) {
    return importPlugin(dir, namespace);
  }
  return null;
}
