---
name: developing-weft
description: Work on Weft itself, covering the pnpm monorepo layout, the HarnessAdapter seam, adding a new harness adapter, and the test/coverage gates. Use when contributing to the Weft compiler rather than authoring a plugin.
---

Weft is a pnpm + Bun monorepo. Every package publishes as `@michaelfromyeg/weft-*` and is
meant to be depended on independently, so the dependency direction is strict: adapters depend
only on `adapter-kit` + `schema`, never on `core`.

## Packages

- `schema` is the source of truth: Zod schemas + inferred types + JSON-Schema export. YAML is
  parsed in 1.2 "core" mode so `country: NO` stays a string (the Norway problem).
- `core` is the compile pipeline: load -> static pass (validate, namespace/alias) ->
  transform/emitManifest/emitCatalog per adapter -> place (build vs install) -> a
  content-addressed `weft.lock`. Also resolve (git/file refs), deps, config/secrets,
  managed-mode, and ed25519 signing.
- `adapter-kit` is the `HarnessAdapter` interface and helpers. This is the seam.
- `adapter-claude|codex|cursor|copilot|opencode` are the compiler backends, one per harness.
- `eval` is the runner plus a headless `HarnessDriver` per harness.
- `index` is metadata + MCP-Registry federation + badges + the publish gate.
- `cli` wires it all together with citty; it is the only package that prints (via its logger).

## The adapter contract

An adapter is a plain object. Everything harness-specific hides behind `targetSchema`, so an
upstream format change is a version bump in one package, not a change to any plugin:

```ts
export const myAdapter: HarnessAdapter = {
  target: "myharness",
  version: "0.1.0",
  targetSchema: "myharness/1.0",
  detect(scope, cwd) { /* InstallPaths per scope */ },
  transform(component, ctx) { /* one component -> native artifacts */ },
  emitManifest(plugin, ctx) { /* plugin-level manifest, or [] */ },
  emitCatalog(marketplace) { /* native catalog */ },
  driver: { /* optional headless eval support */ },
};
```

To add a harness: create `packages/adapter-<name>`, implement the contract, register it in
the CLI's registry, and add a driver only if the harness has a usable headless mode. If it
has no structured trace, set `traceUnavailable` so the eval runner degrades honestly instead
of faking a pass.

## Working in the repo

```sh
pnpm install
pnpm typecheck        # tsc across the workspace
pnpm test             # vitest
pnpm test:coverage    # enforces the 80% gate (all metrics)
pnpm lint             # biome (no import cycles, no console outside the CLI logger, etc.)
pnpm build            # tsup, Node-compatible ESM
```

No fake tests: a test must assert on real output, not just that a function ran. New behavior
needs coverage that keeps every metric above 80%. Lint forbids `export *` (barrels use
explicit named re-exports) and `console` outside the CLI's logger module.
