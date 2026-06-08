import type { HarnessDriver, Transcript } from "@michaelfromyeg/weft-adapter-kit";
import { parseCodexStream } from "./parse";
import { cliAvailable, runCli } from "./util";

export const codexDriver: HarnessDriver = {
  target: "codex",
  available: () => cliAvailable("codex", ["--version"]),
  async run({ prompt, cwd, config, timeoutMs }): Promise<Transcript> {
    const res = await runCli(
      "codex",
      ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", prompt],
      { cwd, config, timeoutMs },
    );
    const { finalText, toolCalls } = parseCodexStream(res.stdout);
    return { finalText, toolCalls, exitCode: res.exitCode, raw: res.stdout };
  },
};
