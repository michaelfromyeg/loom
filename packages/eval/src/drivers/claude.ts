import type { HarnessDriver, Transcript } from "@michaelfromyeg/weft-adapter-kit";
import { parseClaudeStream } from "./parse";
import { cliAvailable, runCli } from "./util";

// bypassPermissions (rather than an --allowedTools allow-list) lets every installed
// component kind actually activate during an eval: a skill via the Skill tool, an MCP
// server via its mcp__* tools, a sub-agent via Task, a slash command directly. The
// allow-list silently blocked all but the listed tools, so only skills were exercised.
// The eval installs into a throwaway scratch dir (runner.ts), so running real tools is
// contained. --output-format stream-json --verbose keeps the tool-call stream, so
// `trace` assertions stay meaningful.
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
        "bypassPermissions",
      ],
      { cwd, config, timeoutMs },
    );
    const { finalText, toolCalls } = parseClaudeStream(res.stdout);
    return { finalText, toolCalls, exitCode: res.exitCode, raw: res.stdout };
  },
};
