import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import {
  artifact,
  type CompiledArtifact,
  type HarnessAdapter,
  type InstallPaths,
  type PluginCtx,
  parseFrontmatter,
  type ResolvedMarketplace,
} from "@michaelfromyeg/loom-adapter-kit";
import {
  type Component,
  kindOf,
  leafNameOf,
  type Plugin,
  refOf,
  type Scope,
} from "@michaelfromyeg/loom-schema";
import { importCodex } from "./import";
import { type McpServerConfig, mcpRunConfig, mcpServerName, renderMcpServersToml } from "./mcp";

/** Bump on any change to Codex's plugin/config/sidecar shape (spec §5). */
const TARGET_SCHEMA = "codex-plugin/0.117";

const json = (o: unknown): string => `${JSON.stringify(o, null, 2)}\n`;

/** Copy every file under a plugin dir into `destPrefix/`, preserving structure. */
function copyDir(
  ctx: PluginCtx,
  ref: string,
  destPrefix: string,
  kind: CompiledArtifact["kind"],
): CompiledArtifact[] {
  return ctx.list(ref).map((file) => {
    const within = file.startsWith(`${ref}/`) ? file.slice(ref.length + 1) : basename(file);
    return artifact(`${destPrefix}/${within}`, ctx.read(file), { kind });
  });
}

/** Place a component that may be a single Markdown file or a directory. */
function copyFileOrDir(
  ctx: PluginCtx,
  ref: string,
  destPrefix: string,
  kind: CompiledArtifact["kind"],
): CompiledArtifact[] {
  const files = ctx.list(ref);
  if (files.length === 0) {
    return [artifact(`${destPrefix}${extname(ref) || ".md"}`, ctx.read(ref), { kind })];
  }
  return copyDir(ctx, ref, destPrefix, kind);
}

/**
 * Read a skill's SKILL.md frontmatter so the sidecar can mirror its identity.
 * Returns empty data when there is no SKILL.md or no frontmatter block.
 */
function skillFrontmatter(ctx: PluginCtx, ref: string): Record<string, unknown> {
  try {
    const md = ctx.read(`${ref}/SKILL.md`).toString("utf8");
    return parseFrontmatter(md).data;
  } catch {
    return {};
  }
}

/**
 * Build the per-skill `agents/openai.yaml` sidecar. Shape is CONFIRMED in
 * harness-research.md: `interface.{display_name,short_description}`,
 * `policy.allow_implicit_invocation`, `dependencies.tools`.
 */
function skillSidecar(name: string, description: string): string {
  const yamlString = (v: string): string => JSON.stringify(v);
  return [
    "interface:",
    `  display_name: ${yamlString(name)}`,
    `  short_description: ${yamlString(description)}`,
    "policy:",
    "  allow_implicit_invocation: true",
    "dependencies:",
    "  tools: []",
    "",
  ].join("\n");
}

