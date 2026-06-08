import type { ToolCall } from "@michaelfromyeg/loom-adapter-kit";

/** Split NDJSON/JSONL into parsed objects, skipping blank/garbage lines. */
export function parseLines(raw: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // tolerate non-JSON noise lines
    }
  }
  return out;
}

/**
 * Parse Claude's `--output-format stream-json --verbose` NDJSON. Tool calls are
 * `assistant` message content blocks `{type:"tool_use", name, input}`; the final
 * text is the `result` event's `result` field (see harness-research.md).
 */
export function parseClaudeStream(raw: string): { finalText: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  let finalText = "";
  let ts = 0;
  for (const evt of parseLines(raw)) {
    if (evt.type === "assistant") {
      const content = (evt.message as { content?: unknown[] } | undefined)?.content ?? [];
      for (const block of content as Array<Record<string, unknown>>) {
        if (block?.type === "tool_use") {
          toolCalls.push({ name: String(block.name), args: block.input, ts: ts++ });
        }
      }
    } else if (evt.type === "result" && typeof evt.result === "string") {
      finalText = evt.result;
    }
  }
  return { finalText, toolCalls };
}

/**
 * Parse Codex `exec --json` JSONL. Tool calls live in `item.completed` events by
 * `item.type`; the final text is the `agent_message` item. Only completed items
 * are counted to avoid double-counting the matching `item.started`.
 */
export function parseCodexStream(raw: string): { finalText: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  let finalText = "";
  let ts = 0;
  for (const evt of parseLines(raw)) {
    if (evt.type !== "item.completed") continue;
    const item = evt.item as Record<string, unknown> | undefined;
    if (!item) continue;
    const kind = String(item.type);
    if (kind === "agent_message") {
      finalText = String(item.text ?? item.message ?? finalText);
    } else if (kind !== "reasoning") {
      const name = kind === "mcp_tool_call" ? String(item.tool ?? item.name ?? kind) : kind;
      toolCalls.push({ name, args: item, ts: ts++ });
    }
  }
  return { finalText, toolCalls };
}

/** Best-effort tool name from a Cursor `tool_call` event (e.g. {readToolCall:{}} -> "read"). */
function cursorToolName(evt: Record<string, unknown>): string {
  const tc = (evt.tool_call ?? evt.toolCall) as Record<string, unknown> | undefined;
  if (tc && typeof tc === "object") {
    // TODO(verify): the exact tool-name field of cursor-agent stream-json events.
    const key = Object.keys(tc).find((k) => /ToolCall$/.test(k));
    if (key) return key.replace(/ToolCall$/, "");
    if (typeof tc.name === "string") return tc.name;
  }
  return typeof evt.name === "string" ? evt.name : "tool";
}

/**
 * Parse Cursor `--output-format stream-json` NDJSON. Tool calls are `tool_call`
 * events (count the `completed` subtype); the final text is the `result` event.
 */
export function parseCursorStream(raw: string): { finalText: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  let finalText = "";
  let ts = 0;
  for (const evt of parseLines(raw)) {
    if (evt.type === "tool_call" && (evt.subtype === "completed" || evt.subtype === undefined)) {
      toolCalls.push({ name: cursorToolName(evt), args: evt.tool_call ?? evt, ts: ts++ });
    } else if (evt.type === "result" && typeof evt.result === "string") {
      finalText = evt.result;
    }
  }
  return { finalText, toolCalls };
}

/**
 * Parse OpenCode `run --format json` JSONL. Tool calls are `tool_use` events
 * carrying a ToolPart (`part.tool`, `part.state.{input,output}`); the final text
 * is the concatenation of `text` events.
 */
export function parseOpencodeStream(raw: string): { finalText: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  let finalText = "";
  let ts = 0;
  for (const evt of parseLines(raw)) {
    if (evt.type === "tool_use") {
      const part = (evt.part ?? evt) as Record<string, unknown>;
      const state = part.state as Record<string, unknown> | undefined;
      toolCalls.push({
        name: String(part.tool ?? "tool"),
        args: state?.input,
        result: state?.output,
        ts: ts++,
      });
    } else if (evt.type === "text") {
      const part = evt.part as { text?: string } | undefined;
      finalText += String(evt.text ?? part?.text ?? "");
    }
  }
  return { finalText, toolCalls };
}
