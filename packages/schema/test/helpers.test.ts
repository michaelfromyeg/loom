import {
  ALL_TARGETS,
  detectComponentKind,
  kindOf,
  leafNameOf,
  loadManifest,
  Marketplace,
  refOf,
  targetsOf,
} from "@michaelfromyeg/loom-schema";
import { describe, expect, it } from "vitest";

describe("targetsOf", () => {
  it("defaults to all targets when none are specified", () => {
    const c = { skill: "s" } as never;
    expect(targetsOf(c, ALL_TARGETS)).toEqual(ALL_TARGETS);
  });

  it("returns the explicit targets list when present", () => {
    const c = { skill: "s", targets: ["claude"] } as never;
    expect(targetsOf(c, ALL_TARGETS)).toEqual(["claude"]);
  });

  it("returns the single target for a passthrough", () => {
    const c = { passthrough: "p", target: "codex", kind: "hook" } as never;
    expect(targetsOf(c, ALL_TARGETS)).toEqual(["codex"]);
  });
});

describe("detectComponentKind", () => {
  it("detects a single kind key", () => {
    expect(detectComponentKind({ skill: "s" })).toEqual({ ok: true, kind: "skill" });
  });

  it("fails when no kind key is present", () => {
    const r = detectComponentKind({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no kind key/);
  });

  it("fails on conflicting kind keys", () => {
    const r = detectComponentKind({ skill: "a", mcp: "b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/conflicting kind keys/);
  });

  it("fails on a non-object", () => {
    const r = detectComponentKind(5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/must be an object/);
  });
});

describe("kindOf / refOf / leafNameOf", () => {
  it("derives kind, ref, and leaf for an mcp component", () => {
    const c = { mcp: "mcp/weather" } as never;
    expect(kindOf(c)).toBe("mcp");
    expect(refOf(c)).toBe("mcp/weather");
    expect(leafNameOf(c)).toBe("weather");
  });

  it("derives kind, ref, and leaf for a passthrough component", () => {
    const c = { passthrough: "hooks/pre.sh", target: "codex", kind: "hook" } as never;
    expect(kindOf(c)).toBe("passthrough");
    expect(refOf(c)).toBe("hooks/pre.sh");
    expect(leafNameOf(c)).toBe("pre");
  });
});

describe("loadManifest", () => {
  it("parses a valid marketplace manifest", () => {
    const r = loadManifest(
      Marketplace,
      "name: m\nowner: {name: A, namespace: com.a}\nplugins: []",
      { filename: "marketplace.yaml" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe("m");
      expect(r.value.plugins).toEqual([]);
    }
  });

  it("returns a parse-error issue for malformed input", () => {
    const r = loadManifest(Marketplace, "{ : bad", { filename: "x.json5" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0].message).toMatch(/parse error/);
    }
  });
});
