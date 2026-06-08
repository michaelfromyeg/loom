import { z } from "zod";
import { EvalFile } from "./evals";
import { Lockfile } from "./lockfile";
import { Marketplace } from "./marketplace";
import { Plugin } from "./plugin";

/** Canonical manifests for which we publish a `$schema` for editor autocomplete. */
export const SCHEMAS = {
  "weft.yaml": Plugin,
  "marketplace.yaml": Marketplace,
  "weft.lock": Lockfile,
  "cases.yaml": EvalFile,
} as const;

export type SchemaName = keyof typeof SCHEMAS;

/** Export a JSON Schema (draft 2020-12) for one canonical manifest. */
export function jsonSchemaFor(name: SchemaName): unknown {
  return z.toJSONSchema(SCHEMAS[name], { target: "draft-2020-12" });
}

/** Export JSON Schemas for every canonical manifest, keyed by file name. */
export function allJsonSchemas(): Record<SchemaName, unknown> {
  const out = {} as Record<SchemaName, unknown>;
  for (const name of Object.keys(SCHEMAS) as SchemaName[]) {
    out[name] = jsonSchemaFor(name);
  }
  return out;
}
