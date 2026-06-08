# Roadmap & status

Weft is built in phase order. Each phase has explicit acceptance criteria, and a later
phase's packages are not started before the current phase's acceptance passes.

## Phase 0: Prove the compile (Claude Code only), DONE

Packages: `@michaelfromyeg/weft-schema`, `@michaelfromyeg/weft-core`, `@michaelfromyeg/weft-adapter-kit`, `@michaelfromyeg/weft-adapter-claude`,
`@michaelfromyeg/weft-cli`.

Acceptance (all met, exercised by `pnpm test`):

- [x] `weft build` emits a valid `.claude-plugin/marketplace.json` + `plugin.json` + placed
      component files, with zero hand-written JSON.
- [x] `claude plugin validate <generated-marketplace>` exits 0 (and `--strict`).
- [x] `weft install` places files under the scope and writes a `weft.lock`.
- [x] Re-running `build`/`install` produces identical hashes (deterministic).
- [x] Unit tests for schema parsing (incl. the YAML 1.2 "Norway" cases) and an e2e fixture
      test pass under Vitest.

> `@michaelfromyeg/weft-adapter-kit` was created in Phase 0 (not Phase 1 as the spec lists it) because
> `@michaelfromyeg/weft-adapter-claude` implements its `HarnessAdapter` interface. Only the interfaces +
> helpers exist so far; the `HarnessDriver` implementations land in Phase 1.

### Brought forward from later phases (already implemented)

- Multi-plugin marketplace build. `weft build` on a `marketplace.yaml` resolves and
  compiles many plugins into one native catalog (the company-marketplace workflow). An
  entry `version` override flows into the compiled `plugin.json`.
- Piecemeal install. `weft install <plugin> --only <component>` installs a single
  skill/MCP; the manifest reflects only the selection.
- Generated CLI map. `weft docs` emits a full Markdown CLI reference from the command
  tree (see [cli.md](cli.md)); never hand-maintained.

> Vocabulary note: the canonical authoring unit is a plugin (cross-harness), and a
> marketplace packages many plugins. There is no separate "bundle" concept. See
> [concepts.md](concepts.md).

## Phase 1: Breadth + drivers + deterministic evals, DONE

Packages: the four remaining `@michaelfromyeg/weft-adapter-*` (codex, cursor, copilot, opencode),
`@michaelfromyeg/weft-eval` (runner + five `HarnessDriver`s via `execa`).

- [x] All five adapters implemented; `weft build` emits native manifests for every harness.
- [x] A plugin installs to every harness present on the machine (`weft install` detects
      via the drivers and skips/reports the rest; `--all` overrides).
- [x] `weft eval` runs trace + output assertions via the real headless drivers (Claude /
      Codex / Cursor / OpenCode NDJSON/JSONL parsing; Copilot has no trace, so `trace`
      degrades to `output`) and reports per-harness coverage honestly, incl. UNTESTED.
- [x] Piecemeal install (`--only`) and namespacing/alias.
- [x] A community adapter can be authored against `@michaelfromyeg/weft-adapter-kit` without importing core
      internals (verified: every adapter imports only adapter-kit + schema).
- [x] Remote resolver. `github:`/git/`file://` sources are git-cloned into `~/.weft/cache`
      and pinned to a SHA; `depends` vendors selected components into a merged tree (piecemeal +
      drift-aware copy of shared assets) with cycle detection; deps recorded in `weft.lock`.
- [x] Secrets (`ConfigVar` declare-not-store) resolved from env/default to a gitignored
      `.weft/secrets.local.json`, never to the lockfile/plugin/index.
- [x] `weft update` re-resolves, recompiles, and re-places ONLY artifacts whose content hash
      changed (content-addressed; an unchanged artifact is never rewritten).

> Many adapter facts beyond Claude are marked `// TODO(verify):` in-code where upstream docs
> are thin (e.g. Codex `plugin.json` shape, Copilot marketplace shape, Cursor remote MCP
> header serialization). They are isolated behind each adapter's `targetSchema` per spec §2.

Key verified facts for the drivers (see [harness-research.md](harness-research.md)):
Claude needs `--output-format stream-json --verbose` for a trace (plain `json` is a single
result object); Codex `exec --json`; Cursor `--output-format stream-json`; Copilot has no
structured trace (degrade to output); OpenCode `run --format json` or the SDK `/event`.

## Phase 2: Index, federation, badges, CI, DONE

Package: `@michaelfromyeg/weft-index` (build + client + MCP-Registry federation + badges + publish gate).

- [x] `weft index <dirs...>` builds a `weft.index/1` (metadata only) from a set of plugins.
- [x] `--federate` ingests the MCP Registry `GET /v0.1/servers` (injectable fetch; offline-tested)
      into `federated[]` + MCP-only entries.
- [x] `valid`/`tested` badges compute from validation + eval results (`tested` only when a real
      harness passes; `harnessCoverage` is the passing set, never UNTESTED).
