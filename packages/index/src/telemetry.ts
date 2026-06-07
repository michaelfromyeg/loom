import type { IndexFile } from "@loom/schema";

/**
 * Opt-in, aggregate-only install record (spec §2, §10): increments an entry's
 * `installs`. There is no per-user data -- telemetry is a count, never identity.
 */
export function recordInstall(index: IndexFile, id: string): IndexFile {
  return {
    ...index,
    plugins: index.plugins.map((p) =>
      p.id === id
        ? {
            ...p,
            telemetry: {
              installs: (p.telemetry?.installs ?? 0) + 1,
              activeUsage: p.telemetry?.activeUsage ?? 0,
            },
          }
        : p,
    ),
  };
}
