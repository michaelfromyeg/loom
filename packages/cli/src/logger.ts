// The CLI's single output funnel: every other file logs through `log`, so the
// libraries stay console-free and verbosity is controlled in one place. Flags are
// read once from argv (citty parses them per-command; we only need their presence):
//   --quiet/-q    errors only
//   --verbose/-v  include debug lines
//   --json        machine-readable output (human lines suppressed; use log.data)

type Level = "error" | "warn" | "info" | "debug";
const RANK: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function thresholdFrom(argv: string[]): number {
  if (argv.includes("--json")) return RANK.error;
  if (argv.includes("--quiet") || argv.includes("-q")) return RANK.error;
  if (argv.includes("--verbose") || argv.includes("-v")) return RANK.debug;
  return RANK.info;
}

const isJson = process.argv.includes("--json");
const threshold = thresholdFrom(process.argv);

function emit(level: Level, message: string): void {
  if (RANK[level] > threshold) return;
  // biome-ignore lint/suspicious/noConsole: this module is the CLI's output funnel.
  if (level === "error" || level === "warn") console.error(message);
  // biome-ignore lint/suspicious/noConsole: this module is the CLI's output funnel.
  else console.log(message);
}

export const log = {
  /** True when --json is set; commands emit a result object via `data` instead of prose. */
  json: isJson,
  error: (message: string): void => emit("error", message),
  warn: (message: string): void => emit("warn", message),
  info: (message: string): void => emit("info", message),
  debug: (message: string): void => emit("debug", message),
  /** Emit a structured result. Prints JSON only in --json mode; a no-op otherwise. */
  data: (obj: unknown): void => {
    // biome-ignore lint/suspicious/noConsole: this module is the CLI's output funnel.
    if (isJson) console.log(JSON.stringify(obj));
  },
};
