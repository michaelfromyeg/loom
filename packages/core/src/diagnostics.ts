export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: Severity;
  /** Path-precise location: "components[1].mcp", "owner.namespace", or a file path. */
  where: string;
  message: string;
}

/** Accumulates diagnostics during compile; fails closed when any error is present. */
export class Diagnostics {
  readonly items: Diagnostic[] = [];

  error(where: string, message: string): void {
    this.items.push({ severity: "error", where, message });
  }
  warn(where: string, message: string): void {
    this.items.push({ severity: "warning", where, message });
  }
  info(where: string, message: string): void {
    this.items.push({ severity: "info", where, message });
  }

  get hasErrors(): boolean {
    return this.items.some((d) => d.severity === "error");
  }

  get errors(): Diagnostic[] {
    return this.items.filter((d) => d.severity === "error");
  }
}

export class CompileError extends Error {
  constructor(
    message: string,
    readonly diagnostics: Diagnostic[],
  ) {
    super(message);
    this.name = "CompileError";
  }
}
