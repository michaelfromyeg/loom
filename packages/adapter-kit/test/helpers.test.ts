import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { artifact } from "../src/artifact";
import { parseFrontmatter, withFrontmatter } from "../src/frontmatter";
import { expandTilde, resolveUnder } from "../src/paths";

describe("expandTilde", () => {
  it("expands a bare tilde to the home directory", () => {
    expect(expandTilde("~")).toBe(homedir());
  });

  it("expands a tilde-prefixed path under the home directory", () => {
    expect(expandTilde("~/x")).toBe(join(homedir(), "x"));
  });

  it("leaves an absolute path untouched", () => {
    expect(expandTilde("/abs")).toBe("/abs");
  });

  it("leaves a relative path untouched", () => {
    expect(expandTilde("rel")).toBe("rel");
  });
});

describe("resolveUnder", () => {
  it("joins a relative path under the base", () => {
    expect(resolveUnder("/base", "rel")).toBe("/base/rel");
  });

  it("returns an absolute path unchanged", () => {
    expect(resolveUnder("/base", "/abs")).toBe("/abs");
  });

  it("expands a tilde path to the home directory, ignoring the base", () => {
    expect(resolveUnder("/base", "~/x")).toBe(join(homedir(), "x"));
  });
});

describe("parseFrontmatter", () => {
  it("splits a YAML frontmatter block from the body", () => {
    const { data, body } = parseFrontmatter("---\nname: x\ndescription: y\n---\nBODY");
    expect(data).toEqual({ name: "x", description: "y" });
    expect(body).toContain("BODY");
  });

  it("returns empty data and the whole input as body when there is no frontmatter", () => {
    expect(parseFrontmatter("no frontmatter")).toEqual({ data: {}, body: "no frontmatter" });
  });
});

describe("withFrontmatter", () => {
  it("round-trips data and body through parseFrontmatter", () => {
    const { data, body } = parseFrontmatter(withFrontmatter({ name: "x" }, "Body"));
    expect(data.name).toBe("x");
    expect(body).toContain("Body");
  });
});

describe("artifact", () => {
  it("builds an artifact from a relPath and contents", () => {
    expect(artifact("p", "c")).toEqual({ relPath: "p", contents: "c" });
  });

  it("includes kind and executable options when provided", () => {
    expect(artifact("p", "c", { kind: "skill", executable: true })).toEqual({
      relPath: "p",
      contents: "c",
      kind: "skill",
      executable: true,
    });
  });
});