export const codexAdapter: HarnessAdapter = {
  target: "codex",
  version: "0.1.0",
  targetSchema: TARGET_SCHEMA,

  detect(scope: Scope, cwd: string): InstallPaths {
    const root = scope === "user" ? join(homedir(), ".codex") : join(cwd, ".codex");
    // User and project skills live on the SHARED `.agents/skills` path, NOT under
    // the `.codex` root (harness-research.md, Codex Skills section).
    const skills =
      scope === "user" ? join(homedir(), ".agents", "skills") : join(cwd, ".agents", "skills");
    return {
      root,
      plugins: join(root, "plugins"),
      skills,
      // config.toml (MCP servers) lives at the `.codex` root.
      mcp: root,
      agents: join(root, "agents"),
      // TODO(verify): Codex documents no dedicated commands dir; best-effort under root.
      commands: join(root, "commands"),
      // TODO(verify): Codex documents no hooks dir; best-effort under root.
      hooks: join(root, "hooks"),
      catalog: root,
    };
  },

  transform(component: Component, ctx: PluginCtx): CompiledArtifact[] {
    const ref = refOf(component);
    const leaf = leafNameOf(component);
    switch (kindOf(component)) {
      case "skill": {
        const files = copyDir(ctx, ref, `skills/${leaf}`, "skill");
        const fm = skillFrontmatter(ctx, ref);
        const displayName = typeof fm.name === "string" ? fm.name : leaf;
        const shortDescription = typeof fm.description === "string" ? fm.description : "";
        files.push(
          artifact(
            `skills/${leaf}/agents/openai.yaml`,
            skillSidecar(displayName, shortDescription),
            {
              kind: "skill",
            },
          ),
        );
        return files;
      }
      case "agent": {
        // Codex subagents are TOML files at agents/<leaf>.toml.
        // TODO(verify): exact subagent field set; documented fields are name,
        // description, developer_instructions (+ optional model/sandbox_mode/etc).
        const md = ctx.read(ref).toString("utf8");
        const { data, body } = parseFrontmatter(md);
        const name = typeof data.name === "string" ? data.name : leaf;
        const description = typeof data.description === "string" ? data.description : "";
        return [
          artifact(`agents/${leaf}.toml`, renderAgentToml(name, description, body), {
            kind: "agent",
          }),
        ];
      }
      case "command":
        // TODO(verify): no documented Codex commands dir; placed best-effort.
        return copyFileOrDir(ctx, ref, `commands/${leaf}`, "command");
      case "hook":
        // TODO(verify): no documented Codex hooks dir; placed best-effort.
        return copyFileOrDir(ctx, ref, `hooks/${leaf}`, "hook");
      case "mcp":
        // Verbatim provenance copy; the runnable config goes into config.toml.
        return copyDir(ctx, ref, `mcp/${leaf}`, "mcp");
      case "passthrough":
        // TODO(verify): no documented Codex hooks dir; placed best-effort, disabled.
        return [
          artifact(`hooks/${basename(ref)}`, ctx.read(ref), { kind: "hook", executable: true }),
        ];
      default:
        return [];
    }
  },

  emitManifest(plugin: Plugin, ctx: PluginCtx): CompiledArtifact[] {
    const artifacts: CompiledArtifact[] = [];

    const mcpServers: Record<string, McpServerConfig> = {};
    for (const c of plugin.components) {
      if (kindOf(c) !== "mcp") continue;
      try {
        const server = JSON.parse(ctx.read(`${refOf(c)}/server.json`).toString("utf8"));
        mcpServers[mcpServerName(server)] = mcpRunConfig(server);
      } catch {
        // validate.ts already surfaced an error for an unparsable server.json.
      }
    }

    const toml = renderMcpServersToml(mcpServers);
    if (toml) artifacts.push(artifact("config.toml", toml, { kind: "manifest" }));

    // Best-effort plugin descriptor. TODO(verify): the v0.117 plugin.json shape
    // is not fully documented; fields here are a sensible minimum.
    const manifest: { name: string; version?: string; description?: string } = {
      name: plugin.name,
      version: plugin.version,
    };
    if (plugin.description) manifest.description = plugin.description;
    artifacts.push(artifact("plugin.json", json(manifest), { kind: "manifest" }));

    return artifacts;
  },

  emitCatalog(marketplace: ResolvedMarketplace): CompiledArtifact[] {
    // TODO(verify): Codex has no confirmed native marketplace catalog format;
    // this loom-marketplace.json index is best-effort.
    const plugins = marketplace.entries.map((entry) => {
      const e: {
        name: string;
        source: string;
        description?: string;
        version?: string;
        category?: string;
        tags?: string[];
      } = {
        name: entry.name,
        source: entry.source.startsWith("./") ? entry.source : `./${entry.source}`,
      };
      if (entry.description) e.description = entry.description;
      if (entry.version) e.version = entry.version;
      if (entry.category) e.category = entry.category;
      if (entry.tags) e.tags = entry.tags;
      return e;
    });

    const catalog: {
      name: string;
      owner: { name: string; email?: string };
      description?: string;
      plugins: typeof plugins;
    } = {
      name: marketplace.name,
      owner: marketplace.owner.email
        ? { name: marketplace.owner.name, email: marketplace.owner.email }
        : { name: marketplace.owner.name },
      plugins,
    };
    if (marketplace.description) catalog.description = marketplace.description;

    return [artifact("loom-marketplace.json", json(catalog), { kind: "catalog" })];
  },

  importNative: importCodex,
};

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Render a Codex subagent TOML. Multi-line instructions use a basic string. */
function renderAgentToml(name: string, description: string, instructions: string): string {
  const lines = [`name = ${tomlString(name)}`];
  if (description) lines.push(`description = ${tomlString(description)}`);
  const body = instructions.trim();
  if (body) {
    const escaped = body.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
    lines.push(`developer_instructions = """\n${escaped}\n"""`);
  }
  return `${lines.join("\n")}\n`;
}

export default codexAdapter;
