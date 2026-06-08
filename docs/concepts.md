# Concepts: plugin vs marketplace

Loom uses the two words coding-agent harnesses already use, plugin and
marketplace, and adds no new top-level concept. The only subtlety is that
"plugin" names both what you author (once, cross-harness) and what it compiles to
(one per harness); we disambiguate as "Loom plugin" vs "Claude plugin" where it matters.

## Plugin: one capability, authored once

A plugin is the authoring unit: a directory with one `loom.yaml` and the component
files it references (skills, MCP servers, agents, hooks, commands), each in its most
upstream-standard format (`SKILL.md`, `server.json`). A Loom plugin is harness-agnostic
source. It compiles to one native plugin per target harness:

```
                        +--> Claude plugin   (.claude-plugin/plugin.json + skills/ ...)
   plugin (loom.yaml) --+--> Cursor plugin   (.cursor-plugin/plugin.json + ...)
                        +--> OpenCode layout (directory-convention, no manifest)
                        +--> ...
```

So a Loom plugin is to a Claude plugin as source is to a compiled binary for one platform.
The adapter for each harness is the compiler backend that knows that harness's plugin
format. "Plugin" is already the harnesses' own word for their native installable unit, and
Loom's canonical format is a superset that any single harness's plugin maps into.

## Marketplace: a catalog that packages many plugins

A marketplace is an optional second authoring unit (`marketplace.yaml`) that lists
many plugins for discovery and installation, the company-internal-catalog use case.
It compiles to each harness's native catalog (for Claude, `.claude-plugin/marketplace.json`
listing each plugin and where to fetch it):

```
marketplace.yaml  -->  .claude-plugin/marketplace.json  (lists plugin A, plugin B, ...)
                  -->  <cursor catalog>
                  -->  ...
```

A marketplace references plugins (by `github:owner/repo`, a git URL, `npm:`, or a local
path); `loom build` on it resolves and compiles each, vendors the compiled plugin trees
under `plugins/`, and emits one catalog pointing at them.

## Loom extends what you already have

Loom does not replace plugins and marketplaces; it wraps and cross-compiles them:

- The canonical plugin format is a superset of any one harness's plugin, so "author a
  plugin once, compile to every harness" needs no new noun.
- (Planned) `loom import` will read an existing `.claude-plugin/` plugin or a
  `marketplace.json` and cross-compile it to the others, the "federate, don't wall off"
  goal applied to assets you already maintain.

## The one wrinkle: building a single plugin emits a marketplace too

`claude plugin validate` and the harness install flows expect a marketplace directory,
not a bare plugin. So `loom build <single-plugin>` wraps the one compiled plugin in a
synthetic one-entry marketplace:

```
out/claude/
  .claude-plugin/marketplace.json          # synthetic 1-entry catalog -> ./plugins/sample-plugin
  plugins/sample-plugin/
    .claude-plugin/plugin.json             # the compiled plugin
    skills/code-review/SKILL.md
    mcp/weather/server.json
```

A single plugin is not a marketplace; Loom just gift-wraps it in one so the output is
immediately installable and `claude plugin validate`-able. When you author a real
`marketplace.yaml`, that synthetic step is replaced by your curated catalog (and an entry's
`version` override flows into the compiled `plugin.json` so the two always agree).

## Piecemeal installation

You do not have to take a whole plugin. `loom install <plugin> --only code-review` installs
just that one component (one skill, one MCP server); the generated manifest reflects only
what you selected. This is the same mechanism dependencies use to pull a subset of another
plugin (`components: [...]`).

## Summary

| Layer        | Authored file      | Compiles to (Claude)                  | Analogy            |
|--------------|--------------------|---------------------------------------|--------------------|
| plugin       | `loom.yaml`        | a plugin (`plugin.json` + components)  | source code        |
| (per harness)| (generated)        | `.claude-plugin/plugin.json`           | compiled binary    |
| marketplace  | `marketplace.yaml` | `.claude-plugin/marketplace.json`      | app store listing  |
