import JSON5 from "json5";
import * as YAML from "yaml";
import type { z } from "zod";
import { detectComponentKind, schemaForKind } from "./component";
import { Plugin } from "./plugin";

export type DocFormat = "yaml" | "json5" | "auto";

export interface ParseIssue {
  path: string;
  message: string;
}
export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: ParseIssue[] };

function guessFormat(filename?: string): "yaml" | "json5" {
  if (filename && /\.json5$/i.test(filename)) return "json5";
  return "yaml";
}

/**
 * Read raw manifest text into a plain object.
 *
 * YAML is parsed in **1.2 core** mode, which kills the "Norway problem": only
 * `true`/`false` are booleans, so `no`/`yes`/`on`/`off` stay strings. (Unquoted
 * `1.10` still becomes the float `1.1` per YAML semantics — but version fields
 * are typed as strings, so that surfaces as a precise Zod error telling the
 * author to quote it.) `strict` rejects duplicate keys. JSON5 input is accepted
 * against the same schemas.
 */
export function parseDocument(
  text: string,
  format: DocFormat = "auto",
  filename?: string,
): unknown {
  const fmt = format === "auto" ? guessFormat(filename) : format;
  if (fmt === "json5") return JSON5.parse(text);
  return YAML.parse(text, { version: "1.2", schema: "core", strict: true });
}

function pathStr(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else {
      const key = String(seg);
      out += out ? `.${key}` : key;
    }
  }
  return out;
}

/** Validate an already-parsed object against a schema, returning path-precise issues. */
export function validate<T>(schema: z.ZodType<T>, raw: unknown): ParseResult<T> {
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  return {
    ok: false,
    issues: r.error.issues.map((iss) => ({ path: pathStr(iss.path), message: iss.message })),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse a plugin with kind-aware component routing, so a malformed component
 * produces `components[2].mcp: Required` rather than a noisy union error.
 */
export function parsePlugin(raw: unknown): ParseResult<Plugin> {
  const issues: ParseIssue[] = [];

  if (isRecord(raw) && Array.isArray(raw.components)) {
    raw.components.forEach((c, i) => {
      const det = detectComponentKind(c);
      if (!det.ok) {
        issues.push({ path: `components[${i}]`, message: det.error });
        return;
      }
      const r = schemaForKind(det.kind).safeParse(c);
      if (!r.success) {
        for (const iss of r.error.issues) {
          issues.push({ path: `components[${i}].${pathStr(iss.path)}`, message: iss.message });
        }
      }
    });
  }

  const full = Plugin.safeParse(raw);
  if (!full.success) {
    for (const iss of full.error.issues) {
      // Skip generic union noise on components — pass 1 gave precise messages.
      if (issues.length > 0 && iss.path[0] === "components") continue;
      issues.push({ path: pathStr(iss.path), message: iss.message });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  // No issues means the full parse succeeded (a bad component fails Plugin too).
  return { ok: true, value: (full as { data: Plugin }).data };
}

/** Convenience: read text (YAML/JSON5) and validate against any schema. */
export function loadManifest<T>(
  schema: z.ZodType<T>,
  text: string,
  opts: { format?: DocFormat; filename?: string } = {},
): ParseResult<T> {
  let raw: unknown;
  try {
    raw = parseDocument(text, opts.format ?? "auto", opts.filename);
  } catch (err) {
    return { ok: false, issues: [{ path: "", message: `parse error: ${(err as Error).message}` }] };
  }
  return validate(schema, raw);
}

/** Read text (YAML/JSON5) and parse as a plugin with component routing. */
export function loadPlugin(
  text: string,
  opts: { format?: DocFormat; filename?: string } = {},
): ParseResult<Plugin> {
  let raw: unknown;
  try {
    raw = parseDocument(text, opts.format ?? "auto", opts.filename);
  } catch (err) {
    return { ok: false, issues: [{ path: "", message: `parse error: ${(err as Error).message}` }] };
  }
  return parsePlugin(raw);
}
