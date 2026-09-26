---
name: boot-harold
description: "Boot Harold, the operator's chief-of-staff operating system. MANDATORY at the start of every Cowork session connected to the Harold folder, before any other work: run it when the session starts, when the operator says 'boot Harold', 'boot', 'start Harold', 'morning', 'gm', 'good morning', 'let's go', or when any Harold playbook, vault, alert, blocker, or project is about to be touched and boot has not run yet. Also run it whenever a read of a playbook or knowledge file returns nothing: that means the workspace was not resolved."
---

# Boot Harold

Harold's rules live in prose. This skill guarantees the prose is actually loaded. It does not think.

## Run this, first, with an absolute path

```bash
"${CLAUDE_PLUGIN_ROOT:-${CLAUDE_SKILL_DIR}/../..}/scripts/boot.sh"
```

If that path does not exist in this harness, resolve the workspace root yourself and run the CLI directly:

```bash
ROOT="${HAROLD_ROOT:-${CLAUDE_PROJECT_DIR:-$HOME/Documents/Harold}}"; [ -x "$ROOT/bin/harold" ] || ROOT="$(dirname "$(find /sessions /mnt /workspace "$HOME" -maxdepth 4 -name AGENTS.md -path '*Harold*' 2>/dev/null | head -1)")"; node "$ROOT/bin/harold" boot
```

## Read what it prints. Then follow it.

The output is the session's loaded context: today's real date, the absolute workspace root, the session file to update, every playbook confirmed readable, the critical learnings (binding), the project map, active blockers, current alerts, and the scheduled work that is due or overdue. After boot, read `memory/CLAUDE.md`, `dashboard/index.md`, `dashboard/status.md` by absolute path under the printed root, exactly as `AGENTS.md` says.

**Always use absolute paths under the printed root.** Relative reads like `playbook/core/x.md` silently return nothing in a sandbox. That silence is the failure this plugin exists to remove.

## If boot refuses

A non-zero exit with `⛔ HAROLD BOOT REFUSED` means the contract cannot be met (workspace not connected, a playbook body unreadable, node missing). Stop. Tell the operator in one sentence what refused and why. Do not improvise Harold's behavior from memory.

## Filing is the exit condition

Before the session ends, run:

```bash
"${CLAUDE_PLUGIN_ROOT:-${CLAUDE_SKILL_DIR}/../..}/scripts/close.sh" --final
```

It verifies today's `vault/daily/` note exists when knowledge changed, that every touched external contact was filed (internal-team gate: `type: team` is never logged to the CRM), that due scheduled work was recorded, sets the session file to sleeping, and commits and pushes the repo. If it reports problems, fix them and run it again. The operator never sees these commands; they just talk.
