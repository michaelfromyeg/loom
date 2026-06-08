#!/usr/bin/env bash
#
# Weft end-to-end demo: real-world use cases, start to finish.
# Run from anywhere:  bash examples/demo.sh
# Requires: bun (dev runtime) + this repo. The optional eval step also needs the
# `claude` CLI (authenticated); everything else runs offline.
#
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
weft() { bun "$REPO/packages/cli/src/index.ts" "$@"; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

h() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }

h "Use case 1 -- a solo dev ships one capability to every harness"
echo "Author a plugin once (weft.yaml + a SKILL.md), no per-harness JSON:"
weft init code-helper --namespace com.acme >/dev/null
weft validate code-helper
echo
echo "Compile it to all five harnesses (Claude, Codex, Cursor, Copilot, OpenCode):"
weft build code-helper --out out
echo
echo "Install into the harnesses actually on this machine (others are skipped):"
weft install code-helper --scope project --cwd project | grep -E "Installed|skipped|artifacts"

h "Use case 2 -- a company curates an internal marketplace"
echo "One marketplace.yaml packages many plugins into each harness's native catalog:"
weft build "$REPO/fixtures/sample-marketplace" --out market
echo "Claude catalog lists every plugin:"
grep -E '"name"|"source"' market/claude/.claude-plugin/marketplace.json | sed 's/^/   /'

h "Use case 3 -- trust before you ship"
echo "The publish gate: static validation + a security scan + deterministic evals."
weft publish code-helper | grep -E "valid|scan|badges|passed|BLOCKED"
echo
echo "Sign the compiled artifacts, then verify (tamper-evident):"
weft sign code-helper | sed 's/^/   /'
weft verify code-helper | sed 's/^/   /'
echo "Now tamper with a placed file and re-verify -- it must fail:"
echo "# sneaky edit" >> project/.claude/plugins/code-helper/skills/hello/SKILL.md
if weft verify code-helper >/dev/null 2>&1; then echo "   UNEXPECTED: verify passed"; else echo "   verify correctly FAILED (tamper detected)"; fi

h "Use case 4 -- enterprise managed mode"
echo "An org pins installs to its own namespaces; a foreign namespace is blocked:"
if weft install code-helper --scope project --cwd locked --managed com.enterprise >/dev/null 2>&1; then
  echo "   UNEXPECTED: install allowed"
else
  echo "   install correctly BLOCKED (com.acme not in the com.enterprise allowlist)"
fi

h "Use case 5 -- evals against the REAL harness (optional; needs claude)"
if command -v claude >/dev/null 2>&1; then
  echo "Driving the real headless Claude to review a planted bug and asserting on what it did:"
  weft eval "$REPO/fixtures/sample-plugin" || true
else
  echo "   (claude CLI not found -- this harness would be reported UNTESTED, never faked)"
fi

printf '\n\033[1;32mDemo complete.\033[0m Workspace was %s (cleaned up on exit).\n' "$WORK"
