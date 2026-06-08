import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessDriver, Transcript } from "@michaelfromyeg/weft-adapter-kit";
import { type AdapterRegistry, install, loadPluginDir } from "@michaelfromyeg/weft-core";
import {
  type Case,
  EvalFile,
  leafNameOf,
  loadManifest,
  type Target,
} from "@michaelfromyeg/weft-schema";
import { execa } from "execa";
import { type AssertResult, evaluateAssertion, type JudgeFn } from "./assert";
import { type Baseline, loadBaseline, writeBaseline } from "./baselines";

export interface CaseResult {
  name: string;
  assertions: AssertResult[];
  verifyPassed?: boolean;
  /** Deterministic score: fraction of trace/output assertions that passed. */
  score: number;
  pass: boolean;
}

export interface HarnessReport {
  harness: Target;
  status: "tested" | "untested";
  /** Why a harness was not tested (no driver / CLI absent / install failed). */
  reason?: string;
  cases: CaseResult[];
  /** Mean deterministic case score (snapshotted as the next release's baseline). */
  score: number;
  pass: boolean;
}

export interface EvalReport {
  component: string;
  harnesses: HarnessReport[];
}

export interface DiscoveredEval {
  componentLeaf: string;
  evalsPath: string;
  evalFile: EvalFile;
}

/** Find the components in a plugin that declare an `evals` file and load each. */
export function discoverEvals(pluginDir: string): DiscoveredEval[] {
  const loaded = loadPluginDir(pluginDir);
  if (!loaded.ok) {
    throw new Error(loaded.issues.map((i) => `${i.path}: ${i.message}`).join("\n"));
  }
  const out: DiscoveredEval[] = [];
  for (const c of loaded.value.plugin.components) {
    const evalsRel = "evals" in c ? c.evals : undefined;
    if (!evalsRel) continue;
    const text = loaded.value.read(evalsRel).toString("utf8");
    const parsed = loadManifest(EvalFile, text, { filename: evalsRel });
    if (!parsed.ok) {
      throw new Error(
        `invalid evals "${evalsRel}": ${parsed.issues.map((i) => i.message).join("; ")}`,
      );
    }
    out.push({ componentLeaf: leafNameOf(c), evalsPath: evalsRel, evalFile: parsed.value });
  }
  return out;
}

async function sh(cmd: string, cwd: string): Promise<number> {
  const r = await execa("bash", ["-lc", cmd], { cwd, reject: false, timeout: 60_000 });
  return r.exitCode ?? 1;
}

interface CaseContext {
  judge?: JudgeFn;
  baselineScore?: number;
  timeoutMs?: number;
}

async function runCase(
  c: Case,
  driver: HarnessDriver,
  cwd: string,
  ctx: CaseContext,
): Promise<CaseResult> {
  if (c.setup) await sh(c.setup, cwd);

  const transcripts: Transcript[] = [];
  for (let i = 0; i < c.samples; i++) {
    transcripts.push(await driver.run({ prompt: c.prompt, cwd, timeoutMs: ctx.timeoutMs }));
  }

  // Pass 1: evaluate the deterministic tier (trace/output) to get the case score.
  const results: (AssertResult | undefined)[] = new Array(c.assert.length);
  let detTotal = 0;
  let detPass = 0;
  for (let i = 0; i < c.assert.length; i++) {
    const a = c.assert[i];
    if (a.kind === "trace" || a.kind === "output") {
      const r = await evaluateAssertion(a, transcripts);
      results[i] = r;
      detTotal++;
      if (r.status === "pass") detPass++;
    }
  }
  const score = detTotal > 0 ? detPass / detTotal : 1;

  // Pass 2: judge (advisory unless gated) + differential (score vs baseline).
  for (let i = 0; i < c.assert.length; i++) {
    const a = c.assert[i];
    if (a.kind === "judge" || a.kind === "differential") {
      results[i] = await evaluateAssertion(a, transcripts, {
        judge: ctx.judge,
        caseScore: score,
        baselineScore: ctx.baselineScore,
      });
    }
  }
  const assertions = results.filter((r): r is AssertResult => r !== undefined);

  let verifyPassed: boolean | undefined;
  if (c.verify) verifyPassed = (await sh(c.verify, cwd)) === 0;
  if (c.cleanup) await sh(c.cleanup, cwd);

  // A case passes iff no assertion FAILED and any post-state verify passed.
  // degraded/skipped assertions do not fail the case (they are reported).
  const pass = !assertions.some((a) => a.status === "fail") && (verifyPassed ?? true);
  return { name: c.name, assertions, verifyPassed, score, pass };
}

export interface RunEvalOptions {
  evalFile: EvalFile;
  pluginDir: string;
  componentLeaf: string;
  registry: AdapterRegistry;
  drivers: Partial<Record<Target, HarnessDriver>>;
  scratchRoot?: string;
  timeoutMs?: number;
  /** Judge model for `judge` assertions (advisory unless gated). Omit to skip. */
  judge?: JudgeFn;
  /** Snapshot each harness's mean score into evals/.baselines/ (spec §9.5). */
  snapshotBaselines?: boolean;
}

/**
 * Drive the real harnesses headlessly and assert over what each did (spec §9.5).
 * A harness with no available driver is reported UNTESTED -- never faked. For each
 * tested harness the component is installed into a throwaway scratch project so the
 * harness loads it, then every case runs and is evaluated.
 */
export async function runEval(opts: RunEvalOptions): Promise<EvalReport> {
  const { evalFile, drivers } = opts;
  const harnesses: HarnessReport[] = [];

  for (const harness of evalFile.harnesses) {
    const driver = drivers[harness];
    if (!(driver && (await driver.available()))) {
      harnesses.push({
        harness,
        status: "untested",
        reason: driver ? "CLI not installed or not headless-capable" : "no driver for this harness",
        cases: [],
        score: 0,
        pass: false,
      });
      continue;
    }

    const baselineScore = loadBaseline(opts.pluginDir, evalFile.component, harness)?.score;
    const scratch = mkdtempSync(join(opts.scratchRoot ?? tmpdir(), `weft-eval-${harness}-`));
    try {
      await install({
        pluginDir: opts.pluginDir,
        scope: "project",
        cwd: scratch,
        registry: opts.registry,
        targets: [harness],
        only: [opts.componentLeaf],
        // Keep the source plugin pristine -- write the eval lock into the scratch dir.
        lockDir: scratch,
      });
      const cases: CaseResult[] = [];
      for (const c of evalFile.cases) {
        cases.push(
          await runCase(c, driver, scratch, {
            judge: opts.judge,
            baselineScore,
            timeoutMs: opts.timeoutMs,
          }),
        );
      }
      const score = cases.length > 0 ? cases.reduce((s, c) => s + c.score, 0) / cases.length : 1;
      if (opts.snapshotBaselines) {
        const snapshot: Baseline = { version: "current", score };
        writeBaseline(opts.pluginDir, evalFile.component, harness, snapshot);
      }
      harnesses.push({ harness, status: "tested", cases, score, pass: cases.every((c) => c.pass) });
    } catch (err) {
      harnesses.push({
        harness,
        status: "untested",
        reason: `install failed: ${(err as Error).message}`,
        cases: [],
        score: 0,
        pass: false,
      });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  return { component: evalFile.component, harnesses };
}
