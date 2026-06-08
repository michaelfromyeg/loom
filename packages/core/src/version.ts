import semver from "semver";

/** The Loom/CLI version (versioning axis 2, spec §5). */
export const LOOM_VERSION = "0.3.0";

/**
 * Check a plugin's `loom_min_version` against the running Loom. Returns an error
 * message when unmet, or null when satisfied / unspecified.
 */
export function checkMinVersion(min: string | undefined): string | null {
  if (!min) return null;
  const cleaned = semver.valid(semver.coerce(min) ?? min);
  if (!cleaned) return `loom_min_version "${min}" is not a valid semver`;
  if (semver.lt(LOOM_VERSION, cleaned)) {
    return `plugin requires Loom >= ${min}, but this is ${LOOM_VERSION}`;
  }
  return null;
}
