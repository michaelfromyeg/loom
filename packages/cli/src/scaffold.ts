import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

export interface ScaffoldOptions {
  dir: string;
  name?: string;
  namespace?: string;
}

export interface ScaffoldResult {
  dir: string;
  name: string;
  files: string[];
}

function kebab(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "my-plugin"
  );
}

/** Create a minimal, valid plugin: loom.yaml + one sample skill. Never clobbers. */
export function scaffoldPlugin(opts: ScaffoldOptions): ScaffoldResult {
  const dir = resolve(opts.dir);
  mkdirSync(dir, { recursive: true });

  const manifestPath = join(dir, "loom.yaml");
  if (existsSync(manifestPath)) {
    throw new Error(`a plugin already exists at ${manifestPath}`);
  }

  const name = kebab(opts.name ?? basename(dir));
  const namespace = opts.namespace ?? "com.example";
  const files: string[] = [];

  const loomYaml = `name: ${name}
version: 0.1.0
owner:
  name: Your Name
  namespace: ${namespace}
description: A Loom plugin.
components:
  - skill: skills/hello
`;
  writeFileSync(manifestPath, loomYaml);
  files.push(relative(dir, manifestPath));

  const skillDir = join(dir, "skills", "hello");
  mkdirSync(skillDir, { recursive: true });
  const skillMd = `---
name: hello
description: Greet the user and explain what this skill does.
---

When invoked, greet the user warmly and summarize the task at hand.
`;
  const skillPath = join(skillDir, "SKILL.md");
  writeFileSync(skillPath, skillMd);
  files.push(relative(dir, skillPath));

  return { dir, name, files };
}
