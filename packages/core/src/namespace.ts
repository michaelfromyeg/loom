/** One component identified for aliasing: its bare leaf name and full id. */
export interface AliasInput {
  id: string;
  leaf: string;
}

export interface AliasResult {
  /** Bare leaf name -> fully-qualified id. */
  aliases: Record<string, string>;
  /** True same-scope collisions: one leaf claimed by multiple ids. */
  collisions: Array<{ leaf: string; ids: string[] }>;
}

/**
 * Bare name when unambiguous (spec §9.4). A leaf used by exactly one component
 * gets the bare alias; a leaf shared by several is surfaced as a collision for
 * the caller to resolve (prompt interactively, or error non-interactively).
 * Never silently last-wins.
 */
export function resolveAliases(components: AliasInput[]): AliasResult {
  const byLeaf = new Map<string, string[]>();
  for (const c of components) {
    const ids = byLeaf.get(c.leaf) ?? [];
    ids.push(c.id);
    byLeaf.set(c.leaf, ids);
  }

  const aliases: Record<string, string> = {};
  const collisions: AliasResult["collisions"] = [];
  for (const [leaf, ids] of byLeaf) {
    if (ids.length === 1) aliases[leaf] = ids[0] as string;
    else collisions.push({ leaf, ids: [...ids].sort() });
  }
  return { aliases, collisions };
}
