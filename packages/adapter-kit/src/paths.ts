import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/**
 * Resolved install directories for one harness at one scope. Category dirs serve
 * adapters that scatter components into convention dirs; `plugins` serves adapters
 * that drop a whole compiled plugin tree. `root` is the scope base.
 */
export interface InstallPaths {
  root: string;
  plugins: string;
  skills: string;
  mcp: string;
  agents: string;
  commands: string;
  hooks: string;
  /** Where the per-harness marketplace catalog goes. */
  catalog: string;
}

/** Expand a leading `~` to the user's home directory. */
export function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** Resolve a path that may be tilde-prefixed or relative to a base. */
export function resolveUnder(base: string, p: string): string {
  const expanded = expandTilde(p);
  return isAbsolute(expanded) ? expanded : join(base, expanded);
}

export { homedir };
