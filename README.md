# Loom

**A cross-harness agent-plugin framework: author once, compile to every coding-agent
harness, with built-in evals and trust.**

Every coding-agent harness -- Claude Code, OpenAI Codex, Cursor, GitHub Copilot,
OpenCode -- now supports roughly the same extension primitives (skills, MCP servers,
sub-agents, hooks, commands) bundled as a plugin and distributed through a marketplace.
But each harness has its own manifest format and marketplace mechanics. Shipping one
capability to all of them today means hand-writing several manifests, submitting to
several catalogs, and keeping versions in sync by hand -- with no standard way to *test*
a component or signal that it is *trustworthy*.

Loom is a **compiler + conventions** (not a hosted platform) that fixes this:

- You author a **plugin** once, in each component's most upstream-standard format
  (`SKILL.md`, MCP `server.json`, ...).
- `loom build` compiles the plugin to every harness's native manifests *and* the
  marketplace catalog -- no hand-written JSON.
- Distribution stays **git-first**; an optional metadata-only index can federate
  existing marketplaces (notably the official MCP Registry).
- **Evals** and **trust badges** are first-class artifacts that live in the plugin repo
  and gate publishing.

## Quickstart

```sh
pnpm install
pnpm build                       # compile all packages
loom init my-plugin              # scaffold loom.yaml + a sample skill
loom validate my-plugin          # static validation (the "valid" badge)
loom build my-plugin --out out   # compile to harness manifests
loom install my-plugin --scope project   # place files + write loom.lock
```

During development the CLI runs straight off TypeScript source via Bun:

```sh
bun packages/cli/src/index.ts validate fixtures/sample-plugin
```

## Status

Phase 0 (Claude Code) is implemented and tested end-to-end: a plugin compiles to a valid
`.claude-plugin/marketplace.json` + `plugin.json` + placed components with **zero
hand-written JSON**, passes `claude plugin validate --strict`, installs with a
content-addressed `loom.lock`, and rebuilds to identical hashes. See
[docs/roadmap.md](docs/roadmap.md) for the full phase plan and what is implemented.

## Documentation

- [Concepts](docs/concepts.md) -- **start here**: plugin vs marketplace.
- [Getting started](docs/getting-started.md) -- a full CLI walkthrough.
- [CLI reference](docs/cli.md) -- a generated map of every command (`loom docs`).
- [Architecture](docs/architecture.md) -- the compile pipeline, packages, and the adapter seam.
- [Authoring plugins](docs/authoring.md) -- the `loom.yaml` / `marketplace.yaml` / `cases.yaml` reference.
- [Writing an adapter](docs/writing-adapters.md) -- the public contract a community adapter implements.
- [Harness research](docs/harness-research.md) -- verified facts per harness (mid-2026).
- [Roadmap](docs/roadmap.md) -- phased build plan and acceptance status.

## Repository layout

```
packages/
  schema/          @loom/schema       Zod schemas + types + JSON-Schema export
  core/            @loom/core         compile pipeline, resolver, lockfile, namespacing
  adapter-kit/     @loom/adapter-kit  public HarnessAdapter/Driver interfaces + helpers
  adapter-claude/  @loom/adapter-claude
  cli/             @loom/cli          the `loom` binary (thin shell over core)
fixtures/
  sample-plugin/                      end-to-end test plugin (1 skill + 1 mcp + evals)
```

## Toolchain

TypeScript (strict), developed with **Bun**, shipped **Node-compatible** (published
packages use only `node:*` APIs). pnpm workspaces, Vitest, Biome, changesets, tsup.
The standalone binary is produced with `bun build --compile`.

## License

MIT
