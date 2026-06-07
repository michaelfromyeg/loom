import type { Target } from "@loom/schema";

export interface ToolCall {
  name: string;
  args: unknown;
  result?: unknown;
  ts: number;
}

/** Normalized result of one headless harness run. */
export interface Transcript {
  finalText: string;
  toolCalls: ToolCall[];
  exitCode: number;
  /** Raw stdout/json for debugging + baselines. */
  raw: string;
  /**
   * True when this harness exposes no structured tool-call trace, so `toolCalls`
   * is empty by limitation rather than because none happened. `trace` assertions
   * degrade to `output` assertions in this case (spec §14).
   */
  traceUnavailable?: boolean;
}

export interface RunOptions {
  prompt: string;
  cwd: string;
  config?: Record<string, string>;
  timeoutMs?: number;
}

export interface HarnessDriver {
  readonly target: Target;
  /** CLI installed AND headless-capable on this machine. Never throws. */
  available(): Promise<boolean>;
  run(opts: RunOptions): Promise<Transcript>;
}
