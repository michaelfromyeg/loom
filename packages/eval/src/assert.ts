import type { Transcript } from "@loom/adapter-kit";
import type { Assertion, OutputAssert, TraceAssert } from "@loom/schema";

export type AssertStatus = "pass" | "fail" | "degraded" | "skipped";

export interface AssertResult {
  kind: Assertion["kind"];
  status: AssertStatus;
  detail: string;
}

/** True iff `seq` appears as an ordered subsequence of `arr`. */
function isSubsequence(seq: string[], arr: string[]): boolean {
  let i = 0;
  for (const item of arr) {
    if (item === seq[i]) i++;
    if (i === seq.length) return true;
  }
  return seq.length === 0;
}

function traceSamplePasses(a: TraceAssert, t: Transcript): boolean {
  const names = t.toolCalls.map((c) => c.name);
  if (a.toolCalled && !names.includes(a.toolCalled)) return false;
  if (a.toolNotCalled && names.includes(a.toolNotCalled)) return false;
  if (a.maxCalls !== undefined && t.toolCalls.length > a.maxCalls) return false;
  if (a.sequence && !isSubsequence(a.sequence, names)) return false;
  return true;
}

function evaluateTrace(a: TraceAssert, transcripts: Transcript[]): AssertResult {
  // Degrade honestly: a harness with no structured trace cannot be trace-evaluated.
  if (transcripts.length > 0 && transcripts.every((t) => t.traceUnavailable)) {
    return {
      kind: "trace",
      status: "degraded",
      detail: "harness exposes no tool-call trace; trace assertion not evaluated",
    };
  }
  const passes = transcripts.filter((t) => traceSamplePasses(a, t)).length;
  const rate = transcripts.length > 0 ? passes / transcripts.length : 0;
  return {
    kind: "trace",
    status: rate >= a.minPassRate ? "pass" : "fail",
    detail: `${passes}/${transcripts.length} samples passed (minPassRate ${a.minPassRate})`,
  };
}

/**
 * Compile a `matches` pattern, translating a leading inline flag group like
 * `(?i)` into real RegExp flags (JS does not support inline flags and throws on
 * them). An otherwise-invalid pattern never matches rather than throwing.
 */
function compileRegex(pattern: string): RegExp | null {
  const m = /^\(\?([a-z]+)\)/.exec(pattern);
  try {
    return m ? new RegExp(pattern.slice(m[0].length), m[1]) : new RegExp(pattern);
  } catch {
    return null;
  }
}

function outputSamplePasses(a: OutputAssert, t: Transcript): boolean {
  const text = t.finalText;
  if (a.equals !== undefined && text.trim() !== a.equals.trim()) return false;
  if (a.matches !== undefined && !compileRegex(a.matches)?.test(text)) return false;
  if (a.jsonSchema !== undefined) {
    try {
      JSON.parse(text);
    } catch {
      return false;
    }
  }
  return true;
}

function evaluateOutput(a: OutputAssert, transcripts: Transcript[]): AssertResult {
  if (transcripts.length === 0) return { kind: "output", status: "fail", detail: "no samples" };
  const passes = transcripts.filter((t) => outputSamplePasses(a, t)).length;
  return {
    kind: "output",
    status: passes === transcripts.length ? "pass" : "fail",
    detail: `${passes}/${transcripts.length} samples matched`,
  };
}

/**
 * Evaluate one assertion against a case's sample transcripts. Trace and output
 * are evaluated deterministically here; judge and differential are advisory and
 * land in Phase 3 (reported as `skipped`).
 */
export function evaluateAssertion(a: Assertion, transcripts: Transcript[]): AssertResult {
  switch (a.kind) {
    case "trace":
      return evaluateTrace(a, transcripts);
    case "output":
      return evaluateOutput(a, transcripts);
    case "judge":
      return { kind: "judge", status: "skipped", detail: "judge evals land in Phase 3" };
    case "differential":
      return {
        kind: "differential",
        status: "skipped",
        detail: "differential evals land in Phase 3",
      };
  }
}
