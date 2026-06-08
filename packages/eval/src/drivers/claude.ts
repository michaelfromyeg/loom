import type { HarnessDriver, Transcript } from "@michaelfromyeg/loom-adapter-kit";
import { parseClaudeStream } from "./parse";
import { cliAvailable, runCli } from "./util";

const ALLOWED_TOOLS = "Read,Edit,Write,Bash,Grep,Glob,WebFetch";

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
