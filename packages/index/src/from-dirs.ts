import { gitInfo, lint } from "@loom/core";
import type { IndexFile } from "@loom/schema";
import { buildIndex, type IndexPluginInput } from "./build";

/**
 * Build a metadata index from a set of plugin directories (spec §10, Phase 2
 * "index builds from a set of plugins"). Each plugin is statically validated for
 * the `valid` badge and stamped with its git ref/SHA. The richer `tested` badge
 * comes from the publish gate (which runs evals).
 */
export async function indexFromPluginDirs(
  dirs: string[],
  opts: { sourceFor?: (dir: string) => string } = {},
): Promise<IndexFile> {
  const inputs: IndexPluginInput[] = [];
  for (const dir of dirs) {
    const linted = lint(dir);
    const { ref, sha } = await gitInfo(dir);
    inputs.push({
      id: linted.id,
      source: opts.sourceFor?.(dir) ?? dir,
      version: linted.plugin.version,
      ref,
      sha,
      badges: linted.diagnostics.hasErrors ? [] : ["valid"],
      harnessCoverage: [],
    });
  }
  return buildIndex(inputs);
}