- [x] Opt-in aggregate telemetry (`installs` count; no per-user data).
- [x] `weft publish` runs the deterministic gate (static valid + trace/output evals) and exits 1
      on failure; `.github/actions/weft-publish` + `publish.yml` block a failing publish in CI.

## Phase 3: Trust & subjective evals, DONE

- [x] Judge evals (injectable model, advisory unless `gate:true`) plus differential evals
      that compare a case's deterministic score to a committed baseline; a regression below
      the threshold blocks. `evals/.baselines/` snapshotting via `weft publish --snapshot`.
- [x] Security scan (`scanned` badge): a built-in heuristic scanner over executable/hook/
      passthrough artifacts (garak / AI-Infra-Guard would plug in for production).
- [x] Signing (`signed` badge): ed25519 over the lockfile's artifact-hash digest;
      `weft sign` / `weft verify` detect both a bad signature and tampered on-disk artifacts.
      (sigstore/cosign keyless signing is the intended production backend.)
- [x] Managed-mode install gating: `weft install --managed <namespaces>` blocks a
      non-allowlisted namespace (and supports required-badge policies).

> Out of scope for v1 (noted in the spec): a hosted CI eval tier (BYO-keys local is the
> default) and an index UI. The deterministic gate already runs the same driver invocations
> a hosted runner would.

## Phase 4: Lifecycle & federation extras

Beyond the original spec, two lifecycle commands round out the loop:

- [x] `weft import` reverse-compiles an existing native plugin or marketplace into the Weft
      model, so you can cross-compile assets you already maintain (federate, don't wall off).
      All five harnesses are supported through each adapter's `importNative`, so import is
      any-to-any (`weft import --from <harness>`); a Weft -> Claude -> Weft -> Claude
      round-trip passes `claude plugin validate --strict`.
- [x] `weft uninstall` removes everything `install` placed, using the paths recorded in
      `weft.lock`, then deletes the lockfile.

## Beyond v1 (planned)

Not built yet; tracked so the boundary is honest. Grouped by theme, roughly in priority order
within each group. Nothing here blocks using Weft today; most items swap a production backend
in behind an interface that already exists.

### Trust & supply chain

The one real gap in the trust story is ownership. Everything else here is a backend swap.

- The `verified` badge: prove `owner.namespace` ownership via a GitHub / DNS / HTTP challenge,
  reusing the MCP Registry's scheme rather than reinventing it. Today any metadata can claim
  any namespace.
- sigstore / cosign keyless signing as the production `signed` backend (today: local ed25519),
  tied to npm provenance / SLSA attestation (releases already publish with provenance on).
- garak / AI-Infra-Guard scanner integration for the `scanned` badge (today: a heuristic scan).

### Authoring experience

- `weft dev` (watch mode): recompile on file change for a tight authoring loop.
- `weft diff`: a dry run that shows exactly which artifacts an install/update would add,
  rewrite, or remove before touching disk (the content-hash plan already exists internally).
- Publish the JSON Schemas to a CDN for `$schema`-driven editor autocomplete, then an LSP /
  VS Code extension that validates `weft.yaml` and previews compiled output live.
- More scaffolds: `weft init --template <mcp-wrapper|skill-pack|...>`.

### More harnesses

The adapter-kit seam is designed for this; each is a new package, no core change.

- Adapters for Windsurf, Cline, Aider, Zed's agent, and Continue.dev.
- An adapter conformance suite (golden fixtures) so a community adapter self-certifies against
  the `HarnessAdapter` contract.
- Richer OpenCode driver via `@opencode-ai/sdk` / `opencode serve` SSE (full pending->running->
  completed tool states) and the ACP transport.

### Resolver depth

- Transitive (multi-level) `depends` and semver ranges on dependencies (today: one level,
  exact SHA pins).

Shipped: `weft install`/`build` now resolve a remote target, not just `depends`. A
`github:`/git/`npm:`/`owner/repo` ref is fetched into `~/.weft/cache` (git clone or
`npm pack`) and installed from there, and a trailing `//subdir` selects a plugin or
marketplace nested in the source (e.g. `weft install github:owner/repo//marketplace`).

### Discovery & operations

- A public index UI plus a hosted registry backend, and `weft search` over the federated index.
- A hosted CI eval tier (BYO-keys local stays the default) and an eval compatibility-matrix
  badge across harnesses.
- `weft doctor`: report installed harnesses and versions, and any drift between `weft.lock`
  and on-disk state.
- Opt-in auto-update with channels, and a real telemetry transport (the data model and the
  deterministic gate already exist).

### Distribution

- Standalone single-file binaries (`bun build --compile`) per platform, attached to GitHub
  releases, so `weft` installs without a Node toolchain.

## Invariants held throughout

1. Compiler, not platform; the library is the product.
2. Single source of truth; generated files are never hand-edited.
3. Standards as inputs, adapters as the seam; upstream churn touches one adapter.
4. Federate, don't wall off.
5. Same primitives at every scale; scope + policy differ, mechanism does not.
6. Honest coverage; untested harnesses are reported, never faked.
