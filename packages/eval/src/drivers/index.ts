import type { HarnessDriver } from "@michaelfromyeg/weft-adapter-kit";
import type { Target } from "@michaelfromyeg/weft-schema";
import { claudeDriver } from "./claude";
import { codexDriver } from "./codex";
import { copilotDriver } from "./copilot";
import { cursorDriver } from "./cursor";
import { opencodeDriver } from "./opencode";

export { claudeDriver } from "./claude";
export { codexDriver } from "./codex";
export { copilotDriver } from "./copilot";
export { cursorDriver } from "./cursor";
export { opencodeDriver } from "./opencode";
export {
  parseClaudeStream,
  parseCodexStream,
  parseCursorStream,
  parseLines,
  parseOpencodeStream,
} from "./parse";
export type { CliResult } from "./util";

/** Every built-in headless driver, keyed by Target. */
export const drivers: Partial<Record<Target, HarnessDriver>> = {
  claude: claudeDriver,
  codex: codexDriver,
  cursor: cursorDriver,
  copilot: copilotDriver,
  opencode: opencodeDriver,
};
