import { join } from "node:path";
import type { CatalogEntry, ResolvedMarketplace } from "@loom/adapter-kit";
import type { Lockfile, Marketplace, ParseIssue, Plugin, Scope, Target } from "@loom/schema";
import { type CompileResult, compile, staticPass } from "./compile";
import { CompileError, type Diagnostic, type Diagnostics } from "./diagnostics";
import { loadMarketplaceDir, loadPluginDir } from "./loader";
import { buildLockfile, writeLock } from "./lockfile";
import {
  buildToDir,
  installToScope,
  placeCatalog,
  placePluginArtifacts,
  type WrittenArtifact,
} from "./place";
import type { AdapterRegistry } from "./registry";
import { gitInfo, resolvePluginRef } from "./resolve";

function issuesToDiagnostics(issues: ParseIssue[]): Diagnostic[] {
  return issues.map((i) => ({ severity: "error", where: i.path, message: i.message }));
}

function loadOrThrow(pluginDir: string) {
  const loaded = loadPluginDir(pluginDir);
  if (!loaded.ok) {
    throw new CompileError(
      `failed to load plugin in ${pluginDir}`,
      issuesToDiagnostics(loaded.issues),
    );
  }
  return loaded.value;
}

export interface LintResult {
  id: string;
  plugin: Plugin;
  aliases: Record<string, string>;
  diagnostics: Diagnostics;
}

/** Load + statically validate a plugin without running any adapter (the valid badge). */
export function lint(pluginDir: string): LintResult {
  const fb = loadOrThrow(pluginDir);
  const pass = staticPass(fb);
  return { id: pass.id, plugin: fb.plugin, aliases: pass.aliases, diagnostics: pass.diagnostics };
}

export interface BuildOptions {
  pluginDir: string;
  outDir: string;
  registry: AdapterRegistry;
  targets?: Target[];
}

export interface BuildResult {
  result: CompileResult;
  written: WrittenArtifact[];
}

/** Compile a plugin and write its marketplace + plugin layout into `outDir` (no install). */
export function build(opts: BuildOptions): BuildResult {
  const fb = loadOrThrow(opts.pluginDir);
  const result = compile(fb, { registry: opts.registry, targets: opts.targets });
  if (result.diagnostics.hasErrors) {
    throw new CompileError("compile failed", result.diagnostics.errors);
  }
  const written = buildToDir(result, opts.outDir);
  return { result, written };
}

export interface BuildMarketplaceOptions {
  marketplaceDir: string;
  outDir: string;
  registry: AdapterRegistry;
  targets?: Target[];
}

export interface BuildMarketplaceResult {
  marketplace: Marketplace;
  plugins: CompileResult[];
  written: WrittenArtifact[];
}

/**
 * Compile a curated `marketplace.yaml` of many plugins: resolve and compile each
 * referenced plugin, place every plugin tree under `outDir/<target>/plugins/`,
 * and emit ONE native catalog per target listing them all (spec §6.2). This is
 * the company-marketplace workflow.
 */
export function buildMarketplace(opts: BuildMarketplaceOptions): BuildMarketplaceResult {
  const loaded = loadMarketplaceDir(opts.marketplaceDir);
  if (!loaded.ok) {
    throw new CompileError(
      `failed to load marketplace in ${opts.marketplaceDir}`,
      issuesToDiagnostics(loaded.issues),
    );
  }
  const { marketplace, root } = loaded.value;

  const compiled = marketplace.plugins.map((entry) => {
    let fb: ReturnType<typeof resolvePluginRef>;
    try {
      fb = resolvePluginRef(entry.plugin, root);
    } catch (err) {
      throw new CompileError(`marketplace entry "${entry.plugin}" failed`, [
        { severity: "error", where: "plugins", message: (err as Error).message },
      ]);
    }
    // An entry version override flows into the compiled plugin.json too, so the
    // catalog and the plugin manifest agree (plugin.json wins at install time).
    if (entry.version) fb = { ...fb, plugin: { ...fb.plugin, version: entry.version } };
    const result = compile(fb, { registry: opts.registry, targets: opts.targets });
    if (result.diagnostics.hasErrors) {
      throw new CompileError(`plugin "${result.id}" failed`, result.diagnostics.errors);
    }
    return { entry, result };
  });

  const targets = opts.targets ?? opts.registry.targets;
  const written: WrittenArtifact[] = [];
  for (const target of targets) {
    const adapter = opts.registry.get(target);
    if (!adapter) continue;
    const base = join(opts.outDir, target);
    const entries: CatalogEntry[] = [];
    for (const { entry, result } of compiled) {
      const output = result.targets.find((t) => t.target === target);
      if (!output) continue;
      const p = result.fb.plugin;
      written.push(...placePluginArtifacts(output, base, p.name));
      entries.push({
        name: p.name,
        source: `./plugins/${p.name}`,
        ...(p.description ? { description: p.description } : {}),
        version: entry.version ?? p.version,
        ...(entry.category ? { category: entry.category } : {}),
        ...(entry.tags ? { tags: entry.tags } : {}),
      });
    }
    const resolved: ResolvedMarketplace = {
      name: marketplace.name,
      owner: marketplace.owner,
      ...(marketplace.description ? { description: marketplace.description } : {}),
      entries,
    };
    written.push(...placeCatalog(adapter, resolved, base));
  }

  return { marketplace, plugins: compiled.map((c) => c.result), written };
}

export interface InstallOptions {
  pluginDir: string;
  scope: Scope;
  cwd: string;
  registry: AdapterRegistry;
  targets?: Target[];
  /** Piecemeal: install only these component leaf names (spec §9.2). */
  only?: string[];
  /** Inject the lockfile timestamp for deterministic tests. */
  now?: string;
}

export interface InstallResult {
  result: CompileResult;
  lockfile: Lockfile;
  lockPath: string;
}

/** Compile a plugin, place it into the scope's dirs, and write `loom.lock`. */
export async function install(opts: InstallOptions): Promise<InstallResult> {
  const fb = loadOrThrow(opts.pluginDir);
  const result = compile(fb, {
    registry: opts.registry,
    targets: opts.targets,
    only: opts.only,
  });
  if (result.diagnostics.hasErrors) {
    throw new CompileError("compile failed", result.diagnostics.errors);
  }
  const artifacts = installToScope(result, opts.scope, opts.cwd);
  const { ref, sha } = await gitInfo(opts.pluginDir);
  const lockfile = buildLockfile({
    result,
    artifacts,
    ref,
    sha,
    generatedAt: opts.now ?? new Date().toISOString(),
  });
  const lockPath = writeLock(opts.pluginDir, lockfile);
  return { result, lockfile, lockPath };
}
