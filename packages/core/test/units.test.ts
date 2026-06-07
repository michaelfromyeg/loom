import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import claudeAdapter from "@loom/adapter-claude";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdapterRegistry,
  checkMinVersion,
  gitInfo,
  hasMarketplaceManifest,
  install,
  lint,
  loadMarketplaceDir,
  parseSource,
  readLock,
  resolvePluginRef,
  writeLock,
} from "../src/index";

const PLUGIN = fileURLToPath(new URL("../../../fixtures/sample-plugin", import.meta.url));
const MARKETPLACE = fileURLToPath(new URL("../../../fixtures/sample-marketplace", import.meta.url));
const registry = () => new AdapterRegistry().register(claudeAdapter);

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "loom-units-"));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("checkMinVersion", () => {
  it("returns null when no minimum is specified", () => {
    expect(checkMinVersion(undefined)).toBeNull();
  });

  it("returns null when the running Loom satisfies the minimum", () => {
    expect(checkMinVersion("0.0.1")).toBeNull();
  });

  it("returns a message naming the requirement when the minimum is too high", () => {
    const msg = checkMinVersion("9.0.0");
    expect(msg).not.toBeNull();
    expect(msg).toContain("9.0.0");
  });

  it("coerces a loose-but-resolvable minimum rather than rejecting it", () => {
    // semver.coerce("not-a-version") finds no digits -> invalid semver message.
    const msg = checkMinVersion("not-a-version");
    expect(msg).toBe('loom_min_version "not-a-version" is not a valid semver');
  });
});

describe("parseSource", () => {
  it("treats github: prefix and bare owner/repo as github", () => {
    expect(parseSource("github:a/b")).toEqual({ kind: "github", repo: "a/b" });
    expect(parseSource("a/b")).toEqual({ kind: "github", repo: "a/b" });
  });

  it("parses npm: sources", () => {
    expect(parseSource("npm:x")).toEqual({ kind: "npm", pkg: "x" });
  });

  it("parses https and scp-style git urls", () => {
    expect(parseSource("https://github.com/a/b.git")).toEqual({
      kind: "git",
      url: "https://github.com/a/b.git",
    });
    expect(parseSource("git@github.com:a/b.git")).toEqual({
      kind: "git",
      url: "git@github.com:a/b.git",
    });
  });

  it("parses relative and absolute paths as local", () => {
    expect(parseSource("./x")).toEqual({ kind: "local", path: "./x" });
    expect(parseSource("/abs/x")).toEqual({ kind: "local", path: "/abs/x" });
  });
});

describe("resolvePluginRef", () => {
  it("refuses remote sources as a Phase 1 stub", () => {
    expect(() => resolvePluginRef("github:a/b", tmp)).toThrow(/Phase 1|local/);
  });

  it("loads a local plugin fixture into a FetchedPlugin", () => {
    const fb = resolvePluginRef(PLUGIN, tmp);
    expect(fb.plugin.name).toBe("sample-plugin");
    expect(fb.root).toBe(PLUGIN);
  });
});

describe("gitInfo", () => {
  it("resolves to a ref and sha as strings", async () => {
    const info = await gitInfo(PLUGIN);
    expect(typeof info.ref).toBe("string");
    expect(typeof info.sha).toBe("string");
  });
});

describe("lockfile round-trip", () => {
  it("writes then reads back an identical lockfile, and returns null when absent", async () => {
    // Produce a guaranteed-valid Lockfile by running a real install.
    const pluginDir = join(tmp, "lock-plugin");
    cpSync(PLUGIN, pluginDir, { recursive: true });
    const { lockfile } = await install({
      pluginDir,
      scope: "project",
      cwd: join(tmp, "lock-sandbox"),
      registry: registry(),
      now: "2026-01-01T00:00:00.000Z",
    });

    const dir = join(tmp, "lock-roundtrip");
    cpSync(pluginDir, dir, { recursive: true });
    rmSync(join(dir, "loom.lock")); // drop the install-written lock; write our own.
    writeLock(dir, lockfile);
    expect(readLock(dir)).toEqual(lockfile);

    const empty = mkdtempSync(join(tmpdir(), "loom-units-empty-"));
    expect(readLock(empty)).toBeNull();
    rmSync(empty, { recursive: true, force: true });
  });
});

describe("marketplace loader", () => {
  it("detects a marketplace manifest only when one is present", () => {
    expect(hasMarketplaceManifest(MARKETPLACE)).toBe(true);
    expect(hasMarketplaceManifest(PLUGIN)).toBe(false);
  });

  it("loads the marketplace manifest by name", () => {
    const loaded = loadMarketplaceDir(MARKETPLACE);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.marketplace.name).toBe("acme-tools");
  });

  it("fails on a directory with no marketplace manifest", () => {
    const empty = mkdtempSync(join(tmpdir(), "loom-units-mp-"));
    expect(loadMarketplaceDir(empty).ok).toBe(false);
    rmSync(empty, { recursive: true, force: true });
  });
});

describe("validatePlugin via lint", () => {
  it("flags a missing server.json as an error", () => {
    const broken = join(tmp, "missing-server");
    cpSync(PLUGIN, broken, { recursive: true });
    rmSync(join(broken, "mcp/weather/server.json"));
    expect(lint(broken).diagnostics.hasErrors).toBe(true);
  });

  it("flags an unparseable server.json as an error", () => {
    const broken = join(tmp, "bad-server-json");
    cpSync(PLUGIN, broken, { recursive: true });
    const serverJson = join(broken, "mcp/weather/server.json");
    writeFileSync(serverJson, "{ this is not valid json");
    const diags = lint(broken).diagnostics;
    expect(diags.hasErrors).toBe(true);
    expect(diags.errors.some((d) => /not valid JSON/.test(d.message))).toBe(true);
  });
});
