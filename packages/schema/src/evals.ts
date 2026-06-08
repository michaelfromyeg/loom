import { z } from "zod";
import { Target } from "./plugin";

const TraceAssert = z.object({
  kind: z.literal("trace"),
  toolCalled: z.string().optional(),
  toolNotCalled: z.string().optional(),
  /** Required call order. */
  sequence: z.array(z.string()).optional(),
  /** Path-efficiency ceiling. */
  maxCalls: z.number().optional(),
  minPassRate: z.number().min(0).max(1).default(1.0),
});
export type TraceAssert = z.infer<typeof TraceAssert>;

const OutputAssert = z.object({
  kind: z.literal("output"),
  equals: z.string().optional(),
  matches: z.string().optional(),
  jsonSchema: z.string().optional(),
  tolerance: z.number().optional(),
  /** Fraction of `samples` that must match; <1 tolerates LLM variance. */
  minPassRate: z.number().min(0).max(1).default(1.0),
});
export type OutputAssert = z.infer<typeof OutputAssert>;

const JudgeAssert = z.object({
  kind: z.literal("judge"),
  rubric: z.string(),
  mode: z.enum(["absolute", "pairwise"]).default("pairwise"),
  /** Required for pairwise. */
  reference: z.string().optional(),
  samples: z.number().default(3),
  /** Absolute mode only. */
  threshold: z.number().optional(),
  /** Advisory unless true. */
  gate: z.boolean().default(false),
});
export type JudgeAssert = z.infer<typeof JudgeAssert>;

const DifferentialAssert = z.object({
  kind: z.literal("differential"),
  baseline: z.string().default("last-release"),
  noWorseThan: z.number().default(0.0),
});
export type DifferentialAssert = z.infer<typeof DifferentialAssert>;

export const Assertion = z.discriminatedUnion("kind", [
  TraceAssert,
  OutputAssert,
  JudgeAssert,
  DifferentialAssert,
]);
export type Assertion = z.infer<typeof Assertion>;

export const Case = z.object({
  name: z.string(),
  prompt: z.string(),
  /** Shell, run before. */
  setup: z.string().optional(),
  /** Shell, exit 0 = pass (post-state check). */
  verify: z.string().optional(),
  cleanup: z.string().optional(),
  samples: z.number().default(1),
  assert: z.array(Assertion),
});
export type Case = z.infer<typeof Case>;

/** `cases.yaml` — evals for one component. */
export const EvalFile = z.object({
  /** Fully-qualified component id. */
  component: z.string(),
  /** Which harnesses to run; others reported UNTESTED. */
  harnesses: z.array(Target),
  cases: z.array(Case),
});
export type EvalFile = z.infer<typeof EvalFile>;
