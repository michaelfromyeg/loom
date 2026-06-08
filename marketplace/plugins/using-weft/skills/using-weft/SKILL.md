---
name: using-weft
description: Author an agent capability once (a skill or an MCP server) and compile it to every coding-agent harness with Weft. Use when the user wants to write, build, install, evaluate, or import Weft plugins and marketplaces.
---

Weft is a compiler. You author a capability once in upstream-standard formats and Weft
compiles it to each harness's native plugin layout (Claude Code, Codex, Cursor, Copilot,
OpenCode). The author writes standards; the adapter for each harness is the only place that
knows that harness's quirks.

## The two things you author

- A skill is a directory with a `SKILL.md` (YAML frontmatter `name` + `description`, then a
  Markdown body of instructions). This file is itself a skill.
- An MCP server is a directory with a `server.json` (the MCP Registry standard). Weft derives
  each harness's runnable config from it.

A plugin groups components and is described by a `weft.yaml`:

```yaml
name: my-plugin
version: 0.1.0
owner: { name: You, namespace: com.example }
description: What it does.
components:
  - skill: skills/my-skill
  - mcp: mcp/my-server
```

A `marketplace.yaml` packages many plugins (the company-marketplace case).

## The workflow

```sh
weft init my-plugin --namespace com.example       # scaffold weft.yaml + a sample skill
weft validate my-plugin                            # static checks (schema, namespacing)
weft build my-plugin --out out                     # compile to every registered harness (no install)
weft install my-plugin                              # place into every installed harness
weft install my-plugin --target claude,codex        # install to only Claude Code and Codex
```

`weft install` detects which harnesses are present and installs to all of them, skipping the
rest and reporting what it skipped. To install to only a specific set, pass that set to
`--target`: the exact command for Claude Code and Codex is `weft install my-plugin --target
claude,codex`. Force placement for an absent harness with `--all`, and install a single
component with `--only my-skill`. It writes a content-addressed `weft.lock`; `weft update`
re-places only artifacts whose hash changed, and `weft uninstall` removes everything it placed.

Point `weft install` at a `marketplace.yaml` instead of a plugin and it installs every plugin
in the marketplace across the targets in one command. The same primitive at a larger scale.

## Evaluating and importing

- `weft eval my-plugin` runs a component's evals against the real headless harnesses and
  reports per-harness PASS/FAIL, honestly marking a harness UNTESTED when it can't run.
- `weft import --from claude ./existing-plugin` reverse-compiles an existing native plugin or
  marketplace into the Weft model so you can cross-compile assets you already maintain.
  Import is any-to-any across all five harnesses.

## Output, machine-readable

Every command takes `--quiet` (errors only), `--verbose`, and `--json` (a structured result
on stdout) so you can script Weft.

The rule of thumb: never hand-edit a generated manifest. Change the source standard and
recompile. If a harness changes its format, that is one adapter's problem, not yours.
