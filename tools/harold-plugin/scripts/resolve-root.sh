#!/bin/bash
# Resolve the Harold workspace root across harnesses. Prints the absolute path or exits 1.
# Never uses a relative path: Cowork sandboxes mount the connected folder somewhere else.
# Set HAROLD_ROOT if your workspace is somewhere unusual; the fallback search below looks for a
# folder whose path contains "Harold" (edit HAROLD_NAME_HINT if you named yours differently).
HAROLD_NAME_HINT="${HAROLD_NAME_HINT:-Harold}"
is_root() { [ -f "$1/AGENTS.md" ] && [ -x "$1/bin/harold" ] && [ -d "$1/playbook" ]; }
try() { [ -n "$1" ] && is_root "$1" && { cd "$1" && pwd -P; exit 0; }; }
try "$HAROLD_ROOT"
try "$CLAUDE_PROJECT_DIR"
try "$PWD"
d="$PWD"; for _ in 1 2 3 4 5 6; do d="$(dirname "$d")"; try "$d"; done
try "$HOME/Documents/$HAROLD_NAME_HINT"
try "$HOME/$HAROLD_NAME_HINT"
# Cowork bridge / sandbox mounts: search shallowly for a folder that carries the constitution.
for base in /sessions /mnt /workspace /workspaces /home /Users "$HOME"; do
  [ -d "$base" ] || continue
  while IFS= read -r a; do try "$(dirname "$a")"; done < <(find "$base" -maxdepth 4 -name AGENTS.md -path "*${HAROLD_NAME_HINT}*" 2>/dev/null | head -5)
done
echo "HAROLD: workspace root not found (looked at HAROLD_ROOT, CLAUDE_PROJECT_DIR, cwd and parents, ~/Documents/$HAROLD_NAME_HINT, sandbox mounts). Connect the Harold folder to this session or set HAROLD_ROOT." >&2
exit 1
