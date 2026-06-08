import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Component, Plugin } from "@michaelfromyeg/loom-schema";

export interface ConfigResolution {
  env: string;
  /** Where the value came from -- never the value itself. */
  source: "env" | "default" | "missing";
  secret: boolean;
}

export interface SecretsResult {
  resolved: ConfigResolution[];
  /** Path to the gitignored local config the values were written to (or null). */
  path: string | null;
}

function configVarsOf(component: Component) {
  return "config" in component && component.config ? component.config : [];
}

/**
 * Resolve declared `ConfigVar`s (spec §9.1 step 7, §11 rule 4: declare-not-store).
 * Values come from the environment or a declared default and are written ONLY to a
 * local, gitignored config -- never to the lockfile, the plugin, the index, or
 * telemetry. The returned summary records where each value came from, not the value.
 */
export function resolveConfig(
  plugin: Plugin,
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): SecretsResult {
  const resolved: ConfigResolution[] = [];
  const values: Record<string, string> = {};

  for (const component of plugin.components) {
    for (const v of configVarsOf(component)) {
      const fromEnv = env[v.env];
      if (fromEnv !== undefined) {
        values[v.env] = fromEnv;
        resolved.push({ env: v.env, source: "env", secret: v.secret });
      } else if (v.default !== undefined) {
        values[v.env] = v.default;
        resolved.push({ env: v.env, source: "default", secret: v.secret });
      } else {
        resolved.push({ env: v.env, source: "missing", secret: v.secret });
      }
    }
  }

  if (Object.keys(values).length === 0) return { resolved, path: null };

  const dir = join(cwd, ".loom");
  mkdirSync(dir, { recursive: true });
  // Gitignore the whole local-config dir so resolved values never get committed.
  writeFileSync(join(dir, ".gitignore"), "*\n");
  const path = join(dir, "secrets.local.json");
  writeFileSync(path, `${JSON.stringify(values, null, 2)}\n`);
  return { resolved, path };
}
