import type { Badge } from "@michaelfromyeg/weft-schema";

/**
 * A managed-mode install policy (spec §11 rule 5): the same install mechanism as
 * a solo dev, restricted by scope + policy. An enterprise pins an allowlist of
 * namespaces and/or required badges; only scope and policy differ, never mechanism.
 */
export interface ManagedPolicy {
  /** Only these reverse-DNS namespaces may be installed. */
  allowNamespaces?: string[];
  /** Each installed plugin must carry all of these badges. */
  requireBadges?: Badge[];
}

export interface PolicyContext {
  namespace: string;
  badges?: Badge[];
}

/** A blocking reason when the policy forbids the install, or null when permitted. */
export function checkManagedPolicy(
  policy: ManagedPolicy | undefined,
  ctx: PolicyContext,
): string | null {
  if (!policy) return null;
  if (policy.allowNamespaces && !policy.allowNamespaces.includes(ctx.namespace)) {
    return `namespace "${ctx.namespace}" is not allowlisted (managed mode allows: ${policy.allowNamespaces.join(", ")})`;
  }
  if (policy.requireBadges && policy.requireBadges.length > 0) {
    const have = new Set(ctx.badges ?? []);
    const missing = policy.requireBadges.filter((b) => !have.has(b));
    if (missing.length > 0) return `plugin is missing required badge(s): ${missing.join(", ")}`;
  }
  return null;
}
