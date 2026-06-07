import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessDriver, Transcript } from "@loom/adapter-kit";
import { type AdapterRegistry, install, loadPluginDir } from "@loom/core";
import { type Case, EvalFile, leafNameOf, loadManifest, type Target } from "@loom/schema";
import { execa } from "execa";
import { type AssertResult, evaluateAssertion } from "./assert";

export interface CaseResult {
  name: string;
  assertions: AssertResult[];
  verifyPassed?: boolean;
  pass: boolean;
}

export interface HarnessReport {
  harness: Target;
  status: "tested" | "untested";
  /** Why a harness was not tested (no driver / CLI absent / install failed). */
  reason?: string;
  cases: CaseResult[];
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

async function runCase(
  c: Case,
  driver: HarnessDriver,
  cwd: string,
  timeoutMs?: number,
): Promise<CaseResult> {
  if (c.setup) await sh(c.setup, cwd);

  const transcripts: Transcript[] = [];
  for (let i = 0; i < c.samples; i++) {
    transcripts.push(await driver.run({ prompt: c.prompt, cwd, timeoutMs }));
  }
  const assertions = c.assert.map((a) => evaluateAssertion(a, transcripts));

  let verifyPassed: boolean | undefined;
  if (c.verify) verifyPassed = (await sh(c.verify, cwd)) === 0;
  if (c.cleanup) await sh(c.cleanup, cwd);

  // A case passes iff no assertion FAILED and any post-state verify passed.
  // degraded/skipped assertions do not fail the case (they are reported).
  const pass = !assertions.some((a) => a.status === "fail") && (verifyPassed ?? true);
  return { name: c.name, assertions, verifyPassed, pass };
}

export interface RunEvalOptions {
  evalFile: EvalFile;
  pluginDir: string;
  componentLeaf: string;
  registry: AdapterRegistry;
  drivers: Record<Target, HarnessDriver>;
  scratchRoot?: string;
  timeoutMs?: number;
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
    if (!driver || !(await driver.available())) {
      harnesses.push({
        harness,
        status: "untested",
        reason: driver ? "CLI not installed or not headless-capable" : "no driver for this harness",
        cases: [],
        pass: false,
      });
      continue;
    }

    const scratch = mkdtempSync(join(opts.scratchRoot ?? tmpdir(), `loom-eval-${harness}-`));
    try {
      await install({
        pluginDir: opts.pluginDir,
        scope: "project",
        cwd: scratch,
        registry: opts.registry,
        targets: [harness],
        only: [opts.componentLeaf],
      });
      const cases: CaseResult[] = [];
      for (const c of evalFile.cases) {
        cases.push(await runCase(c, driver, scratch, opts.timeoutMs));
      }
      harnesses.push({ harness, status: "tested", cases, pass: cases.every((c) => c.pass) });
    } catch (err) {
      harnesses.push({
        harness,
        status: "untested",
        reason: `install failed: ${(err as Error).message}`,
        cases: [],
        pass: false,
      });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  return { component: evalFile.component, harnesses };
}
