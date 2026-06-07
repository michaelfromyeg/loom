import claudeAdapter from "@loom/adapter-claude";
import { AdapterRegistry } from "@loom/core";
import type { Target } from "@loom/schema";

/**
 * Wire concrete adapters into a registry. The CLI sits at the top of the
 * dependency graph, so it -- not core -- knows the full adapter set. As more
 * adapters land they register here; community adapters can be added the same way.
 */
export function buildRegistry(): AdapterRegistry {
  return new AdapterRegistry().register(claudeAdapter);
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
