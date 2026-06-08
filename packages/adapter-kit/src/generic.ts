import { join } from "node:path";
import type { Component, Scope, Target } from "@michaelfromyeg/weft-schema";
import { kindOf, leafNameOf, refOf } from "@michaelfromyeg/weft-schema";
import type { HarnessAdapter, PluginCtx } from "./adapter";
import { artifact, type CompiledArtifact } from "./artifact";
import { expandTilde, type InstallPaths } from "./paths";

export interface GenericSkillsConfig {
  /** The Target this adapter compiles for (must be a known Target). */
  target: Target;
  /** Project-scope root that holds `skills/`, relative to cwd (e.g. `.agents`). */
  projectRoot: string;
  /** User-scope root that holds `skills/`, tilde-prefixed (e.g. `~/.gemini`). */
  globalRoot: string;
}

/**
 * A skills-only adapter for the directory-convention harnesses that load
 * `SKILL.md` files from a shared `<root>/skills/<leaf>/` layout (the `.agents`
 * family: Zed, Cline, Gemini CLI, Amp, Warp, …). It places each skill flatly
 * (no `plugins/<name>/` grouping, hence `flat: true`) and emits nothing for the
 * richer component kinds these harnesses don't accept (mcp/agent/hook/command/
 * passthrough). Deep, full-plugin harnesses keep their own dedicated adapters.
 */
export function genericSkillsAdapter(cfg: GenericSkillsConfig): HarnessAdapter {
  return {
    target: cfg.target,
    version: "1.0.0",
    targetSchema: "agents-skills/1",
    flat: true,
    detect(scope: Scope, cwd: string): InstallPaths {
      const root = scope === "user" ? expandTilde(cfg.globalRoot) : join(cwd, cfg.projectRoot);
      const skills = join(root, "skills");
      // Only `skills` is meaningful; the other category dirs point at root.
      return {
        root,
        plugins: root,
        skills,
        mcp: root,
        agents: root,
        commands: root,
        hooks: root,
        catalog: root,
      };
    },
    transform(component: Component, ctx: PluginCtx): CompiledArtifact[] {
      if (kindOf(component) !== "skill") return []; // skills-only
      const ref = refOf(component);
      const leaf = leafNameOf(component);
      return ctx.list(ref).map((file) => {
        const within = file.startsWith(`${ref}/`) ? file.slice(ref.length + 1) : file;
        return artifact(`skills/${leaf}/${within}`, ctx.read(file), { kind: "skill" });
      });
    },
    emitManifest: () => [],
    emitCatalog: () => [],
  };
}
