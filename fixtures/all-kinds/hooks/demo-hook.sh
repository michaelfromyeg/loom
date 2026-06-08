#!/bin/sh
# A demo hook; an eval exercises it via setup+verify (hooks are event-driven, not prompt-driven).
echo "hook-ran" > "${1:-hook.marker}"
