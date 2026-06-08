import type { Badge, IndexEntry, IndexFile, Target } from "@michaelfromyeg/loom-schema";

export interface IndexPluginInput {
  id: string;
  source: string;
  version: string;
  ref: string;
  sha: string;
  badges: Badge[];
  harnessCoverage: Target[];
  telemetry?: { installs: number; activeUsage: number };
}

/**
 * Build a `loom.index/1` from per-version plugin metadata (spec §10). Entries are
 * grouped by id and accumulate versions; the index is metadata only -- it never
 * hosts plugin contents.
 */
export function buildIndex(
  plugins: IndexPluginInput[],
  federated?: IndexFile["federated"],
): IndexFile {
  const byId = new Map<string, IndexEntry>();
  for (const p of plugins) {
    const entry = byId.get(p.id) ?? { id: p.id, source: p.source, versions: [] };
    entry.versions.push({
      version: p.version,
      ref: p.ref,
      sha: p.sha,
      badges: p.badges,
      harnessCoverage: p.harnessCoverage,
    });
    if (p.telemetry) entry.telemetry = p.telemetry;
    byId.set(p.id, entry);
  }
  return {
    schema: "loom.index/1",
    plugins: [...byId.values()],
    ...(federated && federated.length > 0 ? { federated } : {}),
  };
}

export function serializeIndex(index: IndexFile): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}
