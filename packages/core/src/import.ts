import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HarnessAdapter } from "@michaelfromyeg/loom-adapter-kit";
import { stringifyDocument } from "@michaelfromyeg/loom-schema";

export interface ImportPluginOptions {
  /** Directory holding an existing native plugin or marketplace. */
  dir: string;
  adapter: HarnessAdapter;
  /** Where to write the generated Loom plugin/marketplace. */
  outDir: string;
  /** Reverse-DNS namespace to assign (native assets lack one). */
  namespace?: string;
}

export interface ImportOutput {
  kind: "plugin" | "marketplace";
  name: string;
  outDir: string;
  manifestPath: string;
  fileCount: number;
  id?: string;
}

/**
 * Reverse-compile an existing native plugin/marketplace into the Loom model and
 * write it to `outDir`, ready for `loom build` to cross-compile to every other
 * harness. This is "federate, don't wall off" applied to assets you already have.
 */
export function importNativePlugin(opts: ImportPluginOptions): ImportOutput {
  if (!opts.adapter.importNative) {
    throw new Error(`adapter "${opts.adapter.target}" does not support import`);
  }
  const result = opts.adapter.importNative(opts.dir, { namespace: opts.namespace });
  if (!result) {
    throw new Error(`no ${opts.adapter.target} plugin or marketplace found in ${opts.dir}`);
  }
  mkdirSync(opts.outDir, { recursive: true });

  if (result.kind === "marketplace") {
    const manifestPath = join(opts.outDir, "marketplace.yaml");
    writeFileSync(manifestPath, stringifyDocument(result.marketplace));
    return {
      kind: "marketplace",
      name: result.marketplace.name,
      outDir: opts.outDir,
      manifestPath,
      fileCount: 0,
    };
  }

  const manifestPath = join(opts.outDir, "loom.yaml");
  writeFileSync(manifestPath, stringifyDocument(result.plugin));
  for (const f of result.files) {
    const abs = join(opts.outDir, f.relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(
      abs,
      typeof f.contents === "string" ? Buffer.from(f.contents, "utf8") : f.contents,
    );
  }
  return {
    kind: "plugin",
    name: result.plugin.name,
    outDir: opts.outDir,
    manifestPath,
    fileCount: result.files.length,
    id: `${result.plugin.owner.namespace}/${result.plugin.name}`,
  };
}
