# Roadmap & status

Loom is built in phase order; each phase has explicit acceptance criteria, and a later
phase's packages are not started before the current phase's acceptance passes.

## Phase 0 -- Prove the compile (Claude Code only) -- DONE

Packages: `@loom/schema`, `@loom/core`, `@loom/adapter-kit`, `@loom/adapter-claude`,
`@loom/cli`.

Acceptance (all met, exercised by `pnpm test`):

- [x] `loom build` emits a valid `.claude-plugin/marketplace.json` + `plugin.json` + placed
      component files, with **zero hand-written JSON**.
- [x] `claude plugin validate <generated-marketplace>` exits 0 (and `--strict`).
- [x] `loom install` places files under the scope and writes a `loom.lock`.
- [x] Re-running `build`/`install` produces **identical hashes** (deterministic).
- [x] Unit tests for schema parsing (incl. the YAML 1.2 "Norway" cases) and an e2e fixture
      test pass under Vitest.

> `@loom/adapter-kit` was created in Phase 0 (not Phase 1 as the spec lists it) because
> `@loom/adapter-claude` implements its `HarnessAdapter` interface. Only the interfaces +
> helpers exist so far; the `HarnessDriver` implementations land in Phase 1.

### Brought forward from later phases (already implemented)

- **Multi-plugin marketplace build** -- `loom build` on a `marketplace.yaml` resolves and
  compiles many plugins into one native catalog (the company-marketplace workflow). An
  entry `version` override flows into the compiled `plugin.json`.
- **Piecemeal install** -- `loom install <plugin> --only <component>` installs a single
  skill/MCP; the manifest reflects only the selection.
- **Generated CLI map** -- `loom docs` emits a full Markdown CLI reference from the command
  tree (see [cli.md](cli.md)); never hand-maintained.

> Vocabulary note: the canonical authoring unit is a **plugin** (cross-harness), and a
> **marketplace** packages many plugins. There is no separate "bundle" concept. See
> [concepts.md](concepts.md).

## Phase 1 -- Breadth + drivers + deterministic evals -- MOSTLY DONE

Packages: the four remaining `@loom/adapter-*` (codex, cursor, copilot, opencode),
`@loom/eval` (runner + five `HarnessDriver`s via `execa`).

- [x] All five adapters implemented; `loom build` emits native manifests for every harness.
- [x] A plugin installs to every harness **present on the machine** (`loom install` detects
      via the drivers and skips/reports the rest; `--all` overrides).
- [x] `loom eval` runs trace + output assertions via the real headless drivers (Claude /
      Codex / Cursor / OpenCode NDJSON/JSONL parsing; **Copilot has no trace, so `trace`
      degrades to `output`**) and reports per-harness coverage honestly, incl. **UNTESTED**.
- [x] Piecemeal install (`--only`) and namespacing/alias.
- [x] A community adapter can be authored against `@loom/adapter-kit` without importing core
      internals (verified: every adapter imports only adapter-kit + schema).
- [ ] Remaining: full **remote** resolver (git clone of `github:`/git deps, drift-aware) and
      **secrets** (`ConfigVar` declare-not-store resolution to gitignored harness config).

> Many adapter facts beyond Claude are marked `// TODO(verify):` in-code where upstream docs
> are thin (e.g. Codex `plugin.json` shape, Copilot marketplace shape, Cursor remote MCP
> header serialization). They are isolated behind each adapter's `targetSchema` per spec §2.

Key verified facts for the drivers (see [harness-research.md](harness-research.md)):
Claude needs `--output-format stream-json --verbose` for a trace (plain `json` is a single
result object); Codex `exec --json`; Cursor `--output-format stream-json`; **Copilot has no
structured trace** (degrade to output); OpenCode `run --format json` or the SDK `/event`.

## Phase 2 -- Index, federation, badges, CI

Packages: `@loom/index` (build + client + MCP-Registry federation), opt-in telemetry,
badge computation (`valid`, `tested`), a GitHub Action wrapping `loom publish`.

- [ ] Index builds from a set of plugins; ingests MCP Registry `GET /v0.1/servers`.
- [ ] `valid`/`tested` badges compute from eval results.
- [ ] CI action blocks a publish whose deterministic tier fails.

## Phase 3 -- Trust & subjective evals

- [ ] Judge + differential evals + `evals/.baselines/`.
- [ ] Security-scan integration; signing (sigstore/cosign) + `signed` badge.
- [ ] Managed-mode install gating; hosted CI eval tier.

## Invariants held throughout

1. Compiler, not platform -- the library is the product.
2. Single source of truth -- generated files are never hand-edited.
3. Standards as inputs, adapters as the seam -- upstream churn touches one adapter.
4. Federate, don't wall off.
5. Same primitives at every scale -- scope + policy differ, mechanism does not.
6. Honest coverage -- untested harnesses are reported, never faked.
