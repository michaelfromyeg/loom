import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import claudeAdapter from "@michaelfromyeg/weft-adapter-claude";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdapterRegistry,
  build,
  buildMarketplace,
  importNativePlugin,
  install,
  lint,
  uninstall,
} from "../src/index";

const PLUGIN = fileURLToPath(new URL("../../../fixtures/sample-plugin", import.meta.url));
const MARKETPLACE = fileURLToPath(new URL("../../../fixtures/sample-marketplace", import.meta.url));
const registry = () => new AdapterRegistry().register(claudeAdapter);

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "weft-import-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("weft import (reverse-compile native -> Weft)", () => {
  it("round-trips a Claude plugin back into a valid Weft plugin", async () => {
    // Weft -> Claude plugin.
    const built = join(tmp, "built");
    await build({ pluginDir: PLUGIN, outDir: built, registry: registry(), targets: ["claude"] });
    const claudePlugin = join(built, "claude/plugins/sample-plugin");

    // Claude plugin -> Weft.
    const out = join(tmp, "imported");
    const res = importNativePlugin({
      dir: claudePlugin,
      adapter: claudeAdapter,
      outDir: out,
      namespace: "com.acme",
    });
    expect(res.kind).toBe("plugin");
    expect(existsSync(join(out, "weft.yaml"))).toBe(true);

    // The imported plugin is valid and has both components back.
    const linted = lint(out);
    expect(linted.diagnostics.hasErrors).toBe(false);
    expect(linted.id).toBe("com.acme/sample-plugin");
    expect(Object.keys(linted.aliases).sort()).toEqual(["code-review", "weather"]);
    // The MCP server.json was reconstructed from the inline run config.
    expect(existsSync(join(out, "mcp/weather/server.json"))).toBe(true);
  });

  it("throws for an adapter that does not support import", () => {
    const noImport = { ...claudeAdapter, importNative: undefined };
    expect(() =>
      importNativePlugin({ dir: PLUGIN, adapter: noImport, outDir: join(tmp, "x") }),
    ).toThrow(/does not support import/);
  });

  it("throws when the directory is not the adapter's native format", () => {
    const empty = mkdtempSync(join(tmpdir(), "weft-empty-"));
    expect(() =>
      importNativePlugin({ dir: empty, adapter: claudeAdapter, outDir: join(tmp, "y") }),
    ).toThrow(/no claude/);
  });

  it("imports a Claude marketplace into a marketplace.yaml", async () => {
    const built = join(tmp, "mkt");
    await buildMarketplace({
      marketplaceDir: MARKETPLACE,
      outDir: built,
      registry: registry(),
      targets: ["claude"],
    });
    const out = join(tmp, "mkt-import");
    const res = importNativePlugin({
      dir: join(built, "claude"),
      adapter: claudeAdapter,
      outDir: out,
      namespace: "com.acme",
    });
    expect(res.kind).toBe("marketplace");
    const yaml = readFileSync(join(out, "marketplace.yaml"), "utf8");
    expect(yaml).toContain("name: acme-tools");
    expect(yaml).toContain("code-tools");
  });
});

describe("weft uninstall", () => {
  it("removes everything install placed and deletes the lockfile", async () => {
    const pluginDir = join(tmp, "u-plugin");
    const sandbox = join(tmp, "u-sandbox");
    cpSync(PLUGIN, pluginDir, { recursive: true });
    await install({ pluginDir, scope: "project", cwd: sandbox, registry: registry() });

    expect(
      existsSync(join(sandbox, ".claude/plugins/sample-plugin/.claude-plugin/plugin.json")),
    ).toBe(true);
    // The lock lives at the install target (sandbox), not the source plugin dir.
    const res = uninstall({ dir: sandbox });
    expect(res.removed.length).toBe(3);
    expect(existsSync(join(sandbox, ".claude/plugins/sample-plugin"))).toBe(false);
    expect(existsSync(join(sandbox, "weft.lock"))).toBe(false);
  });

  it("errors when there is no lockfile", () => {
    expect(() => uninstall({ dir: join(tmp, "no-lock") })).toThrow(/nothing to uninstall/);
  });
});
