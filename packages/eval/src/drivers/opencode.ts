import type { HarnessDriver, Transcript } from "@michaelfromyeg/weft-adapter-kit";
import { parseOpencodeStream } from "./parse";
import { cliAvailable, runCli } from "./util";

export const opencodeDriver: HarnessDriver = {
  target: "opencode",
  available: () => cliAvailable("opencode", ["--version"]),
  async run({ prompt, cwd, config, timeoutMs }): Promise<Transcript> {
    const res = await runCli("opencode", ["run", prompt, "--format", "json"], {
      cwd,
      config,
      timeoutMs,
    });
    const { finalText, toolCalls } = parseOpencodeStream(res.stdout);
    return { finalText, toolCalls, exitCode: res.exitCode, raw: res.stdout };
  },
};
