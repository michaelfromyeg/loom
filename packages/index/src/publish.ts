import type { HarnessDriver } from "@michaelfromyeg/weft-adapter-kit";
import { type AdapterRegistry, type Diagnostic, lint } from "@michaelfromyeg/weft-core";
import { discoverEvals, type EvalReport, runEval } from "@michaelfromyeg/weft-eval";
import type { Badge, Target } from "@michaelfromyeg/weft-schema";
import { computeBadges } from "./badges";
import { type ScanResult, scanPlugin } from "./scan";

export interface PublishResult {
  id: string;
  version: string;
  /** The deterministic gate (spec §12): static valid + no failing trace/output runs. */
  ok: boolean;
  validPassed: boolean;
  evalFailed: boolean;
  badges: Badge[];
  harnessCoverage: Target[];
  diagnostics: Diagnostic[];
  evalReports: EvalReport[];
  scan: ScanResult;
}

/**
 * The deterministic publish gate (spec §9.1 step 9, §12): static validation always
 * runs and must pass; then every component's evals run against available harnesses,
 * and any FAILED trace/output run blocks the publish. Judge/differential are
 * advisory (reported `skipped`), and UNTESTED harnesses never block -- honest.
 */
export async function publishCheck(
  pluginDir: string,
  opts: {
    registry: AdapterRegistry;
    drivers: Record<Target, HarnessDriver>;
    /** Snapshot each harness's score into evals/.baselines/ for the next release. */
    snapshot?: boolean;
  },
): Promise<PublishResult> {
  const linted = lint(pluginDir);
  const validPassed = !linted.diagnostics.hasErrors;

  const evalReports: EvalReport[] = [];
  if (validPassed) {
    for (const d of discoverEvals(pluginDir)) {
      evalReports.push(
        await runEval({
          evalFile: d.evalFile,
          pluginDir,
          componentLeaf: d.componentLeaf,
          registry: opts.registry,
          drivers: opts.drivers,
          snapshotBaselines: opts.snapshot,
        }),
      );
    }
  }

  const evalFailed = evalReports.some((r) =>
    r.harnesses.some((h) => h.status === "tested" && !h.pass),
  );
  const scan = validPassed ? scanPlugin(pluginDir) : { clean: false, findings: [] };
  const { badges, harnessCoverage } = computeBadges({
    validPassed,
    evalReports,
    scanClean: scan.clean,
  });

  return {
    id: linted.id,
    version: linted.plugin.version,
    ok: validPassed && !evalFailed,
    validPassed,
    evalFailed,
    badges,
    harnessCoverage,
    diagnostics: linted.diagnostics.items,
    evalReports,
    scan,
  };
}
