import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
import type { Dependency } from "@michaelfromyeg/loom-schema";
import { execa } from "execa";
import { type FetchedPlugin, loadPluginDir } from "./loader";

export type Source =
  | { kind: "local"; path: string }
  | { kind: "github"; repo: string; ref?: string }
  | { kind: "git"; url: string; ref?: string }
  | { kind: "npm"; pkg: string; version?: string };

/** Where cloned/fetched remote plugins are cached. */
export const CACHE_DIR = join(homedir(), ".loom", "cache");

/** Parse a plugin/dependency source string into a structured form (spec §6.1). */
export function parseSource(src: string): Source {
  if (src.startsWith("./") || src.startsWith("../") || isAbsolute(src)) {
    return { kind: "local", path: src };
  }
  if (src.startsWith("github:")) {
    const [repo, ref] = src.slice("github:".length).split("#");
    return ref ? { kind: "github", repo, ref } : { kind: "github", repo };
  }
  if (src.startsWith("npm:")) {
    const spec = src.slice("npm:".length);
    const at = spec.lastIndexOf("@");
    if (at > 0) return { kind: "npm", pkg: spec.slice(0, at), version: spec.slice(at + 1) };
    return { kind: "npm", pkg: spec };
  }
  if (
    src.startsWith("git@") ||
    src.startsWith("git+") ||
    src.startsWith("file://") ||
    /^https?:\/\//.test(src)
  ) {
    const [url, ref] = src.replace(/^git\+/, "").split("#");
    return ref ? { kind: "git", url, ref } : { kind: "git", url };
  }
  // Bare `owner/repo` is treated as GitHub shorthand.
  if (/^[\w.-]+\/[\w.-]+$/.test(src)) return { kind: "github", repo: src };
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
 * Resolve a plugin source to a fetched plugin on disk (spec §5, §9.1 step 2).
 * Local `./path` sources resolve relative to `fromRoot`; `github:`/git sources are
 * git-cloned into the cache and pinned to a resolved SHA; `npm:` is a clear stub.
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
    return { fb: loadOrThrow(dir, source), ref: src.ref ?? "default", sha };
  }
  throw new Error(`npm source resolution ("${source}") is not implemented yet`);
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
