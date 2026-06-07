import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ArtifactKind, HarnessAdapter, ResolvedMarketplace } from "@loom/adapter-kit";
import type { ArtifactRecord, Scope, Target } from "@loom/schema";
import { type CompileResult, synthMarketplace, type TargetOutput } from "./compile";
import { sha256 } from "./hash";

export interface WrittenArtifact {
  target: Target;
  /** Relative to the per-target output base. */
  relPath: string;
  abs: string;
  hash: string;
  kind?: ArtifactKind;
}

function writeArtifact(
  baseDir: string,
  relPath: string,
  contents: string | Buffer,
): { abs: string; hash: string } {
  const abs = join(baseDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  const buf = typeof contents === "string" ? Buffer.from(contents, "utf8") : contents;
  writeFileSync(abs, buf);
  return { abs, hash: sha256(buf) };
}

/** Write one plugin's artifacts under `<baseDir>/plugins/<pluginName>/`. */
export function placePluginArtifacts(
  target: TargetOutput,
  baseDir: string,
  pluginName: string,
): WrittenArtifact[] {
  const pluginPrefix = join("plugins", pluginName);
  return target.artifacts.map(({ artifact }) => {
    const rel = join(pluginPrefix, artifact.relPath);
    const { abs, hash } = writeArtifact(baseDir, rel, artifact.contents);
    return { target: target.target, relPath: rel, abs, hash, kind: artifact.kind };
  });
}

/** Emit and write a harness's native catalog at `<baseDir>/`. */
export function placeCatalog(
  adapter: HarnessAdapter,
  marketplace: ResolvedMarketplace,
  baseDir: string,
): WrittenArtifact[] {
  return adapter.emitCatalog(marketplace).map((artifact) => {
    const { abs, hash } = writeArtifact(baseDir, artifact.relPath, artifact.contents);
    return { target: adapter.target, relPath: artifact.relPath, abs, hash, kind: artifact.kind };
  });
}

/**
 * `loom build` placement for a single plugin (spec §9.1 step 6, inspect-only):
 * writes the plugin tree at `outDir/<target>/plugins/<plugin>/` plus a synthetic
 * one-entry catalog at the target root, leaving harness install dirs untouched.
 */
export function buildToDir(result: CompileResult, outDir: string): WrittenArtifact[] {
  const written: WrittenArtifact[] = [];
  const { plugin } = result.fb;
  const marketplace = synthMarketplace(plugin);
  for (const t of result.targets) {
    const base = join(outDir, t.target);
    written.push(...placePluginArtifacts(t, base, plugin.name));
    written.push(...placeCatalog(t.adapter, marketplace, base));
  }
  return written;
}

/**
 * `loom install` placement (spec §9.1 step 6): copies each target's plugin tree
 * into the scope's plugins dir and records every file for the lockfile. Executable
 * / passthrough artifacts are recorded DISABLED (spec §11).
 */
export function installToScope(result: CompileResult, scope: Scope, cwd: string): ArtifactRecord[] {
  const records: ArtifactRecord[] = [];
  const name = result.fb.plugin.name;
  for (const t of result.targets) {
    const paths = t.adapter.detect(scope, cwd);
    const pluginDir = join(paths.plugins, name);
    for (const { componentId, artifact } of t.artifacts) {
      const { abs, hash } = writeArtifact(pluginDir, artifact.relPath, artifact.contents);
      records.push({
        component: componentId,
        target: t.target,
        scope,
        path: abs,
        hash,
        placement: "copy",
        enabled: artifact.executable !== true,
      });
    }
  }
  return records;
}
