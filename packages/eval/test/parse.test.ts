import { describe, expect, it } from "vitest";
import {
  parseClaudeStream,
  parseCodexStream,
  parseCursorStream,
  parseOpencodeStream,
} from "../src/drivers/parse";

describe("driver output parsers", () => {
  it("parses Claude stream-json (tool_use blocks + result)", () => {
    const ndjson = [
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"x"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}',
      '{"type":"result","result":"I found a bug"}',
    ].join("\n");
    const { finalText, toolCalls } = parseClaudeStream(ndjson);
    expect(toolCalls.map((c) => c.name)).toEqual(["Read"]);
    expect(toolCalls[0].args).toEqual({ file_path: "x" });
    expect(finalText).toBe("I found a bug");
  });

  it("parses Codex JSONL (counts completed items, not started)", () => {
    const jsonl = [
      '{"type":"thread.started"}',
      '{"type":"item.started","item":{"id":"i1","type":"command_execution","command":"ls"}}',
      '{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"ls","status":"completed"}}',
      '{"type":"item.completed","item":{"type":"mcp_tool_call","tool":"weather"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}',
    ].join("\n");
    const { finalText, toolCalls } = parseCodexStream(jsonl);
    expect(toolCalls.map((c) => c.name)).toEqual(["command_execution", "weather"]);
    expect(finalText).toBe("done");
  });

  it("parses Cursor stream-json (completed tool_call, derives tool name)", () => {
    const ndjson = [
      '{"type":"system"}',
      '{"type":"tool_call","subtype":"started","call_id":"c1","tool_call":{"readToolCall":{}}}',
      '{"type":"tool_call","subtype":"completed","call_id":"c1","tool_call":{"readToolCall":{}}}',
      '{"type":"result","result":"reviewed"}',
    ].join("\n");
    const { finalText, toolCalls } = parseCursorStream(ndjson);
    expect(toolCalls.map((c) => c.name)).toEqual(["read"]);
    expect(finalText).toBe("reviewed");
  });

  it("parses OpenCode JSONL (tool_use part + concatenated text)", () => {
    const jsonl = [
      '{"type":"step_start"}',
      '{"type":"tool_use","part":{"callID":"p1","tool":"bash","state":{"status":"completed","input":{"command":"ls"},"output":"x"}}}',
      '{"type":"text","part":{"text":"hello "}}',
      '{"type":"text","text":"world"}',
      '{"type":"step_finish"}',
    ].join("\n");
    const { finalText, toolCalls } = parseOpencodeStream(jsonl);
    expect(toolCalls.map((c) => c.name)).toEqual(["bash"]);
    expect(toolCalls[0].result).toBe("x");
    expect(finalText).toBe("hello world");
  });

  it("tolerates blank and non-JSON noise lines", () => {
    const { toolCalls, finalText } = parseClaudeStream(
      '\n  \nnot json\n{"type":"result","result":"ok"}',
    );
    expect(toolCalls).toEqual([]);
    expect(finalText).toBe("ok");
  });
});
