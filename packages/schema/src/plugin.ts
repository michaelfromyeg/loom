import { z } from "zod";

/**
 * The coding-agent harnesses Weft compiles to. The first five have full,
 * dedicated adapters (skills + MCP + agents + hooks + commands); the rest are
 * skills-only directory-convention harnesses served by a generic adapter.
 */
export const Target = z.enum([
  "claude",
  "codex",
  "cursor",
  "copilot",
  "opencode",
  "zed",
  "gemini",
  "amp",
  "aider",
]);
export type Target = z.infer<typeof Target>;

export const ALL_TARGETS: readonly Target[] = Target.options;

/** Reverse-DNS namespace, e.g. `com.acme`. */
export const Namespace = z
  .string()
  .regex(/^[a-z0-9]+(\.[a-z0-9]+)+$/, "namespace must be reverse-DNS, e.g. com.acme");

export const Owner = z.object({
  name: z.string(),
  namespace: Namespace,
  email: z.email().optional(),
});
export type Owner = z.infer<typeof Owner>;

/** A config value a component reads at runtime. Declared, never stored (§11). */
export const ConfigVar = z.object({
  env: z.string(),
  secret: z.boolean().default(false),
  prompt: z.string().optional(),
  default: z.string().optional(),
  required: z.boolean().default(true),
});
export type ConfigVar = z.infer<typeof ConfigVar>;

const commonFields = {
  /** Which harnesses to emit for; default = all five. */
  targets: z.array(Target).optional(),
  /** Path to a `cases.yaml` eval file, relative to the plugin root. */
  evals: z.string().optional(),
} as const;

/** The seven primitive component kinds. `passthrough` is verbatim/single-target. */
export const COMPONENT_KINDS = ["skill", "mcp", "agent", "hook", "command", "passthrough"] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export const SkillComponent = z.strictObject({ ...commonFields, skill: z.string() });
export const McpComponent = z.strictObject({
  ...commonFields,
  mcp: z.string(),
  config: z.array(ConfigVar).optional(),
});
export const AgentComponent = z.strictObject({ ...commonFields, agent: z.string() });
export const HookComponent = z.strictObject({ ...commonFields, hook: z.string() });
export const CommandComponent = z.strictObject({ ...commonFields, command: z.string() });

/** A verbatim executable artifact bound to a single harness. Placed DISABLED. */
export const PassthroughComponent = z.strictObject({
  passthrough: z.string(),
  target: Target,
  kind: z.enum(["hook", "plugin", "script"]),
  default_enabled: z.boolean().default(false),
  /** Path to a `cases.yaml` eval file (a passthrough eval is a setup+verify check). */
  evals: z.string().optional(),
});

export const Component = z.union([
  SkillComponent,
  McpComponent,
  AgentComponent,
  HookComponent,
  CommandComponent,
  PassthroughComponent,
]);
export type Component = z.infer<typeof Component>;

/** Source forms accepted for a plugin reference. */
export const Dependency = z.object({
  /** github:owner/repo | <git-url> | npm:<pkg> | ./path */
  plugin: z.string(),
  version: z.string().optional(),
  /** Piecemeal: pull only these leaf names (+ their shared/sibling assets). */
  components: z.array(z.string()).optional(),
});
export type Dependency = z.infer<typeof Dependency>;

export const Trust = z.object({
  sign: z.boolean().default(false),
  scan: z.array(z.enum(["schema", "security"])).default(["schema"]),
});
export type Trust = z.infer<typeof Trust>;

/** `weft.yaml` — the single file an author writes. */
export const Plugin = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/, "plugin name must be kebab-case"),
  version: z.string(),
  owner: Owner,
  description: z.string().optional(),
  license: z.string().optional(),
  weft_min_version: z.string().optional(),
  components: z.array(Component),
  depends: z.array(Dependency).optional(),
  trust: Trust.optional(),
});
export type Plugin = z.infer<typeof Plugin>;
