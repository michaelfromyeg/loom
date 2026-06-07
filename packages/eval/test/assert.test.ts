import type { Transcript } from "@loom/adapter-kit";
import { Assertion } from "@loom/schema";
import { describe, expect, it } from "vitest";
import { evaluateAssertion } from "../src/assert";

function tx(toolNames: string[], finalText = "", traceUnavailable = false): Transcript {
  return {
    finalText,
    toolCalls: toolNames.map((name, ts) => ({ name, args: {}, ts })),
    exitCode: 0,
    raw: "",
    traceUnavailable,
  };
}

const trace = (o: Record<string, unknown>) => Assertion.parse({ kind: "trace", ...o });
const output = (o: Record<string, unknown>) => Assertion.parse({ kind: "output", ...o });

describe("trace assertions", () => {
  it("passes when the required tool was called", () => {
    const r = evaluateAssertion(trace({ toolCalled: "Read" }), [tx(["Read", "Edit"])]);
    expect(r.status).toBe("pass");
  });

  it("fails when the required tool was not called", () => {
    const r = evaluateAssertion(trace({ toolCalled: "Read" }), [tx(["Edit"])]);
    expect(r.status).toBe("fail");
  });

  it("fails when a forbidden tool was called", () => {
    const r = evaluateAssertion(trace({ toolNotCalled: "Bash" }), [tx(["Read", "Bash"])]);
    expect(r.status).toBe("fail");
  });

  it("enforces maxCalls and sequence order", () => {
    expect(evaluateAssertion(trace({ maxCalls: 1 }), [tx(["Read", "Edit"])]).status).toBe("fail");
    expect(
      evaluateAssertion(trace({ sequence: ["Read", "Edit"] }), [tx(["Read", "Grep", "Edit"])])
        .status,
    ).toBe("pass");
    expect(
      evaluateAssertion(trace({ sequence: ["Edit", "Read"] }), [tx(["Read", "Edit"])]).status,
    ).toBe("fail");
  });

  it("honors minPassRate across samples", () => {
    const samples = [tx(["Read"]), tx(["Edit"])]; // 1 of 2 call Read
    expect(evaluateAssertion(trace({ toolCalled: "Read", minPassRate: 1.0 }), samples).status).toBe(
      "fail",
    );
    expect(evaluateAssertion(trace({ toolCalled: "Read", minPassRate: 0.5 }), samples).status).toBe(
      "pass",
    );
  });

  it("degrades (does not fake) when the harness has no trace", () => {
    const r = evaluateAssertion(trace({ toolCalled: "Read" }), [tx([], "text", true)]);
    expect(r.status).toBe("degraded");
  });
});

describe("output assertions", () => {
  it("matches a regex on the final text across all samples", () => {
    expect(evaluateAssertion(output({ matches: "(?i)bug" }), [tx([], "Found a BUG")]).status).toBe(
      "pass",
    );
    expect(
      evaluateAssertion(output({ matches: "bug" }), [tx([], "clean"), tx([], "bug")]).status,
    ).toBe("fail");
  });

  it("checks exact equality (trimmed)", () => {
    expect(evaluateAssertion(output({ equals: "ok" }), [tx([], "  ok  ")]).status).toBe("pass");
  });
});

describe("advisory assertions", () => {
  it("reports judge and differential as skipped (Phase 3)", () => {
    expect(evaluateAssertion(Assertion.parse({ kind: "judge", rubric: "r" }), []).status).toBe(
      "skipped",
    );
    expect(evaluateAssertion(Assertion.parse({ kind: "differential" }), []).status).toBe("skipped");
  });
});
