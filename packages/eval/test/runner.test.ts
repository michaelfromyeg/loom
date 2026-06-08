import { fileURLToPath } from "node:url";
import claudeAdapter from "@michaelfromyeg/loom-adapter-claude";
import type { HarnessDriver, Transcript } from "@michaelfromyeg/loom-adapter-kit";
import { AdapterRegistry } from "@michaelfromyeg/loom-core";
import { EvalFile, type Target } from "@michaelfromyeg/loom-schema";
import { describe, expect, it } from "vitest";
import { discoverEvals, runEval } from "../src/runner";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/sample-plugin", import.meta.url));
const TARGETS: Target[] = ["claude", "codex", "cursor", "copilot", "opencode"];

const unavailable = (target: Target): HarnessDriver => ({
  target,
  available: async () => false,
  run: async () => ({ finalText: "", toolCalls: [], exitCode: 1, raw: "" }),
});

function makeDrivers(
  overrides: Partial<Record<Target, HarnessDriver>>,
): Record<Target, HarnessDriver> {
  const map = {} as Record<Target, HarnessDriver>;
  for (const t of TARGETS) map[t] = overrides[t] ?? unavailable(t);
  return map;
}

const registry = () => new AdapterRegistry().register(claudeAdapter);

describe("discoverEvals", () => {
  it("finds the eval file declared by a component", () => {
    const found = discoverEvals(FIXTURE);
    expect(found).toHaveLength(1);
    expect(found[0].componentLeaf).toBe("code-review");
    expect(found[0].evalFile.harnesses).toContain("claude");
  });
});

describe("runEval", () => {
  const evalFile = EvalFile.parse({
    component: "com.acme/sample-plugin:code-review",
    harnesses: ["claude"],
    cases: [
      {
        name: "finds-the-bug",
        prompt: "Review the change and list bugs.",
        assert: [
          { kind: "trace", toolCalled: "Read" },
          { kind: "output", matches: "(?i)bug" },
        ],
      },
    ],
  });

  it("reports UNTESTED for a harness whose driver is unavailable -- never faked", async () => {
    const report = await runEval({
      evalFile,
      pluginDir: FIXTURE,
      componentLeaf: "code-review",
      registry: registry(),
      drivers: makeDrivers({}),
    });
    expect(report.harnesses).toHaveLength(1);
    expect(report.harnesses[0].status).toBe("untested");
    expect(report.harnesses[0].pass).toBe(false);
  });

  it("evaluates assertions against a tested harness (fake driver, no live model)", async () => {
    const fakeTranscript: Transcript = {
      finalText: "I found a bug in add().",
      toolCalls: [{ name: "Read", args: {}, ts: 0 }],
      exitCode: 0,
      raw: "",
    };
    const drivers = makeDrivers({
      claude: { target: "claude", available: async () => true, run: async () => fakeTranscript },
    });

    const report = await runEval({
      evalFile,
      pluginDir: FIXTURE,
      componentLeaf: "code-review",
      registry: registry(),
      drivers,
    });

    const claude = report.harnesses[0];
    expect(claude.status).toBe("tested");
    expect(claude.pass).toBe(true);
    expect(claude.cases[0].assertions.map((a) => a.status)).toEqual(["pass", "pass"]);
  });
});
