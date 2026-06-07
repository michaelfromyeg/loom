import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@loom/adapter-kit";
import { kindOf, refOf } from "@loom/schema";
import type { Diagnostics } from "./diagnostics";
import type { FetchedPlugin } from "./loader";

/**
 * Static validation (spec §9.1 step 3, the `valid` badge): every referenced file
 * exists, skill/agent frontmatter is well-formed, `server.json` parses, and
 * descriptions clear a basic quality bar. Errors fail the compile closed.
 */
export function validatePlugin(fb: FetchedPlugin, diags: Diagnostics): void {
  fb.plugin.components.forEach((component, i) => {
    const where = `components[${i}]`;
    const ref = refOf(component);
    const abs = join(fb.root, ref);
    if (!existsSync(abs)) {
      diags.error(where, `referenced path "${ref}" does not exist`);
      return;
    }

    switch (kindOf(component)) {
      case "skill":
        validateSkill(fb, ref, abs, where, diags);
        break;
      case "mcp":
        validateMcp(fb, ref, abs, where, diags);
        break;
      case "agent":
        validateMarkdownComponent(fb, ref, abs, where, diags);
        break;
      default:
        // command / hook / passthrough: existence is the only static gate.
        break;
    }
  });
}

function validateSkill(
  fb: FetchedPlugin,
  ref: string,
  abs: string,
  where: string,
  diags: Diagnostics,
): void {
  if (!statSync(abs).isDirectory()) {
    diags.error(where, `skill "${ref}" must be a directory containing SKILL.md`);
    return;
  }
  const skillMd = join(abs, "SKILL.md");
  if (!existsSync(skillMd)) {
    diags.error(where, `skill "${ref}" is missing SKILL.md`);
    return;
  }
  const { data } = parseFrontmatter(fb.read(join(ref, "SKILL.md")).toString("utf8"));
  if (!data.name) diags.error(`${where}.skill`, "SKILL.md frontmatter is missing `name`");
  checkDescription(`${where}.skill`, data.description, diags);
}

function validateMcp(
  fb: FetchedPlugin,
  ref: string,
  abs: string,
  where: string,
  diags: Diagnostics,
): void {
  if (!statSync(abs).isDirectory()) {
    diags.error(where, `mcp "${ref}" must be a directory containing server.json`);
    return;
  }
  const serverJsonPath = join(abs, "server.json");
  if (!existsSync(serverJsonPath)) {
    diags.error(where, `mcp "${ref}" is missing server.json`);
    return;
  }
  let server: Record<string, unknown>;
  try {
    server = JSON.parse(fb.read(join(ref, "server.json")).toString("utf8"));
  } catch (err) {
    diags.error(`${where}.mcp`, `server.json is not valid JSON: ${(err as Error).message}`);
    return;
  }
  if (!server.name) diags.error(`${where}.mcp`, "server.json is missing `name`");
  const hasRunnable = server.packages || server.remotes || server.command;
  if (!hasRunnable) {
    diags.warn(`${where}.mcp`, "server.json declares no `packages`, `remotes`, or `command`");
  }
  checkDescription(`${where}.mcp`, server.description, diags);
}

function validateMarkdownComponent(
  fb: FetchedPlugin,
  ref: string,
  abs: string,
  where: string,
  diags: Diagnostics,
): void {
  if (statSync(abs).isDirectory()) return; // agent-as-dir: defer detailed checks
  const { data } = parseFrontmatter(fb.read(ref).toString("utf8"));
  if (!data.name) diags.warn(`${where}.agent`, "agent frontmatter is missing `name`");
  checkDescription(`${where}.agent`, data.description, diags);
}

function checkDescription(where: string, description: unknown, diags: Diagnostics): void {
  if (!description) {
    diags.error(where, "missing `description` (required for discovery + the tested badge)");
    return;
  }
  if (String(description).trim().length < 16) {
    diags.warn(where, "description is very short; harnesses route on it -- make it specific");
  }
}
