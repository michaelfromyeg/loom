# Weft

Author a plugin once, then compile it to every coding-agent harness: Claude Code, OpenAI
Codex, Cursor, GitHub Copilot, and OpenCode. Evals and trust come built in. Weft is a
compiler plus conventions, not a hosted platform.

```sh
weft init my-plugin            # author once: weft.yaml + a SKILL.md
weft build my-plugin           # compile to every harness (zero hand-written JSON)
weft install my-plugin         # place into the harnesses you actually have
weft eval my-plugin            # drive the REAL headless harness and assert
weft publish my-plugin         # deterministic trust gate (valid + scan + evals)
```

## Documentation

- [Concepts](concepts.md). Start here: plugin vs marketplace.
- [Demo](demo.md). Five real-world use cases, end to end.
- [Getting started](getting-started.md). A full CLI walkthrough.
- [CLI reference](cli.md). Every command, generated from the tree.
- [Architecture](architecture.md). The compile pipeline and the adapter seam.
- [Authoring plugins](authoring.md). `weft.yaml` / `marketplace.yaml` / `cases.yaml`.
- [Writing an adapter](writing-adapters.md). The public contract.
- [Harness research](harness-research.md). Verified per-harness facts.
- [Roadmap](roadmap.md). Phased plan and acceptance status (all phases done).

## Why

Every harness now supports the same primitives (skills, MCP servers, sub-agents, hooks,
commands) bundled as a plugin and distributed through a marketplace, but each has its own
manifest format. Weft lets you write the canonical, upstream-standard sources once
(`SKILL.md`, MCP `server.json`) and generates every harness's native manifests, the
marketplace catalog, eval results, and trust badges. Distribution stays git-first.

[View Weft on GitHub](https://github.com/michaelfromyeg/weft)
