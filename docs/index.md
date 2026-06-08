# Loom

**Author a plugin once, compile it to every coding-agent harness** -- Claude Code, OpenAI
Codex, Cursor, GitHub Copilot, OpenCode -- with built-in **evals** and **trust**. Loom is a
compiler + conventions, not a hosted platform.

```sh
loom init my-plugin            # author once: loom.yaml + a SKILL.md
loom build my-plugin           # compile to every harness (zero hand-written JSON)
loom install my-plugin         # place into the harnesses you actually have
loom eval my-plugin            # drive the REAL headless harness and assert
loom publish my-plugin         # deterministic trust gate (valid + scan + evals)
```

## Documentation

- [Concepts](concepts.md) -- **start here**: plugin vs marketplace.
- [Demo](demo.md) -- five real-world use cases, end to end.
- [Getting started](getting-started.md) -- a full CLI walkthrough.
- [CLI reference](cli.md) -- every command, generated from the tree.
- [Architecture](architecture.md) -- the compile pipeline + the adapter seam.
- [Authoring plugins](authoring.md) -- `loom.yaml` / `marketplace.yaml` / `cases.yaml`.
- [Writing an adapter](writing-adapters.md) -- the public contract.
- [Harness research](harness-research.md) -- verified per-harness facts.
- [Roadmap](roadmap.md) -- phased plan and acceptance status (all phases done).

## Why

Every harness now supports the same primitives (skills, MCP servers, sub-agents, hooks,
commands) bundled as a plugin and distributed through a marketplace -- but each has its own
manifest format. Loom lets you write the canonical, upstream-standard sources once
(`SKILL.md`, MCP `server.json`) and **generates** every harness's native manifests, the
marketplace catalog, eval results, and trust badges. Distribution stays git-first.

[View Loom on GitHub](https://github.com/michaelfromyeg/loom)
