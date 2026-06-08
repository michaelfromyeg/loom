import type { Transcript } from "@michaelfromyeg/loom-adapter-kit";
import { Assertion } from "@michaelfromyeg/loom-schema";
import { describe, expect, it } from "vitest";
import { type AssertContext, evaluateAssertion } from "../src/assert";

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
const status = async (a: Assertion, t: Transcript[], ctx?: AssertContext) =>
  (await evaluateAssertion(a, t, ctx)).status;

describe("trace assertions", () => {
  it("passes when the required tool was called", async () => {
    expect(await status(trace({ toolCalled: "Read" }), [tx(["Read", "Edit"])])).toBe("pass");
  });
  it("fails when the required tool was not called", async () => {
    expect(await status(trace({ toolCalled: "Read" }), [tx(["Edit"])])).toBe("fail");
  });
  it("fails when a forbidden tool was called", async () => {
    expect(await status(trace({ toolNotCalled: "Bash" }), [tx(["Read", "Bash"])])).toBe("fail");
  });
  it("enforces maxCalls and sequence order", async () => {
    expect(await status(trace({ maxCalls: 1 }), [tx(["Read", "Edit"])])).toBe("fail");
    expect(
      await status(trace({ sequence: ["Read", "Edit"] }), [tx(["Read", "Grep", "Edit"])]),
    ).toBe("pass");
    expect(await status(trace({ sequence: ["Edit", "Read"] }), [tx(["Read", "Edit"])])).toBe(
      "fail",
    );
  });
  it("honors minPassRate across samples", async () => {
    const samples = [tx(["Read"]), tx(["Edit"])];
    expect(await status(trace({ toolCalled: "Read", minPassRate: 1.0 }), samples)).toBe("fail");
    expect(await status(trace({ toolCalled: "Read", minPassRate: 0.5 }), samples)).toBe("pass");
  });
  it("degrades (does not fake) when the harness has no trace", async () => {
    expect(await status(trace({ toolCalled: "Read" }), [tx([], "text", true)])).toBe("degraded");
  });
});

describe("output assertions", () => {
  it("matches a case-insensitive regex with a leading (?i) inline flag", async () => {
    expect(await status(output({ matches: "(?i)bug" }), [tx([], "Found a BUG")])).toBe("pass");
    expect(await status(output({ matches: "bug" }), [tx([], "clean"), tx([], "bug")])).toBe("fail");
  });
  it("checks exact equality (trimmed)", async () => {
    expect(await status(output({ equals: "ok" }), [tx([], "  ok  ")])).toBe("pass");
  });
});

describe("judge assertions", () => {
  const judgeAssert = (o: Record<string, unknown>) =>
    Assertion.parse({ kind: "judge", rubric: "good?", ...o });

  it("is skipped (advisory) when no judge model is configured", async () => {
    expect(await status(judgeAssert({}), [tx([], "x")])).toBe("skipped");
  });
  it("passes when the injected judge approves (majority)", async () => {
    const judge = async () => ({ pass: true });
    expect(await status(judgeAssert({ gate: true }), [tx([], "x")], { judge })).toBe("pass");
  });
  it("gates a failure only when gate:true; otherwise advisory", async () => {
    const judge = async () => ({ pass: false });
    expect(await status(judgeAssert({ gate: true }), [tx([], "x")], { judge })).toBe("fail");
    expect(await status(judgeAssert({ gate: false }), [tx([], "x")], { judge })).toBe("skipped");
  });
});

describe("differential assertions (no-regression gate)", () => {
  const diff = (o: Record<string, unknown> = {}) => Assertion.parse({ kind: "differential", ...o });

  it("is skipped without a baseline", async () => {
    expect(await status(diff(), [], { caseScore: 1 })).toBe("skipped");
  });
  it("passes when the score does not regress past the threshold", async () => {
    expect(await status(diff({ noWorseThan: 0 }), [], { caseScore: 1.0, baselineScore: 1.0 })).toBe(
      "pass",
    );
    expect(
      await status(diff({ noWorseThan: 0.2 }), [], { caseScore: 0.85, baselineScore: 1.0 }),
    ).toBe("pass");
  });
  it("FAILS (blocks) on a regression below the threshold", async () => {
    expect(await status(diff({ noWorseThan: 0 }), [], { caseScore: 0.5, baselineScore: 1.0 })).toBe(
      "fail",
    );
  });
});
