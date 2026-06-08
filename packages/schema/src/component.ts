import {
  AgentComponent,
  CommandComponent,
  type Component,
  type ComponentKind,
  HookComponent,
  McpComponent,
  PassthroughComponent,
  SkillComponent,
} from "./plugin";

/** The key that names each component variant in `weft.yaml`. */
const KIND_KEYS: Record<ComponentKind, string> = {
  skill: "skill",
  mcp: "mcp",
  agent: "agent",
  hook: "hook",
  command: "command",
  passthrough: "passthrough",
};

const VARIANT_SCHEMAS = {
  skill: SkillComponent,
  mcp: McpComponent,
  agent: AgentComponent,
  hook: HookComponent,
  command: CommandComponent,
  passthrough: PassthroughComponent,
} as const;

export interface DetectedKind {
  kind: ComponentKind;
}

/**
 * Decide a component's kind from which discriminating key is present.
 * Returns an error string instead of throwing so callers can attach a path.
 */
export function detectComponentKind(
  raw: unknown,
): { ok: true; kind: ComponentKind } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "component must be an object" };
  }
  const present = (Object.keys(KIND_KEYS) as ComponentKind[]).filter(
    (kind) => KIND_KEYS[kind] in (raw as Record<string, unknown>),
  );
  if (present.length === 0) {
    return {
      ok: false,
      error: `component has no kind key (one of: ${Object.values(KIND_KEYS).join(", ")})`,
    };
  }
  if (present.length > 1) {
    return {
      ok: false,
      error: `component has conflicting kind keys: ${present.join(", ")}`,
    };
  }
  return { ok: true, kind: present[0] as ComponentKind };
}

/** The schema for a detected kind — used by the loader for path-precise errors. */
export function schemaForKind(kind: ComponentKind) {
  return VARIANT_SCHEMAS[kind];
}

/** The kind of an already-validated component. */
export function kindOf(component: Component): ComponentKind {
  const detected = detectComponentKind(component);
  if (!detected.ok) throw new Error(detected.error);
  return detected.kind;
}

/** The relative path (skill dir, mcp dir, hook file, …) this component points at. */
export function refOf(component: Component): string {
  const c = component as Record<string, unknown>;
  const kind = kindOf(component);
  return c[KIND_KEYS[kind]] as string;
}

/**
 * The leaf name used to build a fully-qualified id `{namespace}/{plugin}:{leaf}`.
 * Derived from the basename of the component's ref, stripping a known extension.
 */
export function leafNameOf(component: Component): string {
  const ref = refOf(component);
  const base = ref.split("/").filter(Boolean).pop() ?? ref;
  return base.replace(/\.(md|json|toml|ya?ml|ts|js|sh)$/i, "");
}

/** Harnesses this component targets, defaulting to all when unspecified. */
export function targetsOf(component: Component, all: readonly string[]): readonly string[] {
  if ("target" in component && typeof component.target === "string") {
    return [component.target];
  }
  if ("targets" in component && component.targets && component.targets.length > 0) {
    return component.targets;
  }
  return all;
}

/** Build the canonical fully-qualified id for a component. */
export function fqid(namespace: string, bundleName: string, leaf: string): string {
  return `${namespace}/${bundleName}:${leaf}`;
}
