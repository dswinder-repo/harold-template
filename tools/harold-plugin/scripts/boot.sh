#!/bin/bash
# SessionStart hook / skill entry: run harold boot against the connected workspace. Refuses loudly if it cannot.
HERE="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$("$HERE/resolve-root.sh")" || { echo "⛔ HAROLD BOOT REFUSED: the Harold workspace was not found from this harness."; echo "Do not proceed from memory. Tell the operator: Harold is not connected to this session (connect the workspace folder, or set HAROLD_ROOT)."; exit 2; }
command -v node >/dev/null 2>&1 || { echo "⛔ HAROLD BOOT REFUSED: node is not available in this harness, and bin/harold needs it. Tell the operator."; exit 2; }
exec node "$ROOT/bin/harold" boot "$@"
