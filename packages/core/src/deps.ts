import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Component,
  type ComponentKind,
  kindOf,
  leafNameOf,
  refOf,
} from "@michaelfromyeg/weft-schema";
import { type FetchedPlugin, fileAccessors } from "./loader";
import { resolveDependency } from "./resolve";

const KIND_KEY: Record<ComponentKind, string> = {
  skill: "skill",
  mcp: "mcp",
  agent: "agent",
  hook: "hook",
  command: "command",
  passthrough: "passthrough",
};

function rewriteRef(c: Component, newRef: string): Component {
  return { ...c, [KIND_KEY[kindOf(c)]]: newRef } as Component;
}

const skipGit = (src: string): boolean => !/\/\.git(\/|$)/.test(src);

export interface DependencyRecord {
  id: string;
  range: string;
  resolvedSha: string;
}

export interface ResolvedDeps {
  fb: FetchedPlugin;
  dependencies: DependencyRecord[];
}

/**
 * Resolve a plugin's `depends` (spec §9.1 step 2). Each dependency is fetched
 * (locally or git-cloned and pinned to a SHA), then its selected components are
 * vendored into a merged temp tree under `_deps/<name>/` and registered under the
 * consuming plugin's namespace. Piecemeal `components:[…]` selects which to
 * register, but the whole dep tree is copied so shared assets travel (drift-aware).
 * Direct cycles are detected by id.
 */
export async function resolveDependencies(
  fb: FetchedPlugin,
  tmpRoot?: string,
): Promise<ResolvedDeps> {
  const depends = fb.plugin.depends ?? [];
  if (depends.length === 0) return { fb, dependencies: [] };

  const merged = mkdtempSync(join(tmpRoot ?? tmpdir(), "weft-merged-"));
  cpSync(fb.root, merged, { recursive: true, filter: skipGit });

  const components: Component[] = [...fb.plugin.components];
  const dependencies: DependencyRecord[] = [];
  const seen = new Set<string>([`${fb.plugin.owner.namespace}/${fb.plugin.name}`]);

  for (const dep of depends) {
    const resolved = await resolveDependency(dep, fb.root);
    const dp = resolved.fb.plugin;
    const depId = `${dp.owner.namespace}/${dp.name}`;
    if (seen.has(depId)) throw new Error(`dependency cycle detected at ${depId}`);
    seen.add(depId);

    const want = dep.components;
    if (want) {
      const missing = want.filter((leaf) => !dp.components.some((c) => leafNameOf(c) === leaf));
      if (missing.length > 0) {
        throw new Error(`dependency ${depId} has no component(s): ${missing.join(", ")}`);
      }
    }
    const selected = dp.components.filter((c) => !want || want.includes(leafNameOf(c)));

    const destBase = join("_deps", dp.name);
    cpSync(resolved.fb.root, join(merged, destBase), { recursive: true, filter: skipGit });
    for (const c of selected) components.push(rewriteRef(c, join(destBase, refOf(c))));

    dependencies.push({ id: depId, range: dep.version ?? "*", resolvedSha: resolved.sha });
  }

  const plugin = { ...fb.plugin, components };
  const mergedFb: FetchedPlugin = {
    plugin,
    root: merged,
    manifestPath: join(merged, "weft.yaml"),
    ...fileAccessors(merged),
  };
  return { fb: mergedFb, dependencies };
}
