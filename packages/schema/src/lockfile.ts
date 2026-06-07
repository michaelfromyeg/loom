import { z } from "zod";
import { Target } from "./plugin";

export const Scope = z.enum(["user", "project"]);
export type Scope = z.infer<typeof Scope>;

export const ArtifactRecord = z.object({
  /** Fully-qualified component id. */
  component: z.string(),
  target: Target,
  scope: Scope,
  /** Absolute placement path. */
  path: z.string(),
  /** sha256 of compiled output. */
  hash: z.string(),
  placement: z.enum(["copy", "shared"]),
  /** Executable artifacts start disabled (§11). */
  enabled: z.boolean(),
});
export type ArtifactRecord = z.infer<typeof ArtifactRecord>;

export const AdapterRecord = z.object({
  version: z.string(),
  targetSchema: z.string(),
});

/** `loom.lock` — generated and committed; drives update/uninstall/verify. */
export const Lockfile = z.object({
  loomVersion: z.string(),
  generatedAt: z.string(),
  plugin: z.object({
    id: z.string(),
    version: z.string(),
    ref: z.string(),
    sha: z.string(),
  }),
  dependencies: z.array(
    z.object({
      id: z.string(),
      range: z.string(),
      resolvedSha: z.string(),
    }),
  ),
  artifacts: z.array(ArtifactRecord),
  adapters: z
    .object({
      claude: AdapterRecord.optional(),
      codex: AdapterRecord.optional(),
      cursor: AdapterRecord.optional(),
      copilot: AdapterRecord.optional(),
      opencode: AdapterRecord.optional(),
    })
    .partial(),
  /** Bare leaf name -> fully-qualified id (§9.4). */
  aliases: z.record(z.string(), z.string()),
});
export type Lockfile = z.infer<typeof Lockfile>;
