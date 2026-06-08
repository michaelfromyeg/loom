import type { HarnessDriver, Transcript } from "@michaelfromyeg/loom-adapter-kit";
import { parseCursorStream } from "./parse";
import { cliAvailable, runCli } from "./util";

export const cursorDriver: HarnessDriver = {
  target: "cursor",
  available: () => cliAvailable("cursor-agent", ["--version"]),
  async run({ prompt, cwd, config, timeoutMs }): Promise<Transcript> {
    const res = await runCli(
      "cursor-agent",
      ["-p", prompt, "--force", "--output-format", "stream-json"],
      { cwd, config, timeoutMs },
    );
    const { finalText, toolCalls } = parseCursorStream(res.stdout);
    return { finalText, toolCalls, exitCode: res.exitCode, raw: res.stdout };
  },
};
