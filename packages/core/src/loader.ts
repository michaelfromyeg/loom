import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  loadManifest,
  loadPlugin,
  Marketplace,
  type ParseResult,
  type Plugin,
} from "@michaelfromyeg/loom-schema";

/** A plugin whose files are available on disk under `root`. */
export interface FetchedPlugin {
  plugin: Plugin;
  root: string;
  manifestPath: string;
  /** Read a file from the plugin, relative to `root`. */
  read(relPath: string): Buffer;
  /** Recursively list files under a plugin dir, as paths relative to `root` (sorted). */
  list(relDir: string): string[];
}

/** A loaded marketplace manifest and its directory. */
export interface FetchedMarketplace {
  marketplace: Marketplace;
  root: string;
  manifestPath: string;
}

/** Recursively collect file paths under `dir`, relative to `root`. Deterministic order. */
function walkFiles(root: string, dir: string): string[] {
  if (!(existsSync(dir) && statSync(dir).isDirectory())) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...walkFiles(root, abs));
    else out.push(relative(root, abs));
  }
  return out;
}

const MANIFEST_NAMES = ["loom.yaml", "loom.yml", "loom.json5", "loom.json"];

/** Build `read`/`list` accessors rooted at a directory (used for merged plugins too). */
export function fileAccessors(root: string): Pick<FetchedPlugin, "read" | "list"> {
  return {
    read: (relPath: string) => readFileSync(join(root, relPath)),
    list: (relDir: string) => walkFiles(root, join(root, relDir)),
  };
}

/** Load and validate the plugin manifest in `dir`, exposing its files for adapters. */
export function loadPluginDir(dir: string): ParseResult<FetchedPlugin> {
  const manifestPath = MANIFEST_NAMES.map((n) => join(dir, n)).find((p) => existsSync(p));
  if (!manifestPath) {
    return {
      ok: false,
      issues: [
        { path: dir, message: `no plugin manifest found (one of: ${MANIFEST_NAMES.join(", ")})` },
      ],
    };
  }

  const text = readFileSync(manifestPath, "utf8");
  const parsed = loadPlugin(text, { filename: manifestPath });
  if (!parsed.ok) return parsed;

  return {
    ok: true,
    value: { plugin: parsed.value, root: dir, manifestPath, ...fileAccessors(dir) },
  };
}

const MARKETPLACE_NAMES = [
  "marketplace.yaml",
  "marketplace.yml",
  "marketplace.json5",
  "marketplace.json",
];

/** True when `dir` is a marketplace (a catalog of plugins) rather than a plugin. */
export function hasMarketplaceManifest(dir: string): boolean {
  return MARKETPLACE_NAMES.some((n) => existsSync(join(dir, n)));
}

/** Load and validate the marketplace manifest in `dir`. */
export function loadMarketplaceDir(dir: string): ParseResult<FetchedMarketplace> {
  const manifestPath = MARKETPLACE_NAMES.map((n) => join(dir, n)).find((p) => existsSync(p));
  if (!manifestPath) {
    return {
      ok: false,
      issues: [
        {
          path: dir,
          message: `no marketplace manifest found (one of: ${MARKETPLACE_NAMES.join(", ")})`,
        },
      ],
    };
  }
  const text = readFileSync(manifestPath, "utf8");
  const parsed = loadManifest(Marketplace, text, { filename: manifestPath });
  if (!parsed.ok) return parsed;
  return { ok: true, value: { marketplace: parsed.value, root: dir, manifestPath } };
}
