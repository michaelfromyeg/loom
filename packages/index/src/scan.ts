import { loadPluginDir } from "@michaelfromyeg/loom-core";
import { kindOf, refOf } from "@michaelfromyeg/loom-schema";

export interface ScanFinding {
  file: string;
  pattern: string;
  line: number;
}
export interface ScanResult {
  clean: boolean;
  findings: ScanFinding[];
}

/**
 * A small built-in heuristic scanner for the `scanned` badge. It flags obviously
 * dangerous patterns in executable/hook/passthrough artifacts. Production would
 * also run garak / AI-Infra-Guard-style scanners; this is the offline default.
 */
const DANGEROUS: Array<{ re: RegExp; name: string }> = [
  { re: /rm\s+-rf?\s+[/~]/, name: "recursive force delete of root/home" },
  { re: /curl\s+[^|]*\|\s*(sudo\s+)?(ba)?sh/, name: "curl-pipe-to-shell" },
  { re: /wget\s+[^|]*\|\s*(ba)?sh/, name: "wget-pipe-to-shell" },
  { re: /:\(\)\s*\{\s*:\s*\|\s*:&\s*\}\s*;\s*:/, name: "fork bomb" },
  { re: /\b(AKIA[0-9A-Z]{16}|aws_secret_access_key)/i, name: "embedded AWS credential" },
];

export function scanText(file: string, text: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  text.split("\n").forEach((line, i) => {
    for (const d of DANGEROUS) {
      if (d.re.test(line)) findings.push({ file, pattern: d.name, line: i + 1 });
    }
  });
  return findings;
}

/** Scan a plugin's executable/hook/passthrough artifacts (the `scanned` badge, §10). */
export function scanPlugin(pluginDir: string): ScanResult {
  const loaded = loadPluginDir(pluginDir);
  if (!loaded.ok) {
    return {
      clean: false,
      findings: [{ file: pluginDir, pattern: "could not load plugin", line: 0 }],
    };
  }
  const findings: ScanFinding[] = [];
  for (const c of loaded.value.plugin.components) {
    const kind = kindOf(c);
    if (kind !== "hook" && kind !== "passthrough") continue;
    const ref = refOf(c);
    const files = loaded.value.list(ref);
    for (const f of files.length > 0 ? files : [ref]) {
      try {
        findings.push(...scanText(f, loaded.value.read(f).toString("utf8")));
      } catch {
        // unreadable artifact -- skip
      }
    }
  }
  return { clean: findings.length === 0, findings };
}
