# Getting started

This walks through the full Phase 0 loop with the Claude Code adapter.

## Prerequisites

- Node 20+ and pnpm 10+.
- Bun (for the dev loop and the standalone binary): `curl -fsSL https://bun.sh/install | bash`.
- Optional: the `claude` CLI, to run `claude plugin validate` on generated output.

```sh
pnpm install
```

## Running the CLI

During development the CLI runs straight off TypeScript source via Bun (it resolves
`@michaelfromyeg/weft-*` through the workspace tsconfig `paths`):

```sh
bun packages/cli/src/index.ts <command>
```

After `pnpm build`, the Node-compatible binary is at `packages/cli/dist/index.js`, and a
standalone executable can be produced with:

```sh
bun build packages/cli/src/index.ts --compile --outfile weft
```

## 1. Scaffold a plugin

```sh
bun packages/cli/src/index.ts init my-plugin --namespace com.example
```

Creates `my-plugin/weft.yaml` and a sample `skills/hello/SKILL.md`. `init` never clobbers
an existing plugin.

## 2. Validate

```sh
bun packages/cli/src/index.ts validate my-plugin
# com.example/my-plugin: valid (1 components)
```

`validate` runs the static pass: every referenced file exists, frontmatter is well-formed,
`server.json` parses, and names do not collide. Errors are path-precise and exit non-zero.

## 3. Build

```sh
bun packages/cli/src/index.ts build fixtures/sample-plugin --out out
```

Produces, per target, an inspectable marketplace + plugin layout:

```
out/claude/.claude-plugin/marketplace.json
out/claude/plugins/sample-plugin/.claude-plugin/plugin.json
out/claude/plugins/sample-plugin/skills/code-review/SKILL.md
out/claude/plugins/sample-plugin/mcp/weather/server.json
```

If the `claude` CLI is installed, the output validates:

```sh
claude plugin validate out/claude --strict   # exit 0
```

`build` is deterministic; the same plugin always produces identical content hashes.

## 4. Install

```sh
bun packages/cli/src/index.ts install fixtures/sample-plugin \
  --scope project --cwd /tmp/sandbox
```

`install` prints a trust summary (components by kind, every executable artifact, every
MCP server that will run, publisher-verification state), copies the plugin tree into
`<cwd>/.claude/plugins/<plugin>/`, and writes `weft.lock` next to `weft.yaml`.

Install never executes plugin code. It is strictly fetch, compile, place.
Executable and passthrough artifacts are placed disabled; enabling them is a separate
explicit opt-in (spec §11).

## The sample plugin

`fixtures/sample-plugin` is the canonical end-to-end fixture:

```
weft.yaml                         # 2 components: a skill + an MCP server
skills/code-review/SKILL.md       # standard SKILL.md, stored verbatim
mcp/weather/server.json           # MCP-standard server.json, stored verbatim
evals/code-review.cases.yaml      # eval cases (run in a later phase)
```

The weather `server.json` declares an npm package; the Claude adapter derives an inline
`mcpServers` entry (`npx -y @acme/weather-mcp@1.0.0`) in the generated `plugin.json`.
