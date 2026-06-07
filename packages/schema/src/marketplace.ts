import { z } from "zod";
import { Owner } from "./plugin";

export const MarketplaceEntry = z.object({
  /** Same source forms as Dependency.plugin. */
  plugin: z.string(),
  version: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type MarketplaceEntry = z.infer<typeof MarketplaceEntry>;

/** `marketplace.yaml` — a curated catalog compiled to each harness's native form. */
export const Marketplace = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/, "marketplace name must be kebab-case"),
  owner: Owner,
  description: z.string().optional(),
  plugins: z.array(MarketplaceEntry),
  /** Permitted external namespaces a plugin here may depend on. */
  allow_dependencies_on: z.array(z.string()).optional(),
});
export type Marketplace = z.infer<typeof Marketplace>;
