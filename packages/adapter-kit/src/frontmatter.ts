import * as YAML from "yaml";

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Split a Markdown document (SKILL.md, agent .md, rules .mdc) into its YAML
 * frontmatter and body. Returns empty data when there is no frontmatter block.
 */
export function parseFrontmatter(md: string): Frontmatter {
  const m = FM_RE.exec(md);
  if (!m) return { data: {}, body: md };
  const data = (YAML.parse(m[1], { version: "1.2", schema: "core" }) ?? {}) as Record<
    string,
    unknown
  >;
  return { data, body: md.slice(m[0].length) };
}

/** Re-emit a Markdown document with the given frontmatter data and body. */
export function withFrontmatter(data: Record<string, unknown>, body: string): string {
  const yaml = YAML.stringify(data, { version: "1.2" }).trimEnd();
  const cleanBody = body.startsWith("\n") ? body.slice(1) : body;
  return `---\n${yaml}\n---\n${cleanBody}`;
}
