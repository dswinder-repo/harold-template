#!/bin/bash
# Resolve the Harold workspace root across harnesses. Prints the absolute path or exits 1.
# Never uses a relative path: Cowork sandboxes mount the connected folder somewhere else.
# A folder is a Harold workspace when it has the signature bin/harold itself relies on: AGENTS.md, a
# playbook/ folder and a harold/ folder, plus the bin/harold program. Its name does not matter, so a copy
# can be called anything. Set HAROLD_ROOT if your workspace is somewhere the search below does not reach.
is_root() { [ -f "$1/AGENTS.md" ] && [ -d "$1/playbook" ] && [ -d "$1/harold" ] && [ -x "$1/bin/harold" ]; }
try() { [ -n "$1" ] && is_root "$1" && { cd "$1" && pwd -P; exit 0; }; }
try "$HAROLD_ROOT"
try "$CLAUDE_PROJECT_DIR"
try "$PWD"
d="$PWD"; for _ in 1 2 3 4 5 6; do d="$(dirname "$d")"; try "$d"; done
# Cowork bridge / sandbox mounts and the home folder: search shallowly for a folder with the signature.
for base in /sessions /mnt /workspace /workspaces "$HOME" /home /Users; do
  [ -d "$base" ] || continue
  while IFS= read -r a; do try "$(dirname "$a")"; done < <(find "$base" -maxdepth 4 -name AGENTS.md -not -path '*/node_modules/*' 2>/dev/null | head -50)
done
echo "HAROLD: workspace root not found (looked at HAROLD_ROOT, CLAUDE_PROJECT_DIR, the current folder and its parents, sandbox mounts and the home folder, for a folder with AGENTS.md, playbook/, harold/ and bin/harold). Connect the Harold folder to this session or set HAROLD_ROOT." >&2
exit 1
