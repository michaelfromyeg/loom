import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  ArtifactKind,
  HarnessAdapter,
  ResolvedMarketplace,
} from "@michaelfromyeg/weft-adapter-kit";
import type { ArtifactRecord, Scope, Target } from "@michaelfromyeg/weft-schema";
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

function toBuffer(contents: string | Buffer): Buffer {
  return typeof contents === "string" ? Buffer.from(contents, "utf8") : contents;
}

export interface PlannedArtifact {
  record: ArtifactRecord;
  contents: Buffer;
}

/**
 * Compute (without writing) where each target's plugin tree would land in the
 * scope, with content hashes. Drives both install (write all) and update (write
 * only what changed). Executable/passthrough artifacts are recorded DISABLED (§11).
 */
export function planScopeArtifacts(
  result: CompileResult,
  scope: Scope,
  cwd: string,
): PlannedArtifact[] {
  const planned: PlannedArtifact[] = [];
  const name = result.fb.plugin.name;
  for (const t of result.targets) {
    const paths = t.adapter.detect(scope, cwd);
    const pluginDir = join(paths.plugins, name);
    for (const { componentId, artifact } of t.artifacts) {
      const contents = toBuffer(artifact.contents);
      planned.push({
        contents,
        record: {
          plugin: result.id,
          component: componentId,
          target: t.target,
          scope,
          path: join(pluginDir, artifact.relPath),
          hash: sha256(contents),
          placement: "copy",
          enabled: artifact.executable !== true,
        },
      });
    }
  }
  return planned;
}

/** `loom install` placement (spec §9.1 step 6): write every artifact, record each. */
export function installToScope(result: CompileResult, scope: Scope, cwd: string): ArtifactRecord[] {
  return planScopeArtifacts(result, scope, cwd).map(({ record, contents }) => {
    mkdirSync(dirname(record.path), { recursive: true });
    writeFileSync(record.path, contents);
    return record;
  });
}
