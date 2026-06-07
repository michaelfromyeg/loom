/**
 * Classifies an artifact for the trust summary and lockfile grouping. This is
 * metadata only -- it never decides placement (relPath does that).
 */
export type ArtifactKind =
  | "skill"
  | "mcp"
  | "agent"
  | "command"
  | "hook"
  | "manifest"
  | "catalog"
  | "other";

/**
 * One file an adapter emits. `relPath` is relative to the native plugin/output
 * root the adapter targets (e.g. "skills/greet/SKILL.md",
 * ".claude-plugin/plugin.json"). Core decides the absolute base per build mode
 * and scope; the adapter never hard-codes absolute paths.
 */
export interface CompiledArtifact {
  relPath: string;
  contents: string | Buffer;
  kind?: ArtifactKind;
  /** Passthrough executables. Placed DISABLED; activation is a separate opt-in (spec §11). */
  executable?: boolean;
}

/** Convenience builder so adapters read declaratively. */
export function artifact(
  relPath: string,
  contents: string | Buffer,
  opts: { kind?: ArtifactKind; executable?: boolean } = {},
): CompiledArtifact {
  return { relPath, contents, ...opts };
}
