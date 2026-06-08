import type { HarnessDriver, Transcript } from "@michaelfromyeg/weft-adapter-kit";
import { parseClaudeStream } from "./parse";
import { cliAvailable, runCli } from "./util";

// The allow-list (with acceptEdits) keeps the model answering the prompt rather than
// freely executing it: `bypassPermissions` was tried, but on a knowledge-skill eval it
// made the model RUN the command instead of stating it, so the final text no longer
// contained the answer. Including `Skill` activates an installed skill and `Task` lets a
// sub-agent spawn; MCP/command real-activation needs the harness's tool names (not
// available to the static driver) and is honestly reported UNTESTED there. The eval runs
// in a throwaway scratch dir (runner.ts). --output-format stream-json --verbose keeps the
// tool-call stream so `trace` assertions stay meaningful.
const ALLOWED_TOOLS = "Read,Edit,Write,Bash,Grep,Glob,WebFetch,Skill,Task";

export const claudeDriver: HarnessDriver = {
  target: "claude",
  available: () => cliAvailable("claude", ["--version"]),
  async run({ prompt, cwd, config, timeoutMs }): Promise<Transcript> {
    const res = await runCli(
      "claude",
      [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        ALLOWED_TOOLS,
      ],
      { cwd, config, timeoutMs },
    );
    const { finalText, toolCalls } = parseClaudeStream(res.stdout);
    return { finalText, toolCalls, exitCode: res.exitCode, raw: res.stdout };
  },
};
