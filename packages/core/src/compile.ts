import type {
  CompiledArtifact,
  HarnessAdapter,
  PluginCtx,
  ResolvedMarketplace,
} from "@michaelfromyeg/weft-adapter-kit";
import {
  ALL_TARGETS,
  type Component,
  type ComponentKind,
  fqid,
  kindOf,
  leafNameOf,
  type Plugin,
  type Target,
  targetsOf,
} from "@michaelfromyeg/weft-schema";
import { Diagnostics } from "./diagnostics";
import type { FetchedPlugin } from "./loader";
import { resolveAliases } from "./namespace";
import type { AdapterRegistry } from "./registry";
import { validatePlugin } from "./validate";
import { checkMinVersion } from "./version";

/** An emitted artifact tagged with the canonical component it came from. */
export interface TaggedArtifact {
  componentId: string;
  artifact: CompiledArtifact;
}

/** Everything one adapter produced for one plugin. */
export interface TargetOutput {
  target: Target;
  adapter: HarnessAdapter;
  /** Plugin-root-relative artifacts: components + the plugin manifest. */
  artifacts: TaggedArtifact[];
}

export interface CompileResult {
  fb: FetchedPlugin;
  /** Plugin id: `{namespace}/{name}`. */
  id: string;
  /** The components actually compiled (the piecemeal selection, or all). */
  components: ResolvedComponent[];
  aliases: Record<string, string>;
  diagnostics: Diagnostics;
  targets: TargetOutput[];
}

export interface CompileOptions {
  registry: AdapterRegistry;
  /** Restrict to these targets; default = every target with a registered adapter. */
  targets?: Target[];
  /** Piecemeal: include only these component leaf names; default = all (spec §9.2). */
  only?: string[];
}

/** A synthetic one-entry marketplace wrapping a single plugin (spec §9.1 build). */
export function synthMarketplace(plugin: Plugin): ResolvedMarketplace {
  return {
    name: plugin.name,
    owner: plugin.owner,
    ...(plugin.description ? { description: plugin.description } : {}),
    entries: [
      {
        name: plugin.name,
        source: `./plugins/${plugin.name}`,
        ...(plugin.description ? { description: plugin.description } : {}),
        version: plugin.version,
      },
    ],
  };
}

export interface ResolvedComponent {
  id: string;
  leaf: string;
  kind: ComponentKind;
  component: Component;
}

export interface StaticPass {
  id: string;
  diagnostics: Diagnostics;
  aliases: Record<string, string>;
  resolved: ResolvedComponent[];
}

/**
 * Steps 1-4 of the pipeline shared by `compile` and `lint`: min-version,
 * static validation, fully-qualified ids, and alias resolution. No adapters run,
 * so it is the deterministic "is this plugin valid?" pass behind the valid badge.
 */
export function staticPass(fb: FetchedPlugin): StaticPass {
  const diagnostics = new Diagnostics();
  const { plugin } = fb;
  const id = `${plugin.owner.namespace}/${plugin.name}`;

  const minErr = checkMinVersion(plugin.weft_min_version);
  if (minErr) diagnostics.error("weft_min_version", minErr);

  validatePlugin(fb, diagnostics);

  const resolved: ResolvedComponent[] = plugin.components.map((component) => ({
    id: fqid(plugin.owner.namespace, plugin.name, leafNameOf(component)),
    leaf: leafNameOf(component),
    kind: kindOf(component),
    component,
  }));

  const { aliases, collisions } = resolveAliases(resolved);
  for (const c of collisions) {
    diagnostics.error(
      `components.${c.leaf}`,
      `ambiguous component name "${c.leaf}": ${c.ids.join(" vs ")}; qualify or choose which keeps the bare alias`,
    );
  }

  return { id, diagnostics, aliases, resolved };
}

/**
 * Steps 1-5 of the compile pipeline (spec §9.1): load is done by the caller;
 * here we enforce min-version, validate statically, resolve aliases, and run each
 * adapter's transform + emitManifest. Catalog emission (a marketplace concern) and
 * placement are separate so `build` can inspect without installing and `install`
 * can pull components piecemeal.
 *
 * Never throws on plugin problems -- it accumulates diagnostics so the caller can
 * render them. `build`/`install` fail closed when `diagnostics.hasErrors`.
 */
export function compile(fb: FetchedPlugin, opts: CompileOptions): CompileResult {
  const { plugin } = fb;
  const pass = staticPass(fb);
  const { id, diagnostics } = pass;

  // Piecemeal selection (spec §9.2): include only the requested component leaves.
  const onlySet = opts.only && opts.only.length > 0 ? new Set(opts.only) : null;
  if (onlySet) {
    for (const leaf of onlySet) {
      if (!pass.resolved.some((rc) => rc.leaf === leaf)) {
        diagnostics.error(
          "only",
          `component "${leaf}" not found; available: ${pass.resolved.map((r) => r.leaf).join(", ")}`,
        );
      }
    }
  }
  const selected = onlySet ? pass.resolved.filter((rc) => onlySet.has(rc.leaf)) : pass.resolved;
  const effectivePlugin: Plugin = onlySet
    ? { ...plugin, components: selected.map((rc) => rc.component) }
    : plugin;
  const aliases = onlySet
    ? Object.fromEntries(
        Object.entries(pass.aliases).filter(([, cid]) => selected.some((rc) => rc.id === cid)),
      )
    : pass.aliases;
  const reverseAlias = new Map(Object.entries(aliases).map(([leaf, cid]) => [cid, leaf]));

  const requested = opts.targets ?? opts.registry.targets;
  const targets: TargetOutput[] = [];

  for (const target of requested) {
    const adapter = opts.registry.get(target);
    if (!adapter) {
      if (opts.targets) diagnostics.warn(target, `no adapter registered for target "${target}"`);
      continue;
    }

    const ctx: PluginCtx = {
      plugin: effectivePlugin,
      read: fb.read,
      list: fb.list,
      aliasFor: (componentId) => reverseAlias.get(componentId) ?? componentId,
    };

    const pluginArtifacts: TaggedArtifact[] = [];
    for (const rc of selected) {
      if (!targetsOf(rc.component, ALL_TARGETS).includes(target)) continue;
      for (const a of adapter.transform(rc.component, ctx)) {
        pluginArtifacts.push({ componentId: rc.id, artifact: a });
      }
    }
    for (const a of adapter.emitManifest(effectivePlugin, ctx)) {
      pluginArtifacts.push({ componentId: id, artifact: a });
    }

    targets.push({ target, adapter, artifacts: pluginArtifacts });
  }

  return { fb, id, components: selected, aliases, diagnostics, targets };
}
