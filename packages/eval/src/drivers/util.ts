import { execa } from "execa";

/** True iff `cmd <versionArgs>` exits 0 (CLI installed). Never throws. */
export async function cliAvailable(cmd: string, versionArgs: string[]): Promise<boolean> {
  try {
    const r = await execa(cmd, versionArgs, { reject: false, timeout: 10_000 });
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run a harness CLI headlessly. Resolved config is passed as env; never throws. */
export async function runCli(
  cmd: string,
  args: string[],
  opts: { cwd: string; config?: Record<string, string>; timeoutMs?: number },
): Promise<CliResult> {
  try {
    const r = await execa(cmd, args, {
      cwd: opts.cwd,
      reject: false,
      timeout: opts.timeoutMs ?? 120_000,
      env: opts.config ?? {},
    });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.exitCode ?? 1 };
  } catch (err) {
    return { stdout: "", stderr: (err as Error).message, exitCode: 1 };
  }
}
