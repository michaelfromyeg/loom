import type { HarnessDriver, Transcript } from "@michaelfromyeg/loom-adapter-kit";
import { cliAvailable, runCli } from "./util";

/**
 * GitHub Copilot's headless `-p` mode exposes NO structured tool-call trace today
 * (only a Markdown transcript via --share). So `run` returns the final text with
 * `traceUnavailable: true`, and the runner degrades `trace` assertions to `output`
 * for this harness rather than faking a pass (spec §14, harness-research.md).
 */
export const copilotDriver: HarnessDriver = {
  target: "copilot",
  available: () => cliAvailable("copilot", ["--version"]),
  async run({ prompt, cwd, config, timeoutMs }): Promise<Transcript> {
    const res = await runCli("copilot", ["-p", prompt, "-s", "--allow-all"], {
      cwd,
      config,
      timeoutMs,
    });
    return {
      finalText: res.stdout.trim(),
      toolCalls: [],
      exitCode: res.exitCode,
      raw: res.stdout,
      traceUnavailable: true,
    };
  },
};
