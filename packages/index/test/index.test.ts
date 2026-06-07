import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import claudeAdapter from "@loom/adapter-claude";
import type { HarnessDriver } from "@loom/adapter-kit";
import { AdapterRegistry } from "@loom/core";
import type { EvalReport } from "@loom/eval";
import type { Target } from "@loom/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildIndex,
  computeBadges,
  federate,
  fetchMcpRegistry,
  findPlugin,
  indexFromPluginDirs,
  latestVersion,
  loadIndex,
  mcpServersToEntries,
  pluginsWithBadge,
  publishCheck,
  recordInstall,
  serializeIndex,
} from "../src/index";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/sample-plugin", import.meta.url));
const TARGETS: Target[] = ["claude", "codex", "cursor", "copilot", "opencode"];

const unavailableDrivers = (): Record<Target, HarnessDriver> => {
  const map = {} as Record<Target, HarnessDriver>;
  for (const t of TARGETS) {
    map[t] = {
      target: t,
      available: async () => false,
      run: async () => ({ finalText: "", toolCalls: [], exitCode: 1, raw: "" }),
    };
  }
  return map;
};

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "loom-index-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("badges", () => {
  const testedReport = (): EvalReport => ({
    component: "com.a/p:c",
    harnesses: [
      {
        harness: "claude",
        status: "tested",
        pass: true,
        cases: [{ name: "x", assertions: [], pass: true }],
      },
      { harness: "codex", status: "untested", reason: "no cli", pass: false, cases: [] },
    ],
  });

  it("grants valid from static validation", () => {
    expect(computeBadges({ validPassed: true }).badges).toEqual(["valid"]);
    expect(computeBadges({ validPassed: false }).badges).toEqual([]);
  });

  it("grants tested only when an eval passes on a real harness", () => {
    const r = computeBadges({ validPassed: true, evalReports: [testedReport()] });
    expect(r.badges).toEqual(["valid", "tested"]);
    expect(r.harnessCoverage).toEqual(["claude"]);
  });

  it("does not grant tested when every harness is UNTESTED", () => {
    const allUntested: EvalReport = {
      component: "c",
      harnesses: [{ harness: "claude", status: "untested", reason: "x", pass: false, cases: [] }],
    };
    expect(computeBadges({ validPassed: true, evalReports: [allUntested] }).badges).toEqual([
      "valid",
    ]);
  });
});

describe("index build + client", () => {
  it("groups versions by id and round-trips through the schema", () => {
    const index = buildIndex([
      {
        id: "com.a/p",
        source: "s",
        version: "1.0.0",
        ref: "v1",
        sha: "a",
        badges: ["valid"],
        harnessCoverage: [],
      },
      {
        id: "com.a/p",
        source: "s",
        version: "1.1.0",
        ref: "v1.1",
        sha: "b",
        badges: ["valid", "tested"],
        harnessCoverage: ["claude"],
      },
    ]);
    expect(index.plugins).toHaveLength(1);

    const round = loadIndex(serializeIndex(index));
    const entry = findPlugin(round, "com.a/p");
    if (!entry) throw new Error("entry missing");
    expect(entry.versions).toHaveLength(2);
    expect(latestVersion(entry)?.version).toBe("1.1.0");
    expect(pluginsWithBadge(round, "tested").map((p) => p.id)).toEqual(["com.a/p"]);
  });

  it("builds an index from plugin directories (valid badge)", async () => {
    const index = await indexFromPluginDirs([FIXTURE]);
    const entry = findPlugin(index, "com.acme/sample-plugin");
    if (!entry) throw new Error("entry missing");
    expect(latestVersion(entry)?.badges).toContain("valid");
  });
});

describe("MCP Registry federation", () => {
  it("ingests /v0.1/servers and stamps the source", async () => {
    const fakeFetch = async (url: string) => {
      expect(url).toContain("/v0.1/servers");
      return {
        json: async () => ({
          servers: [
            {
              server: {
                name: "io.github.x/weather",
                version: "1.0.0",
                repository: { url: "https://github.com/x/weather" },
              },
            },
          ],
        }),
      };
    };
    const servers = await fetchMcpRegistry({ fetchImpl: fakeFetch });
    const entries = mcpServersToEntries(servers);
    expect(entries[0].id).toBe("io.github.x/weather");

    const base = buildIndex([]);
    const fed = federate(base, servers, "2026-01-01T00:00:00.000Z");
    expect(fed.plugins).toHaveLength(1);
    expect(fed.federated?.[0]).toEqual({
      source: "mcp-registry",
      ingestedAt: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("telemetry", () => {
  it("increments aggregate installs (opt-in, no per-user data)", () => {
    const index = buildIndex([
      {
        id: "com.a/p",
        source: "s",
        version: "1.0.0",
        ref: "v1",
        sha: "a",
        badges: [],
        harnessCoverage: [],
      },
    ]);
    const after = recordInstall(recordInstall(index, "com.a/p"), "com.a/p");
    expect(findPlugin(after, "com.a/p")?.telemetry?.installs).toBe(2);
  });
});

describe("publish gate", () => {
  const registry = () => new AdapterRegistry().register(claudeAdapter);

  it("passes a valid plugin (evals UNTESTED -> no live run)", async () => {
    const res = await publishCheck(FIXTURE, {
      registry: registry(),
      drivers: unavailableDrivers(),
    });
    expect(res.validPassed).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.badges).toContain("valid");
  });

  it("blocks a plugin that fails static validation", async () => {
    const broken = join(tmp, "broken");
    cpSync(FIXTURE, broken, { recursive: true });
    rmSync(join(broken, "skills/code-review/SKILL.md"));
    const res = await publishCheck(broken, { registry: registry(), drivers: unavailableDrivers() });
    expect(res.validPassed).toBe(false);
    expect(res.ok).toBe(false);
  });
});
