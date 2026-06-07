import type { HarnessDriver } from "@loom/adapter-kit";
import type { Target } from "@loom/schema";
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
export * from "./parse";
export type { CliResult } from "./util";

/** Every built-in headless driver, keyed by Target. */
export const drivers: Record<Target, HarnessDriver> = {
  claude: claudeDriver,
  codex: codexDriver,
  cursor: cursorDriver,
  copilot: copilotDriver,
  opencode: opencodeDriver,
};
