import type { EvalReport } from "@loom/eval";
import type { Badge, Target } from "@loom/schema";

export interface BadgeInputs {
  /** Static validation (the valid badge) passed. */
  validPassed: boolean;
  /** Reports from running the deterministic eval tier (trace + output). */
  evalReports?: EvalReport[];
  /** Security scan found nothing (the scanned badge). */
  scanClean?: boolean;
  /** A valid signature over the lockfile-hashed artifacts (the signed badge). */
  signatureValid?: boolean;
  /** Publisher namespace ownership proven (the verified badge). */
  ownershipVerified?: boolean;
}

export interface BadgeResult {
  badges: Badge[];
  /** Harnesses with a passing deterministic run. */
  harnessCoverage: Target[];
}

/**
 * Compute the Phase 2 badges from validation + eval results (spec §10).
 * - `valid`: static/lint passes.
 * - `tested`: eval cases exist AND the deterministic tier passes on >= 1 harness;
 *   `harnessCoverage` is the set of harnesses with a passing run. An UNTESTED
 *   harness never counts -- honest coverage.
 * (`verified`/`scanned`/`signed` are computed in Phase 3.)
 */
export function computeBadges(input: BadgeInputs): BadgeResult {
  const badges: Badge[] = [];
  if (input.validPassed) badges.push("valid");

  const coverage = new Set<Target>();
  let anyCases = false;
  let anyTestedPass = false;
  for (const report of input.evalReports ?? []) {
    for (const h of report.harnesses) {
      if (h.cases.length > 0) anyCases = true;
      if (h.status === "tested" && h.pass) {
        coverage.add(h.harness);
        anyTestedPass = true;
      }
    }
  }
  if (anyCases && anyTestedPass) badges.push("tested");
  if (input.ownershipVerified) badges.push("verified");
  if (input.scanClean) badges.push("scanned");
  if (input.signatureValid) badges.push("signed");

  return { badges, harnessCoverage: [...coverage] };
}
