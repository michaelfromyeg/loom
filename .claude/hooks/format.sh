#!/usr/bin/env bash
# Format-on-save: Biome-formats the single file Claude just wrote.
# Wired as a PostToolUse hook on Edit|Write|MultiEdit. Reads the hook payload
# (JSON on stdin), pulls out the edited file path, and formats it in place with
# the repo's biome.json — but only for extensions Biome handles here.
file="$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')"
[ -n "$file" ] || exit 0

case "$file" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.json | *.jsonc) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$PWD}" || exit 0
# `check` (not `format`) so save-time also organizes imports, matching `pnpm lint`.
# Linter disabled so we never apply lint fixes mid-edit (e.g. dropping an import
# you're about to use) -- just formatting + import sorting.
"$PWD/node_modules/.bin/biome" check --write --linter-enabled=false \
  --no-errors-on-unmatched "$file" >/dev/null 2>&1 || true
exit 0
