import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Target } from "@loom/schema";

export interface Baseline {
  version: string;
  score: number;
}

function baselineFile(pluginDir: string, component: string, harness: Target): string {
  const safe = component.replace(/[^\w.-]/g, "_");
  return join(pluginDir, "evals", ".baselines", safe, `${harness}.json`);
}

/** Load the committed baseline score for (component, harness), or null. */
export function loadBaseline(
  pluginDir: string,
  component: string,
  harness: Target,
): Baseline | null {
  const f = baselineFile(pluginDir, component, harness);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as Baseline;
  } catch {
    return null;
  }
}

/**
 * Snapshot a baseline (spec §9.5). Called on `loom publish` so the next release's
 * differential evals compare against this score.
 */
export function writeBaseline(
  pluginDir: string,
  component: string,
  harness: Target,
  baseline: Baseline,
): string {
  const f = baselineFile(pluginDir, component, harness);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, `${JSON.stringify(baseline, null, 2)}\n`);
  return f;
}
