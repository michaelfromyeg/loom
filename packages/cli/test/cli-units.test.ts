import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import claudeAdapter from "@michaelfromyeg/weft-adapter-claude";
import { AdapterRegistry, build, type Diagnostic, lint } from "@michaelfromyeg/weft-core";
import { afterAll, describe, expect, it } from "vitest";
import { parseList, parseTargets } from "../src/registry";
import { printDiagnostics, printTrustSummary } from "../src/report";
import { scaffoldPlugin } from "../src/scaffold";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/sample-plugin", import.meta.url));

let tmp: string;
afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/** Replace the console sinks with a collector for the duration of `fn`. */
function captureConsole(fn: () => void): string {
  const lines: string[] = [];
  const sink = (...args: unknown[]): void => {
    lines.push(args.map(String).join(" "));
  };
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = sink;
  console.error = sink;
  console.warn = sink;
  try {
    fn();
  } finally {
    console.log = orig.log;
    console.error = orig.error;
    console.warn = orig.warn;
  }
  return lines.join("\n");
}

describe("scaffoldPlugin", () => {
  it("writes a manifest + sample skill and reports the kebab name and files", () => {
    tmp = mkdtempSync(join(tmpdir(), "weft-cli-scaffold-"));
    const result = scaffoldPlugin({ dir: tmp, name: "My Plugin", namespace: "com.test" });

    expect(result.name).toBe("my-plugin");
    expect(result.files).toContain("weft.yaml");
    expect(result.files).toContain(join("skills", "hello", "SKILL.md"));

    expect(existsSync(join(tmp, "weft.yaml"))).toBe(true);
    expect(existsSync(join(tmp, "skills", "hello", "SKILL.md"))).toBe(true);
  });

  it("refuses to clobber an existing plugin", () => {
    expect(() => scaffoldPlugin({ dir: tmp, name: "My Plugin", namespace: "com.test" })).toThrow(
      /already exists/,
    );
  });

  it("emits a manifest that lints clean", () => {
    const r = lint(tmp);
    expect(r.diagnostics.hasErrors).toBe(false);
    expect(r.id).toBe("com.test/my-plugin");
  });
});

describe("parseList / parseTargets", () => {
  it("treats undefined and empty as no value", () => {
    expect(parseList(undefined)).toBeUndefined();
    expect(parseList("")).toBeUndefined();
  });

  it("trims and drops empties from a comma list", () => {
    expect(parseList("a, b ,c")).toEqual(["a", "b", "c"]);
  });

  it("parses targets as a typed list", () => {
    expect(parseTargets("claude,codex")).toEqual(["claude", "codex"]);
  });
});

describe("report output", () => {
  it("prints a trust summary covering components and mcp servers", async () => {
    const out = await build({
      pluginDir: FIXTURE,
      outDir: mkdtempSync(join(tmpdir(), "weft-cli-build-")),
      registry: new AdapterRegistry().register(claudeAdapter),
    });

    const text = captureConsole(() => printTrustSummary(out.result));
    expect(text).toContain("Trust summary for com.acme/sample-plugin@0.1.0");
    expect(text).toContain("mcp servers that will run: 1");
    expect(text).toContain("Acme Tools");
  });

  it("prints each diagnostic's message", () => {
    const diags: Diagnostic[] = [
      { severity: "error", where: "components[0].mcp", message: "missing server.json" },
      { severity: "warning", where: "owner.email", message: "email is recommended" },
    ];

    const text = captureConsole(() => printDiagnostics(diags));
    expect(text).toContain("missing server.json");
    expect(text).toContain("email is recommended");
    expect(text).toContain("components[0].mcp");
  });
});
