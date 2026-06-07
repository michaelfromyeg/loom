import claudeAdapter from "@loom/adapter-claude";
import codexAdapter from "@loom/adapter-codex";
import copilotAdapter from "@loom/adapter-copilot";
import cursorAdapter from "@loom/adapter-cursor";
import type { HarnessDriver } from "@loom/adapter-kit";
import opencodeAdapter from "@loom/adapter-opencode";
import { AdapterRegistry } from "@loom/core";
import { drivers } from "@loom/eval";
import type { Target } from "@loom/schema";

/**
 * Wire every concrete adapter into a registry. The CLI sits at the top of the
 * dependency graph, so it -- not core -- knows the full adapter set. Community
 * adapters are added the same way.
 */
export function buildRegistry(): AdapterRegistry {
  return new AdapterRegistry()
    .register(claudeAdapter)
    .register(codexAdapter)
    .register(cursorAdapter)
    .register(copilotAdapter)
    .register(opencodeAdapter);
}

/** The headless eval drivers, keyed by Target (from @loom/eval). */
export function allDrivers(): Record<Target, HarnessDriver> {
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
