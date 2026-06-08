# Roadmap & status

Loom is built in phase order. Each phase has explicit acceptance criteria, and a later
phase's packages are not started before the current phase's acceptance passes.

## Phase 0: Prove the compile (Claude Code only), DONE

Packages: `@michaelfromyeg/loom-schema`, `@michaelfromyeg/loom-core`, `@michaelfromyeg/loom-adapter-kit`, `@michaelfromyeg/loom-adapter-claude`,
`@michaelfromyeg/loom-cli`.

Acceptance (all met, exercised by `pnpm test`):

- [x] `loom build` emits a valid `.claude-plugin/marketplace.json` + `plugin.json` + placed
      component files, with zero hand-written JSON.
- [x] `claude plugin validate <generated-marketplace>` exits 0 (and `--strict`).
- [x] `loom install` places files under the scope and writes a `loom.lock`.
- [x] Re-running `build`/`install` produces identical hashes (deterministic).
- [x] Unit tests for schema parsing (incl. the YAML 1.2 "Norway" cases) and an e2e fixture
      test pass under Vitest.

> `@michaelfromyeg/loom-adapter-kit` was created in Phase 0 (not Phase 1 as the spec lists it) because
> `@michaelfromyeg/loom-adapter-claude` implements its `HarnessAdapter` interface. Only the interfaces +
> helpers exist so far; the `HarnessDriver` implementations land in Phase 1.

### Brought forward from later phases (already implemented)

- Multi-plugin marketplace build. `loom build` on a `marketplace.yaml` resolves and
  compiles many plugins into one native catalog (the company-marketplace workflow). An
  entry `version` override flows into the compiled `plugin.json`.
- Piecemeal install. `loom install <plugin> --only <component>` installs a single
  skill/MCP; the manifest reflects only the selection.
- Generated CLI map. `loom docs` emits a full Markdown CLI reference from the command
  tree (see [cli.md](cli.md)); never hand-maintained.

> Vocabulary note: the canonical authoring unit is a plugin (cross-harness), and a
> marketplace packages many plugins. There is no separate "bundle" concept. See
> [concepts.md](concepts.md).

## Phase 1: Breadth + drivers + deterministic evals, DONE

Packages: the four remaining `@michaelfromyeg/loom-adapter-*` (codex, cursor, copilot, opencode),
`@michaelfromyeg/loom-eval` (runner + five `HarnessDriver`s via `execa`).

- [x] All five adapters implemented; `loom build` emits native manifests for every harness.
- [x] A plugin installs to every harness present on the machine (`loom install` detects
      via the drivers and skips/reports the rest; `--all` overrides).
- [x] `loom eval` runs trace + output assertions via the real headless drivers (Claude /
      Codex / Cursor / OpenCode NDJSON/JSONL parsing; Copilot has no trace, so `trace`
      degrades to `output`) and reports per-harness coverage honestly, incl. UNTESTED.
- [x] Piecemeal install (`--only`) and namespacing/alias.
- [x] A community adapter can be authored against `@michaelfromyeg/loom-adapter-kit` without importing core
      internals (verified: every adapter imports only adapter-kit + schema).
- [x] Remote resolver. `github:`/git/`file://` sources are git-cloned into `~/.loom/cache`
      and pinned to a SHA; `depends` vendors selected components into a merged tree (piecemeal +
      drift-aware copy of shared assets) with cycle detection; deps recorded in `loom.lock`.
- [x] Secrets (`ConfigVar` declare-not-store) resolved from env/default to a gitignored
      `.loom/secrets.local.json`, never to the lockfile/plugin/index.
- [x] `loom update` re-resolves, recompiles, and re-places ONLY artifacts whose content hash
      changed (content-addressed; an unchanged artifact is never rewritten).

> Many adapter facts beyond Claude are marked `// TODO(verify):` in-code where upstream docs
> are thin (e.g. Codex `plugin.json` shape, Copilot marketplace shape, Cursor remote MCP
> header serialization). They are isolated behind each adapter's `targetSchema` per spec §2.

