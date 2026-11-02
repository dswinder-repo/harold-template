#!/bin/bash
# PreToolUse: blocks tools until a boot too large for the hook output has been read (bin/harold context). Fails open.
HERE="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$("$HERE/resolve-root.sh" 2>/dev/null)" || exit 0
exec node "$ROOT/bin/harold" gate --via=claude "$@"
