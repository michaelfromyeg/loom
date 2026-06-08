import { fileURLToPath } from "node:url";
import claudeAdapter from "@michaelfromyeg/weft-adapter-claude";
import type { HarnessDriver, Transcript } from "@michaelfromyeg/weft-adapter-kit";
import { AdapterRegistry } from "@michaelfromyeg/weft-core";
import type { Target } from "@michaelfromyeg/weft-schema";
import { describe, expect, it } from "vitest";
import { type DiscoveredEval, discoverEvals, runEval } from "../src/runner";

const ALL_KINDS = fileURLToPath(new URL("../../../fixtures/all-kinds", import.meta.url));
const TARGETS: Target[] = ["claude", "codex", "cursor", "copilot", "opencode"];
const registry = () => new AdapterRegistry().register(claudeAdapter);

const unavailable = (target: Target): HarnessDriver => ({
  target,
  available: async () => false,
  run: async () => ({ finalText: "", toolCalls: [], exitCode: 1, raw: "" }),
});

/** A claude stub that is "available" and returns a fixed transcript. */
function claudeStub(transcript: Transcript): Record<Target, HarnessDriver> {
  const map = {} as Record<Target, HarnessDriver>;
  for (const t of TARGETS) map[t] = unavailable(t);
  map.claude = { target: "claude", available: async () => true, run: async () => transcript };
  return map;
}

const byLeaf = (): Record<string, DiscoveredEval> =>
  Object.fromEntries(discoverEvals(ALL_KINDS).map((e) => [e.componentLeaf, e]));

describe("evals cover every component kind", () => {
  it("discovers an eval for all six kinds, including passthrough", () => {
    const leaves = discoverEvals(ALL_KINDS)
      .map((e) => e.componentLeaf)
      .sort();
    expect(leaves).toEqual(
      ["demo-agent", "demo-command", "demo-hook", "demo-mcp", "demo-pass", "demo-skill"].sort(),
    );
  });

  it("runs a prompt-driven kind (agent) via trace + output assertions", async () => {
    const agent = byLeaf()["demo-agent"];
    const report = await runEval({
      evalFile: agent.evalFile,
      pluginDir: ALL_KINDS,
      componentLeaf: agent.componentLeaf,
      registry: registry(),
      // The sub-agent shows up as a Task tool call; the model says "done".
      drivers: claudeStub({
        finalText: "done",
        toolCalls: [{ name: "Task", args: {}, ts: 0 }],
        exitCode: 0,
        raw: "",
      }),
    });
    expect(report.harnesses[0].status).toBe("tested");
    expect(report.harnesses[0].pass).toBe(true);
  });

  it("runs an event-driven kind (hook) via the setup+verify shell path", async () => {
    const hook = byLeaf()["demo-hook"];
    // The transcript is irrelevant: the case has no trace/output asserts, only verify.
    const report = await runEval({
      evalFile: hook.evalFile,
      pluginDir: ALL_KINDS,
      componentLeaf: hook.componentLeaf,
      registry: registry(),
      drivers: claudeStub({ finalText: "", toolCalls: [], exitCode: 0, raw: "" }),
    });
    expect(report.harnesses[0].pass).toBe(true);
    expect(report.harnesses[0].cases[0].verifyPassed).toBe(true);
  });
});
