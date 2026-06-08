import { z } from "zod";
import { Target } from "./plugin";

/** Trust badges (spec §10). valid/tested are computed in Phase 2; the rest in Phase 3. */
export const Badge = z.enum(["valid", "tested", "verified", "scanned", "signed"]);
export type Badge = z.infer<typeof Badge>;

export const IndexVersion = z.object({
  version: z.string(),
  ref: z.string(),
  sha: z.string(),
  badges: z.array(Badge),
  /** Harnesses with passing deterministic eval runs. */
  harnessCoverage: z.array(Target),
});
export type IndexVersion = z.infer<typeof IndexVersion>;

export const IndexEntry = z.object({
  id: z.string(),
  source: z.string(),
  versions: z.array(IndexVersion),
  /** Aggregate, opt-in only -- never per-user. */
  telemetry: z
    .object({
      installs: z.number().default(0),
      activeUsage: z.number().default(0),
    })
    .optional(),
});
export type IndexEntry = z.infer<typeof IndexEntry>;

/** `weft.index/1` -- a metadata-only aggregator (spec §10), self-hostable static JSON. */
export const IndexFile = z.object({
  schema: z.literal("weft.index/1"),
  plugins: z.array(IndexEntry),
  federated: z.array(z.object({ source: z.string(), ingestedAt: z.string() })).optional(),
});
export type IndexFile = z.infer<typeof IndexFile>;
