import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ArtifactRecord, Lockfile, validate } from "@michaelfromyeg/loom-schema";
import type { CompileResult } from "./compile";
import { LOOM_VERSION } from "./version";

export interface LockInput {
  result: CompileResult;
  artifacts: ArtifactRecord[];
  ref: string;
  sha: string;
  generatedAt: string;
  dependencies?: Lockfile["dependencies"];
}

/** Assemble the `loom.lock` object (spec §6.3) from an install. */
export function buildLockfile(input: LockInput): Lockfile {
  const adapters: Lockfile["adapters"] = {};
  for (const t of input.result.targets) {
    adapters[t.target] = { version: t.adapter.version, targetSchema: t.adapter.targetSchema };
  }
  return {
    loomVersion: LOOM_VERSION,
    generatedAt: input.generatedAt,
    plugin: {
      id: input.result.id,
      version: input.result.fb.plugin.version,
      ref: input.ref,
      sha: input.sha,
    },
    dependencies: input.dependencies ?? [],
    artifacts: input.artifacts,
    adapters,
    aliases: input.result.aliases,
  };
}

export function serializeLock(lock: Lockfile): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

export function writeLock(dir: string, lock: Lockfile): string {
  const p = join(dir, "loom.lock");
  writeFileSync(p, serializeLock(lock));
  return p;
}

/** Read and validate an existing lockfile; null when absent or malformed. */
export function readLock(dir: string): Lockfile | null {
  try {
    const text = readFileSync(join(dir, "loom.lock"), "utf8");
    const res = validate(Lockfile, JSON.parse(text));
    return res.ok ? res.value : null;
  } catch {
    return null;
  }
}
