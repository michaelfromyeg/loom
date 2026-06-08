import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import claudeAdapter from "@michaelfromyeg/weft-adapter-claude";
import type { HarnessDriver, Transcript } from "@michaelfromyeg/weft-adapter-kit";
import { AdapterRegistry } from "@michaelfromyeg/weft-core";
import { EvalFile, type Target } from "@michaelfromyeg/weft-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runEval, writeBaseline } from "../src/index";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/sample-plugin", import.meta.url));
const COMPONENT = "com.acme/sample-plugin:code-review";
const TARGETS: Target[] = ["claude", "codex", "cursor", "copilot", "opencode"];
const registry = () => new AdapterRegistry().register(claudeAdapter);

function driversWithClaude(claude: HarnessDriver): Record<Target, HarnessDriver> {
  const map = {} as Record<Target, HarnessDriver>;
  for (const t of TARGETS) {
    map[t] =
      t === "claude"
        ? claude
        : {
            target: t,
            available: async () => false,
            run: async () => ({ finalText: "", toolCalls: [], exitCode: 1, raw: "" }),
          };
  }
  return map;
}

function fakeClaude(transcript: Transcript): HarnessDriver {
  return { target: "claude", available: async () => true, run: async () => transcript };
}

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "weft-evp3-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function planted(score: number): string {
  const dir = mkdtempSync(join(tmp, "plugin-"));
  cpSync(FIXTURE, dir, { recursive: true });
  writeBaseline(dir, COMPONENT, "claude", { version: "0.1.0", score });
  return dir;
}

const evalFile = (extra: object[] = []) =>
  EvalFile.parse({
    component: COMPONENT,
    harnesses: ["claude"],
    cases: [
      {
        name: "review",
        prompt: "review",
        assert: [
          { kind: "trace", toolCalled: "Read" },
          { kind: "differential", noWorseThan: 0 },
          ...extra,
        ],
      },
    ],
  });

describe("differential evals block a regression (spec §9.5)", () => {
  it("FAILS the case when the score drops below the committed baseline", async () => {
    const pluginDir = planted(1.0);
    // Fake driver that does NOT call Read -> trace fails -> caseScore 0 -> regression.
    const report = await runEval({
      evalFile: evalFile(),
      pluginDir,
      componentLeaf: "code-review",
      registry: registry(),
      drivers: driversWithClaude(
        fakeClaude({ finalText: "did nothing", toolCalls: [], exitCode: 0, raw: "" }),
      ),
    });
    const claude = report.harnesses[0];
    expect(claude.status).toBe("tested");
    expect(claude.pass).toBe(false);
    expect(claude.cases[0].assertions.find((a) => a.kind === "differential")?.status).toBe("fail");
  });

  it("passes when the score holds the baseline (judge advisory, no model)", async () => {
    const pluginDir = planted(1.0);
    const report = await runEval({
      evalFile: evalFile([{ kind: "judge", rubric: "good review?" }]),
      pluginDir,
      componentLeaf: "code-review",
      registry: registry(),
      drivers: driversWithClaude(
        fakeClaude({
          finalText: "found a bug",
          toolCalls: [{ name: "Read", args: {}, ts: 0 }],
          exitCode: 0,
          raw: "",
        }),
      ),
    });
    const claude = report.harnesses[0];
    expect(claude.pass).toBe(true);
    expect(claude.cases[0].assertions.find((a) => a.kind === "differential")?.status).toBe("pass");
    // judge with no injected model is advisory -> skipped, not failing.
    expect(claude.cases[0].assertions.find((a) => a.kind === "judge")?.status).toBe("skipped");
  });
});
