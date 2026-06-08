import claudeAdapter from "@michaelfromyeg/weft-adapter-claude";
import codexAdapter from "@michaelfromyeg/weft-adapter-codex";
import copilotAdapter from "@michaelfromyeg/weft-adapter-copilot";
import cursorAdapter from "@michaelfromyeg/weft-adapter-cursor";
import { genericSkillsAdapter, type HarnessDriver } from "@michaelfromyeg/weft-adapter-kit";
import opencodeAdapter from "@michaelfromyeg/weft-adapter-opencode";
import { AdapterRegistry } from "@michaelfromyeg/weft-core";
import { drivers } from "@michaelfromyeg/weft-eval";
import type { Target } from "@michaelfromyeg/weft-schema";

/**
 * Skills-only harnesses that load SKILL.md from a `<root>/skills/` directory
 * convention. One generic adapter each; add a row to support another.
 */
const GENERIC_AGENTS = [
  { target: "zed", projectRoot: ".agents", globalRoot: "~/.agents" },
  { target: "gemini", projectRoot: ".agents", globalRoot: "~/.gemini" },
  { target: "amp", projectRoot: ".agents", globalRoot: "~/.config/agents" },
  { target: "aider", projectRoot: ".aider-desk", globalRoot: "~/.aider-desk" },
] as const;

/**
 * Wire every concrete adapter into a registry. The CLI sits at the top of the
 * dependency graph, so it -- not core -- knows the full adapter set. The first
 * five are deep, full-plugin adapters; the rest are generic skills-only ones.
 * Community adapters are added the same way.
 */
export function buildRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry()
    .register(claudeAdapter)
    .register(codexAdapter)
    .register(cursorAdapter)
    .register(copilotAdapter)
    .register(opencodeAdapter);
  for (const a of GENERIC_AGENTS) {
    registry.register(genericSkillsAdapter(a));
  }
  return registry;
}

/** The headless eval drivers, keyed by Target (from @michaelfromyeg/weft-eval). */
export function allDrivers(): Partial<Record<Target, HarnessDriver>> {
  return drivers;
}

/** Parse a comma-separated CLI value into a trimmed list, or undefined when empty. */
export function parseList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/** Parse a comma-separated --target value into a typed list, or undefined for all. */
export function parseTargets(value: string | undefined): Target[] | undefined {
  return parseList(value) as Target[] | undefined;
}
