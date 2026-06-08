import type { Owner } from "@michaelfromyeg/loom-schema";

/**
 * One plugin's resolved metadata for a catalog entry. Core resolves each
 * marketplace entry (loads the referenced plugin to learn its name/description)
 * so the adapter just formats -- it never re-resolves sources itself.
 */
export interface CatalogEntry {
  name: string;
  /** Where the catalog points for this plugin (e.g. "./plugins/<name>"). */
  source: string;
  description?: string;
  version?: string;
  category?: string;
  tags?: string[];
}

/** A marketplace with every entry already resolved to concrete metadata. */
export interface ResolvedMarketplace {
  name: string;
  owner: Owner;
  description?: string;
  entries: CatalogEntry[];
}
