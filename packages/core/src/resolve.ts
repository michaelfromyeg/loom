import { isAbsolute, resolve as resolvePath } from "node:path";
import type { Dependency } from "@loom/schema";
import { execa } from "execa";
import { type FetchedPlugin, loadPluginDir } from "./loader";

export type Source =
  | { kind: "local"; path: string }
  | { kind: "github"; repo: string; ref?: string }
  | { kind: "git"; url: string; ref?: string }
  | { kind: "npm"; pkg: string };

/** Parse a plugin/dependency source string into a structured form (spec §6.1). */
export function parseSource(src: string): Source {
  if (src.startsWith("./") || src.startsWith("../") || isAbsolute(src)) {
    return { kind: "local", path: src };
  }
  if (src.startsWith("github:")) return { kind: "github", repo: src.slice("github:".length) };
  if (src.startsWith("npm:")) return { kind: "npm", pkg: src.slice("npm:".length) };
  if (src.startsWith("git@") || src.startsWith("git+") || /^https?:\/\//.test(src)) {
    return { kind: "git", url: src };
  }
  // Bare `owner/repo` is treated as GitHub shorthand.
  if (/^[\w.-]+\/[\w.-]+$/.test(src)) return { kind: "github", repo: src };
  return { kind: "local", path: src };
}

/**
 * Resolve a plugin source string to a fetched plugin on disk. Resolves local
 * `./path` sources (relative to `fromRoot`); remote sources are a clearly-marked
 * Phase 1 stub rather than a silent guess. Used by both marketplace entries and
 * dependencies.
 */
export function resolvePluginRef(source: string, fromRoot: string): FetchedPlugin {
  const src = parseSource(source);
  if (src.kind !== "local") {
    throw new Error(
      `remote resolution ("${source}") lands in Phase 1; only local ./path sources resolve today`,
    );
  }
  const dir = isAbsolute(src.path) ? src.path : resolvePath(fromRoot, src.path);
  const loaded = loadPluginDir(dir);
  if (!loaded.ok) {
    throw new Error(
      `failed to load "${source}":\n${loaded.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`,
    );
  }
  return loaded.value;
}

/** Resolve a `depends` entry to a fetched plugin (relative to the depending plugin root). */
export function resolveDependency(dep: Dependency, fromRoot: string): FetchedPlugin {
  return resolvePluginRef(dep.plugin, fromRoot);
}

/** Best-effort git ref + SHA for the lockfile. Returns sentinels outside a repo. */
export async function gitInfo(dir: string): Promise<{ ref: string; sha: string }> {
  try {
    const sha = (await execa("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout.trim();
    let ref = "HEAD";
    try {
      const described = await execa("git", ["describe", "--tags", "--exact-match"], { cwd: dir });
      ref = described.stdout.trim();
    } catch {
      try {
        const branch = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir });
        ref = branch.stdout.trim();
      } catch {
        /* keep HEAD */
      }
    }
    return { ref, sha };
  } catch {
    return { ref: "local", sha: "" };
  }
}