Key verified facts for the drivers (see [harness-research.md](harness-research.md)):
Claude needs `--output-format stream-json --verbose` for a trace (plain `json` is a single
result object); Codex `exec --json`; Cursor `--output-format stream-json`; Copilot has no
structured trace (degrade to output); OpenCode `run --format json` or the SDK `/event`.

## Phase 2: Index, federation, badges, CI, DONE

Package: `@michaelfromyeg/loom-index` (build + client + MCP-Registry federation + badges + publish gate).

- [x] `loom index <dirs...>` builds a `loom.index/1` (metadata only) from a set of plugins.
- [x] `--federate` ingests the MCP Registry `GET /v0.1/servers` (injectable fetch; offline-tested)
      into `federated[]` + MCP-only entries.
- [x] `valid`/`tested` badges compute from validation + eval results (`tested` only when a real
      harness passes; `harnessCoverage` is the passing set, never UNTESTED).
- [x] Opt-in aggregate telemetry (`installs` count; no per-user data).
- [x] `loom publish` runs the deterministic gate (static valid + trace/output evals) and exits 1
      on failure; `.github/actions/loom-publish` + `publish.yml` block a failing publish in CI.

## Phase 3: Trust & subjective evals, DONE

- [x] Judge evals (injectable model, advisory unless `gate:true`) plus differential evals
      that compare a case's deterministic score to a committed baseline; a regression below
      the threshold blocks. `evals/.baselines/` snapshotting via `loom publish --snapshot`.
- [x] Security scan (`scanned` badge): a built-in heuristic scanner over executable/hook/
      passthrough artifacts (garak / AI-Infra-Guard would plug in for production).
- [x] Signing (`signed` badge): ed25519 over the lockfile's artifact-hash digest;
      `loom sign` / `loom verify` detect both a bad signature and tampered on-disk artifacts.
      (sigstore/cosign keyless signing is the intended production backend.)
- [x] Managed-mode install gating: `loom install --managed <namespaces>` blocks a
      non-allowlisted namespace (and supports required-badge policies).

> Out of scope for v1 (noted in the spec): a hosted CI eval tier (BYO-keys local is the
> default) and an index UI. The deterministic gate already runs the same driver invocations
> a hosted runner would.

## Phase 4: Lifecycle & federation extras

Beyond the original spec, two lifecycle commands round out the loop:

- [x] `loom import` reverse-compiles an existing native plugin or marketplace into the Loom
      model, so you can cross-compile assets you already maintain (federate, don't wall off).
      Claude is implemented; a Loom -> Claude -> Loom -> Claude round-trip passes
      `claude plugin validate --strict`.
- [x] `loom uninstall` removes everything `install` placed, using the paths recorded in
      `loom.lock`, then deletes the lockfile.

## Beyond v1 (planned)

Not built yet; tracked so the boundary is honest:

- `importNative` for the other four harnesses (codex/cursor/copilot/opencode), so import is
  any-to-any rather than Claude-only.
- The `verified` badge: prove `owner.namespace` ownership via a GitHub / DNS / HTTP challenge,
  reusing the MCP Registry's scheme rather than reinventing it.
- Resolver depth: `npm:` source resolution, the `git-subdir` form, and transitive (multi-level)
  dependency resolution (today `depends` resolves one level).
- Richer OpenCode driver via `@opencode-ai/sdk` / `opencode serve` SSE (full pending->running->
  completed tool states) and the ACP transport.
- sigstore / cosign keyless signing as the production `signed` backend (today: local ed25519).
- garak / AI-Infra-Guard scanner integration for the `scanned` badge (today: a heuristic scan).
- Hosted CI eval tier, opt-in auto-update with channels, a public index UI, and a real
  telemetry transport (the data model and the deterministic gate already exist).
- Publishing the JSON Schemas to a CDN for `$schema`-driven editor autocomplete.

## Invariants held throughout

1. Compiler, not platform; the library is the product.
2. Single source of truth; generated files are never hand-edited.
3. Standards as inputs, adapters as the seam; upstream churn touches one adapter.
4. Federate, don't wall off.
5. Same primitives at every scale; scope + policy differ, mechanism does not.
6. Honest coverage; untested harnesses are reported, never faked.
