import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CatalogEntry, ResolvedMarketplace } from "@loom/adapter-kit";
import type { Badge, Lockfile, Marketplace, ParseIssue, Plugin, Scope, Target } from "@loom/schema";
import { type CompileResult, compile, staticPass } from "./compile";
import { resolveConfig, type SecretsResult } from "./config";
import { type DependencyRecord, resolveDependencies } from "./deps";
import { CompileError, type Diagnostic, type Diagnostics } from "./diagnostics";
import { type FetchedPlugin, loadMarketplaceDir, loadPluginDir } from "./loader";
import { buildLockfile, readLock, writeLock } from "./lockfile";
import { checkManagedPolicy, type ManagedPolicy } from "./managed";
import {
  buildToDir,
  installToScope,
  placeCatalog,
  placePluginArtifacts,
  planScopeArtifacts,
  type WrittenArtifact,
} from "./place";
import type { AdapterRegistry } from "./registry";
import { gitInfo, resolvePluginRefFull } from "./resolve";

/** Load a plugin and resolve its `depends` into a merged tree (spec §9.1 step 2). */
async function loadResolved(
  pluginDir: string,
): Promise<{ fb: FetchedPlugin; dependencies: DependencyRecord[] }> {
  return resolveDependencies(loadOrThrow(pluginDir));
}

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
export async function build(opts: BuildOptions): Promise<BuildResult> {
  const { fb } = await loadResolved(opts.pluginDir);
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
export async function buildMarketplace(
  opts: BuildMarketplaceOptions,
): Promise<BuildMarketplaceResult> {
  const loaded = loadMarketplaceDir(opts.marketplaceDir);
  if (!loaded.ok) {
    throw new CompileError(
      `failed to load marketplace in ${opts.marketplaceDir}`,
      issuesToDiagnostics(loaded.issues),
    );
  }
  const { marketplace, root } = loaded.value;

  const compiled: Array<{ entry: Marketplace["plugins"][number]; result: CompileResult }> = [];
  for (const entry of marketplace.plugins) {
    let fb: FetchedPlugin;
    try {
      fb = (await resolvePluginRefFull(entry.plugin, root)).fb;
    } catch (err) {
      throw new CompileError(`marketplace entry "${entry.plugin}" failed`, [
        { severity: "error", where: "plugins", message: (err as Error).message },
      ]);
    }
    // An entry version override flows into the compiled plugin.json too, so the
    // catalog and the plugin manifest agree (plugin.json wins at install time).
    if (entry.version) fb = { ...fb, plugin: { ...fb.plugin, version: entry.version } };
    // Resolve the entry plugin's own dependencies before compiling it.
    const merged = (await resolveDependencies(fb)).fb;
    const result = compile(merged, { registry: opts.registry, targets: opts.targets });
    if (result.diagnostics.hasErrors) {
      throw new CompileError(`plugin "${result.id}" failed`, result.diagnostics.errors);
    }
    compiled.push({ entry, result });
  }

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
  /** Managed-mode policy: namespace allowlist / required badges (spec §11). */
  managed?: ManagedPolicy;
  /** Badges known for this plugin (for managed `requireBadges`). */
  badges?: Badge[];
  /** Where to write `loom.lock` (default: the plugin dir). Eval points this at a scratch dir. */
  lockDir?: string;
  /** Inject the lockfile timestamp for deterministic tests. */
  now?: string;
}

export interface InstallResult {
  result: CompileResult;
  lockfile: Lockfile;
  lockPath: string;
  /** Declared config resolution summary (never the values) -- spec §11. */
  secrets: SecretsResult;
}

/** Compile a plugin, place it into the scope's dirs, resolve config, write `loom.lock`. */
export async function install(opts: InstallOptions): Promise<InstallResult> {
  const { fb, dependencies } = await loadResolved(opts.pluginDir);
  const result = compile(fb, {
    registry: opts.registry,
    targets: opts.targets,
    only: opts.only,
  });
  if (result.diagnostics.hasErrors) {
    throw new CompileError("compile failed", result.diagnostics.errors);
  }
  // Managed mode gates the install by namespace / required badges (spec §11).
  const blocked = checkManagedPolicy(opts.managed, {
    namespace: result.fb.plugin.owner.namespace,
    badges: opts.badges,
  });
  if (blocked) {
    throw new CompileError("install blocked by managed policy", [
      { severity: "error", where: "managed", message: blocked },
    ]);
  }
  const artifacts = installToScope(result, opts.scope, opts.cwd);
  const secrets = resolveConfig(result.fb.plugin, opts.cwd);
  const { ref, sha } = await gitInfo(opts.pluginDir);
  const lockfile = buildLockfile({
    result,
    artifacts,
    dependencies,
    ref,
    sha,
    generatedAt: opts.now ?? new Date().toISOString(),
  });
  const lockPath = writeLock(opts.lockDir ?? opts.pluginDir, lockfile);
  return { result, lockfile, lockPath, secrets };
}

export interface UninstallOptions {
  /** Where loom.lock lives (also the default place uninstall reads from). */
  pluginDir: string;
  lockDir?: string;
}

export interface UninstallResult {
  removed: string[];
}

/** Prune now-empty directories upward from each removed file (best-effort). */
function pruneEmptyDirs(paths: string[]): void {
  const dirs = new Set(paths.map((p) => dirname(p)));
  for (const start of dirs) {
    let d = start;
    while (d && d !== dirname(d)) {
      try {
        if (readdirSync(d).length > 0) break;
        rmSync(d, { recursive: true, force: true });
      } catch {
        break;
      }
      d = dirname(d);
    }
  }
}

/**
 * Remove everything `install` placed, using the paths recorded in `loom.lock`,
 * then delete the lockfile (spec §6.3). Errors are defined out of existence:
 * a missing artifact is simply skipped.
 */
export function uninstall(opts: UninstallOptions): UninstallResult {
  const dir = opts.lockDir ?? opts.pluginDir;
  const lock = readLock(dir);
  if (!lock) {
    throw new CompileError("nothing to uninstall", [
      { severity: "error", where: "loom.lock", message: `no loom.lock found in ${dir}` },
    ]);
  }
  const removed: string[] = [];
  for (const a of lock.artifacts) {
    if (existsSync(a.path)) {
      rmSync(a.path, { force: true });
      removed.push(a.path);
    }
  }
  pruneEmptyDirs(removed);
  rmSync(join(dir, "loom.lock"), { force: true });
  return { removed };
}

export interface UpdateResult {
  lockfile: Lockfile;
  lockPath: string;
  /** Artifacts whose content hash changed (or are new) since the prior lockfile. */
  changed: string[];
}

/**
 * Re-resolve refs, recompile, diff artifact content hashes against `loom.lock`,
 * and re-place ONLY changed artifacts (spec §5, §9.3). Content addressing makes
 * "is there really a new version?" exact: an unchanged artifact is never rewritten.
 */
export async function update(opts: InstallOptions): Promise<UpdateResult> {
  const prev = readLock(opts.pluginDir);
  const prevHash = new Map((prev?.artifacts ?? []).map((a) => [a.path, a.hash]));

  const { fb, dependencies } = await loadResolved(opts.pluginDir);
  const result = compile(fb, { registry: opts.registry, targets: opts.targets, only: opts.only });
  if (result.diagnostics.hasErrors) {
    throw new CompileError("compile failed", result.diagnostics.errors);
  }

  const planned = planScopeArtifacts(result, opts.scope, opts.cwd);
  const changed: string[] = [];
  for (const { record, contents } of planned) {
    if (prevHash.get(record.path) === record.hash) continue; // unchanged -> never rewrite
    mkdirSync(dirname(record.path), { recursive: true });
    writeFileSync(record.path, contents);
    changed.push(record.path);
  }

  const { ref, sha } = await gitInfo(opts.pluginDir);
  const lockfile = buildLockfile({
    result,
    artifacts: planned.map((p) => p.record),
    dependencies,
    ref,
    sha,
    generatedAt: opts.now ?? new Date().toISOString(),
  });
  const lockPath = writeLock(opts.pluginDir, lockfile);
  return { lockfile, lockPath, changed };
}
