#!/bin/bash
HERE="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$("$HERE/resolve-root.sh" 2>/dev/null)" || { echo '{"systemMessage":"Harold close skipped: workspace root not found in this harness."}'; exit 0; }
exec node "$ROOT/bin/harold" close "$@"
