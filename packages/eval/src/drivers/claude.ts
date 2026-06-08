import type { HarnessDriver, Transcript } from "@michaelfromyeg/weft-adapter-kit";
import { parseClaudeStream } from "./parse";
import { cliAvailable, runCli } from "./util";

// Include "Skill" so an installed plugin's skill can actually activate during an
// eval; without it, headless claude answers from general knowledge and a skill is
// never exercised (the whole point of the eval).
const ALLOWED_TOOLS = "Read,Edit,Write,Bash,Grep,Glob,WebFetch,Skill";

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
