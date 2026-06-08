import { fileURLToPath } from "node:url";
import claudeAdapter from "@michaelfromyeg/weft-adapter-claude";
import type { HarnessDriver, Transcript } from "@michaelfromyeg/weft-adapter-kit";
import { AdapterRegistry } from "@michaelfromyeg/weft-core";
import { EvalFile, type Target } from "@michaelfromyeg/weft-schema";
import { describe, expect, it } from "vitest";
import { compareVersions } from "../src/compare";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/sample-plugin", import.meta.url));
const registry = () => new AdapterRegistry().register(claudeAdapter);

const evalFile = EvalFile.parse({
  component: "com.acme/sample-plugin:code-review",
  harnesses: ["claude"],
  cases: [{ name: "demo", prompt: "say something", assert: [] }],
});

function claudeStub(text: string): Partial<Record<Target, HarnessDriver>> {
  const tx: Transcript = { finalText: text, toolCalls: [], exitCode: 0, raw: "" };
  return { claude: { target: "claude", available: async () => true, run: async () => tx } };
}

describe("compareVersions (vibes A/B)", () => {
  it("captures the before and after transcript for each case on a runnable harness", async () => {
    const reports = await compareVersions({
      evalFile,
      componentLeaf: "code-review",
      beforeDir: FIXTURE,
      afterDir: FIXTURE,
      registry: registry(),
      drivers: claudeStub("hello from the model"),
    });
    expect(reports).toHaveLength(1);
    expect(reports[0].harness).toBe("claude");
    expect(reports[0].cases[0]).toMatchObject({
      name: "demo",
      before: "hello from the model",
      after: "hello from the model",
    });
  });

  it("skips a harness with no available driver (no faked comparison)", async () => {
    const reports = await compareVersions({
      evalFile,
      componentLeaf: "code-review",
      beforeDir: FIXTURE,
      afterDir: FIXTURE,
      registry: registry(),
      drivers: {},
    });
    expect(reports).toHaveLength(0);
  });
});
