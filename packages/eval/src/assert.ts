import type { Transcript } from "@michaelfromyeg/loom-adapter-kit";
import type {
  Assertion,
  DifferentialAssert,
  JudgeAssert,
  OutputAssert,
  TraceAssert,
} from "@michaelfromyeg/loom-schema";

export type AssertStatus = "pass" | "fail" | "degraded" | "skipped";

export interface AssertResult {
  kind: Assertion["kind"];
  status: AssertStatus;
  detail: string;
}

export interface JudgeInput {
  candidate: string;
  reference?: string;
  rubric: string;
  mode: "absolute" | "pairwise";
  samples: number;
}
export interface JudgeVerdict {
  pass: boolean;
  detail?: string;
}
/** A judge model. Injected so evals run offline/deterministically in tests. */
export type JudgeFn = (input: JudgeInput) => Promise<JudgeVerdict>;

export interface AssertContext {
  judge?: JudgeFn;
  /** Deterministic score of the case (fraction of trace/output passing) -- differential. */
  caseScore?: number;
  /** Baseline score for (component, harness) from evals/.baselines/ -- differential. */
  baselineScore?: number;
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

async function evaluateJudge(
  a: JudgeAssert,
  transcripts: Transcript[],
  ctx: AssertContext,
): Promise<AssertResult> {
  if (!ctx.judge) {
    return { kind: "judge", status: "skipped", detail: "no judge model configured (advisory)" };
  }
  let passes = 0;
  for (const t of transcripts) {
    const v = await ctx.judge({
      candidate: t.finalText,
      reference: a.reference,
      rubric: a.rubric,
      mode: a.mode,
      samples: a.samples,
    });
    if (v.pass) passes++;
  }
  const ok = passes * 2 > transcripts.length; // majority
  // Advisory unless `gate:true` -- a non-gating judge never fails the case.
  const status: AssertStatus = a.gate ? (ok ? "pass" : "fail") : ok ? "pass" : "skipped";
  return {
    kind: "judge",
    status,
    detail: `${passes}/${transcripts.length} judge verdicts pass${a.gate ? "" : " (advisory)"}`,
  };
}

function evaluateDifferential(a: DifferentialAssert, ctx: AssertContext): AssertResult {
  if (ctx.baselineScore === undefined) {
    return {
      kind: "differential",
      status: "skipped",
      detail: "no baseline (run loom publish to snapshot one)",
    };
  }
  const score = ctx.caseScore ?? 0;
  const ok = score - ctx.baselineScore >= -a.noWorseThan;
  return {
    kind: "differential",
    status: ok ? "pass" : "fail",
    detail: `score ${score.toFixed(2)} vs baseline ${ctx.baselineScore.toFixed(2)} (noWorseThan ${a.noWorseThan})`,
  };
}

/**
 * Evaluate one assertion against a case's sample transcripts (spec §9.5). Trace
 * and output are deterministic; judge is advisory unless `gate:true` and needs an
 * injected judge model; differential compares the case score to a committed
 * baseline (the "vibes" no-regression gate).
 */
// biome-ignore lint/suspicious/useAwait: branches mix sync (trace/output) and async (judge/differential) results; async normalizes the return to Promise<AssertResult>.
export async function evaluateAssertion(
  a: Assertion,
  transcripts: Transcript[],
  ctx: AssertContext = {},
): Promise<AssertResult> {
  switch (a.kind) {
    case "trace":
      return evaluateTrace(a, transcripts);
    case "output":
      return evaluateOutput(a, transcripts);
    case "judge":
      return evaluateJudge(a, transcripts, ctx);
    case "differential":
      return evaluateDifferential(a, ctx);
  }
}
