import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessDriver } from "@michaelfromyeg/weft-adapter-kit";
import { type AdapterRegistry, install } from "@michaelfromyeg/weft-core";
import type { EvalFile, Target } from "@michaelfromyeg/weft-schema";
import { execa } from "execa";

/** One case's two transcripts, for human (or judge) side-by-side comparison. */
export interface CompareCase {
  name: string;
  prompt: string;
  /** Final text from the BEFORE version (e.g. a prior git ref). */
  before: string;
  /** Final text from the AFTER version (the working tree). */
  after: string;
}

export interface CompareReport {
  harness: Target;
  cases: CompareCase[];
}

export interface CompareOptions {
  evalFile: EvalFile;
  componentLeaf: string;
  /** The older version's plugin dir. */
  beforeDir: string;
  /** The current version's plugin dir. */
  afterDir: string;
  registry: AdapterRegistry;
  drivers: Partial<Record<Target, HarnessDriver>>;
  timeoutMs?: number;
}

/** Install one version into a scratch dir and capture each case's final text. */
async function runSide(
  dir: string,
  componentLeaf: string,
  driver: HarnessDriver,
  registry: AdapterRegistry,
  evalFile: EvalFile,
  timeoutMs: number | undefined,
): Promise<Map<string, string>> {
  const scratch = mkdtempSync(join(tmpdir(), `weft-compare-${driver.target}-`));
  try {
    await install({
      pluginDir: dir,
      scope: "project",
      cwd: scratch,
      registry,
      targets: [driver.target],
      only: [componentLeaf],
      lockDir: scratch,
    });
    const out = new Map<string, string>();
    for (const c of evalFile.cases) {
      if (c.setup) await execa("bash", ["-lc", c.setup], { cwd: scratch, reject: false });
      const t = await driver.run({ prompt: c.prompt, cwd: scratch, timeoutMs });
      out.set(c.name, t.finalText);
      if (c.cleanup) await execa("bash", ["-lc", c.cleanup], { cwd: scratch, reject: false });
    }
    return out;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Run each case's prompt against two versions of a component and return the two
 * transcripts side by side -- the "vibes" comparison. No scoring: a human (or a
 * pairwise judge) reads the pair and decides which definition is better.
 */
export async function compareVersions(opts: CompareOptions): Promise<CompareReport[]> {
  const reports: CompareReport[] = [];
  for (const harness of opts.evalFile.harnesses) {
    const driver = opts.drivers[harness];
    if (!(driver && (await driver.available()))) continue; // skip harnesses we can't run
    const before = await runSide(
      opts.beforeDir,
      opts.componentLeaf,
      driver,
      opts.registry,
      opts.evalFile,
      opts.timeoutMs,
    );
    const after = await runSide(
      opts.afterDir,
      opts.componentLeaf,
      driver,
      opts.registry,
      opts.evalFile,
      opts.timeoutMs,
    );
    reports.push({
      harness,
      cases: opts.evalFile.cases.map((c) => ({
        name: c.name,
        prompt: c.prompt,
        before: before.get(c.name) ?? "",
        after: after.get(c.name) ?? "",
      })),
    });
  }
  return reports;
}
