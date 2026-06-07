import {
  allJsonSchemas,
  EvalFile,
  fqid,
  jsonSchemaFor,
  kindOf,
  leafNameOf,
  loadPlugin,
  Marketplace,
  parseDocument,
  refOf,
  validate,
} from "@loom/schema";
import { describe, expect, it } from "vitest";

const owner = "owner: { name: A, namespace: com.a }";

describe("YAML 1.2 parsing (Norway problem)", () => {
  it("keeps no/yes/on/off as strings and only true/false as booleans", () => {
    const doc = parseDocument("a: no\nb: yes\nc: on\nd: off\ne: true\nf: false", "yaml", "x.yaml");
    expect(doc).toEqual({ a: "no", b: "yes", c: "on", d: "off", e: true, f: false });
  });

  it("coerces an unquoted 1.10 to a float, which the string schema then rejects", () => {
    const r = loadPlugin(`name: x\nversion: 1.10\n${owner}\ncomponents: []`, {
      filename: "loom.yaml",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.path === "version")).toBe(true);
  });

  it("keeps a quoted 1.10 as a string", () => {
    const r = loadPlugin(`name: x\nversion: "1.10"\n${owner}\ncomponents: []`, {
      filename: "loom.yaml",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.version).toBe("1.10");
  });

  it("rejects duplicate keys (strict mode)", () => {
    const r = loadPlugin(`name: x\nname: y\nversion: "1.0.0"\n${owner}\ncomponents: []`, {
      filename: "loom.yaml",
    });
    expect(r.ok).toBe(false);
  });

  it("accepts JSON5 input against the same schema", () => {
    const r = loadPlugin(
      `{ name: "x", version: "1.0.0", owner: { name: "A", namespace: "com.a" }, components: [] }`,
      { filename: "loom.json5" },
    );
    expect(r.ok).toBe(true);
  });
});

describe("plugin validation", () => {
  it("parses a valid plugin with two components", () => {
    const r = loadPlugin(
      `name: ok\nversion: "1.0.0"\n${owner}\ncomponents:\n  - skill: skills/x\n  - mcp: mcp/y`,
      { filename: "loom.yaml" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.components).toHaveLength(2);
  });

  it("reports path-precise errors for bad fields and bad components", () => {
    const r = loadPlugin(
      `name: Bad_Name\nversion: "1.0.0"\nowner: { name: A, namespace: nodots }\ncomponents:\n  - mcp: 123\n  - foo: bar`,
      { filename: "loom.yaml" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.issues.map((i) => i.path);
      expect(paths).toContain("name");
      expect(paths).toContain("owner.namespace");
      expect(paths).toContain("components[1]"); // no kind key
      expect(r.issues.some((i) => i.path.startsWith("components[0]"))).toBe(true); // mcp must be string
    }
  });

  it("rejects a component with conflicting kind keys", () => {
    const r = loadPlugin(
      `name: ok\nversion: "1.0.0"\n${owner}\ncomponents:\n  - { skill: a, mcp: b }`,
      { filename: "loom.yaml" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].message).toMatch(/conflicting kind keys/);
  });
});

describe("component helpers", () => {
  it("derives kind, ref, leaf, and fqid", () => {
    const c = { skill: "skills/code-review" } as never;
    expect(kindOf(c)).toBe("skill");
    expect(refOf(c)).toBe("skills/code-review");
    expect(leafNameOf(c)).toBe("code-review");
    expect(fqid("com.acme", "tools", "code-review")).toBe("com.acme/tools:code-review");
  });
});

describe("other manifests", () => {
  it("validates a marketplace", () => {
    const r = validate(Marketplace, {
      name: "m",
      owner: { name: "A", namespace: "com.a" },
      plugins: [{ plugin: "github:a/b" }],
    });
    expect(r.ok).toBe(true);
  });

  it("parses discriminated eval assertions and applies defaults", () => {
    const r = validate(EvalFile, {
      component: "com.a/b:c",
      harnesses: ["claude"],
      cases: [{ name: "n", prompt: "p", assert: [{ kind: "judge", rubric: "r" }] }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const a = r.value.cases[0].assert[0];
      expect(a.kind).toBe("judge");
      if (a.kind === "judge") {
        expect(a.mode).toBe("pairwise");
        expect(a.samples).toBe(3);
      }
    }
  });
});

describe("JSON Schema export", () => {
  it("emits a draft-2020-12 schema per manifest", () => {
    expect(jsonSchemaFor("loom.yaml")).toBeTruthy();
    expect(Object.keys(allJsonSchemas()).sort()).toEqual(
      ["cases.yaml", "loom.lock", "loom.yaml", "marketplace.yaml"].sort(),
    );
  });
});
