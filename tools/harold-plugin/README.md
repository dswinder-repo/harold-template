# Harold plugin for Cowork (Claude desktop app)

Claude Code runs `bin/harold boot` and `close` from `.claude/settings.json`. Cowork does not read that file, so this plugin wires the same three hooks (SessionStart → boot, Stop → close, SessionEnd → close --final) plus a `boot-harold` skill, so that saying "boot Harold" works even where hooks do not fire.

**Install:** in the Claude desktop app, add this folder (`tools/harold-plugin`) as a local plugin, then connect your Harold workspace folder to the Cowork session.

**How it finds the workspace:** `scripts/resolve-root.sh` checks `HAROLD_ROOT`, `CLAUDE_PROJECT_DIR`, the current folder and its parents, `~/Documents/Harold`, then searches common sandbox mounts for a folder containing `AGENTS.md` whose path contains "Harold". If your workspace is named differently, set `HAROLD_ROOT` or `HAROLD_NAME_HINT`.

If the workspace cannot be found, boot refuses loudly rather than letting the session run without its instructions.
