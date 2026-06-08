import type { Marketplace, Plugin } from "@michaelfromyeg/loom-schema";
import type { CompiledArtifact } from "./artifact";

export interface ImportOptions {
  /** Reverse-DNS namespace to assign (native plugins have no Loom namespace). */
  namespace?: string;
}

/** An existing native plugin reverse-compiled into a Loom plugin + its files. */
export interface ImportedPlugin {
  kind: "plugin";
  plugin: Plugin;
  /** Component files to write under the output root (relPath relative to it). */
  files: CompiledArtifact[];
}

/** An existing native marketplace reverse-compiled into a Loom marketplace. */
export interface ImportedMarketplace {
  kind: "marketplace";
  marketplace: Marketplace;
}

export type ImportResult = ImportedPlugin | ImportedMarketplace;
