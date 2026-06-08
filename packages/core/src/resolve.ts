import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
import type { Dependency } from "@michaelfromyeg/loom-schema";
import { execa } from "execa";
import { type FetchedPlugin, loadPluginDir } from "./loader";

export type Source =
  | { kind: "local"; path: string }
  | { kind: "github"; repo: string; ref?: string; subdir?: string }
  | { kind: "git"; url: string; ref?: string; subdir?: string }
  | { kind: "npm"; pkg: string; version?: string; subdir?: string };

/** Where cloned/fetched remote plugins are cached. */
export const CACHE_DIR = join(homedir(), ".loom", "cache");

/**
 * Split a remote ref into its base, an optional `//subdir` (a plugin/marketplace
 * in a repo subdirectory), and an optional `#ref` (branch/tag/SHA). The leading
 * protocol's own `//` (e.g. `https://`) is ignored when finding the subdir.
 */
function splitRefAndSubdir(s: string): { base: string; subdir?: string; ref?: string } {
  const hash = s.indexOf("#");
  const ref = hash >= 0 ? s.slice(hash + 1) : undefined;
  const head = hash >= 0 ? s.slice(0, hash) : s;
  const proto = head.match(/^[a-z+]+:\/\//i)?.[0] ?? "";
  const rest = head.slice(proto.length);
  const slash = rest.indexOf("//");
  if (slash === -1) return { base: head, ...(ref ? { ref } : {}) };
  return {
    base: proto + rest.slice(0, slash),
    subdir: rest.slice(slash + 2),
    ...(ref ? { ref } : {}),
  };
}

/** Parse a plugin/dependency source string into a structured form (spec §6.1). */
export function parseSource(src: string): Source {
  if (src.startsWith("./") || src.startsWith("../") || isAbsolute(src)) {
    return { kind: "local", path: src };
  }
  if (src.startsWith("npm:")) {
    const raw = src.slice("npm:".length);
    const slash = raw.indexOf("//");
    const subdir = slash >= 0 ? raw.slice(slash + 2) : undefined;
    const spec = slash >= 0 ? raw.slice(0, slash) : raw;
    // lastIndexOf("@") > 0 finds a version while leaving a scoped name's leading @.
    const at = spec.lastIndexOf("@");
    const pkg = at > 0 ? spec.slice(0, at) : spec;
    const version = at > 0 ? spec.slice(at + 1) : undefined;
    return { kind: "npm", pkg, ...(version ? { version } : {}), ...(subdir ? { subdir } : {}) };
  }
  if (src.startsWith("github:")) {
    const { base, subdir, ref } = splitRefAndSubdir(src.slice("github:".length));
    return { kind: "github", repo: base, ...(ref ? { ref } : {}), ...(subdir ? { subdir } : {}) };
  }
  if (
    src.startsWith("git@") ||
    src.startsWith("git+") ||
    src.startsWith("file://") ||
    /^https?:\/\//.test(src)
  ) {
    const { base, subdir, ref } = splitRefAndSubdir(src.replace(/^git\+/, ""));
    return { kind: "git", url: base, ...(ref ? { ref } : {}), ...(subdir ? { subdir } : {}) };
  }
  // Bare `owner/repo` (optionally `//subdir` / `#ref`) is GitHub shorthand.
  const { base, subdir, ref } = splitRefAndSubdir(src);
  if (/^[\w.-]+\/[\w.-]+$/.test(base)) {
    return { kind: "github", repo: base, ...(ref ? { ref } : {}), ...(subdir ? { subdir } : {}) };
  }
  return { kind: "local", path: src };
}

function cacheDirFor(key: string): string {
  return join(CACHE_DIR, createHash("sha256").update(key).digest("hex").slice(0, 16));
}

const SHA_RE = /^[0-9a-f]{40}$/i;

/** Clone (or refresh) a git repo into the cache and check out `ref`; return dir + SHA. */
async function gitFetch(
  url: string,
  ref: string | undefined,
): Promise<{ dir: string; sha: string }> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const dir = cacheDirFor(`${url}@${ref ?? "default"}`);
  const isSha = ref !== undefined && SHA_RE.test(ref);

  if (existsSync(join(dir, ".git"))) {
    await execa("git", ["fetch", "origin", ...(ref ? [ref] : [])], { cwd: dir });
    await execa("git", ["checkout", ref ?? "FETCH_HEAD"], { cwd: dir, reject: false });
  } else if (isSha) {
    await execa("git", ["clone", url, dir]);
    await execa("git", ["checkout", ref as string], { cwd: dir });
  } else {
    const branchArgs = ref ? ["--branch", ref] : [];
    await execa("git", ["clone", "--depth", "1", ...branchArgs, url, dir]);
  }
  const sha = (await execa("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout.trim();
  return { dir, sha };
}

/** A fetched plugin plus the ref/SHA it resolved to (for the lockfile). */
export interface ResolvedPlugin {
  fb: FetchedPlugin;
  ref: string;
  sha: string;
}

/**
 * Download an npm package tarball into the cache and extract it (no dependency
 * install); return the extracted package dir and its resolved version. A loom
 * plugin/marketplace published to npm is just its files inside the tarball.
 */
async function npmFetch(
  pkg: string,
  version: string | undefined,
): Promise<{ dir: string; sha: string }> {
  const spec = version ? `${pkg}@${version}` : pkg;
  const dir = cacheDirFor(`npm:${spec}`);
  mkdirSync(dir, { recursive: true });
  // `npm pack` fetches just the tarball from the registry; --json reports it.
  const { stdout } = await execa("npm", ["pack", spec, "--pack-destination", dir, "--json"], {
    cwd: dir,
  });
  const meta = JSON.parse(stdout) as Array<{ filename: string; version?: string }>;
  const first = meta[0];
  if (!first) throw new Error(`npm pack produced no tarball for "${spec}"`);
  // The tarball extracts its contents under a top-level `package/` directory.
  await execa("tar", ["-xzf", join(dir, first.filename), "-C", dir]);
  return { dir: join(dir, "package"), sha: first.version ?? version ?? "" };
}

/**
 * Resolve a plugin source to a fetched plugin on disk (spec §5, §9.1 step 2).
 * Local `./path` sources resolve relative to `fromRoot`; `github:`/git sources are
 * git-cloned and pinned to a SHA; `npm:` packages are fetched via `npm pack`. A
 * trailing `//subdir` selects a plugin nested in the source.
 */
export async function resolvePluginRefFull(
  source: string,
  fromRoot: string,
): Promise<ResolvedPlugin> {
  const src = parseSource(source);

  if (src.kind === "local") {
    const dir = isAbsolute(src.path) ? src.path : resolvePath(fromRoot, src.path);
    return { fb: loadOrThrow(dir, source), ref: "local", sha: "" };
  }
  if (src.kind === "github" || src.kind === "git") {
    const url = src.kind === "github" ? `https://github.com/${src.repo}.git` : src.url;
    const { dir, sha } = await gitFetch(url, src.ref);
    const root = src.subdir ? join(dir, src.subdir) : dir;
    return { fb: loadOrThrow(root, source), ref: src.ref ?? "default", sha };
  }
  const { dir, sha } = await npmFetch(src.pkg, src.version);
  const root = src.subdir ? join(dir, src.subdir) : dir;
  return { fb: loadOrThrow(root, source), ref: src.version ?? "latest", sha };
}

/** A resolved source directory on disk, plus the ref/SHA it came from. */
export interface ResolvedSource {
  dir: string;
  ref: string;
  sha: string;
}

/**
 * Resolve an install/build target (a plugin OR a marketplace) to a directory on
 * disk: a local path is returned as-is; a `github:`/git ref (optionally with a
 * `//subdir`) is cloned into the cache. Unlike `resolvePluginRefFull` this does
 * not load a plugin, so it works for a `marketplace.yaml` target too.
 */
export async function resolveSourceDir(source: string, fromRoot: string): Promise<ResolvedSource> {
  // A path that exists on disk is always local; this avoids misreading a real
  // local dir like "a/b" as the GitHub shorthand "owner/repo".
  const localGuess = isAbsolute(source) ? source : resolvePath(fromRoot, source);
  if (existsSync(localGuess)) return { dir: localGuess, ref: "local", sha: "" };

  const src = parseSource(source);
  if (src.kind === "local") {
    return { dir: localGuess, ref: "local", sha: "" };
  }
  if (src.kind === "github" || src.kind === "git") {
    const url = src.kind === "github" ? `https://github.com/${src.repo}.git` : src.url;
    const { dir, sha } = await gitFetch(url, src.ref);
    return { dir: src.subdir ? join(dir, src.subdir) : dir, ref: src.ref ?? "default", sha };
  }
  const { dir, sha } = await npmFetch(src.pkg, src.version);
  return { dir: src.subdir ? join(dir, src.subdir) : dir, ref: src.version ?? "latest", sha };
}

/** Convenience: resolve and return only the fetched plugin. */
export async function resolvePluginRef(source: string, fromRoot: string): Promise<FetchedPlugin> {
  return (await resolvePluginRefFull(source, fromRoot)).fb;
}

function loadOrThrow(dir: string, source: string): FetchedPlugin {
  const loaded = loadPluginDir(dir);
  if (!loaded.ok) {
    throw new Error(
      `failed to load "${source}":\n${loaded.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`,
    );
  }
  return loaded.value;
}

/** Resolve a `depends` entry to a fetched plugin (relative to the depending plugin root). */
export function resolveDependency(dep: Dependency, fromRoot: string): Promise<ResolvedPlugin> {
  return resolvePluginRefFull(dep.plugin, fromRoot);
}

/** Best-effort git ref + SHA for the lockfile. Returns sentinels outside a repo. */
export async function gitInfo(dir: string): Promise<{ ref: string; sha: string }> {
  try {
    const sha = (await execa("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout.trim();
    let ref = "HEAD";
    try {
      ref = (
        await execa("git", ["describe", "--tags", "--exact-match"], { cwd: dir })
      ).stdout.trim();
    } catch {
      try {
        ref = (
          await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir })
        ).stdout.trim();
      } catch {
        /* keep HEAD */
      }
    }
    return { ref, sha };
  } catch {
    return { ref: "local", sha: "" };
  }
}
