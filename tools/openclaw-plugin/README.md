# Harold plugin for OpenClaw

OpenClaw does not run Claude-style hook files (its bundle loader detects `hooks/hooks.json` but never executes it), so this native plugin runs `bin/harold` at the same points:

| OpenClaw hook | Harold |
|---|---|
| `before_prompt_build`, first turn of a session | `bin/harold boot`; its output is added as `prependContext` |
| `before_agent_finalize` | `bin/harold close`; while filing is incomplete it answers `revise` with the reason (at most three extra passes) |
| `agent_end` | `bin/harold close` again, for runtimes without a finalize step (a no-op right after a clean close) |
| `session_end` | `bin/harold close --final`, detached (shutdown gives `session_end` two seconds) |

**Install** (on the Gateway host; OpenClaw itself needs the Node version its own documentation names, newer than the Node 22 Harold needs):

```bash
openclaw plugins install --link /ABSOLUTE/PATH/TO/your-harold-workspace/tools/openclaw-plugin
openclaw plugins enable harold
```

Then allow the conversation hooks in `openclaw.json` (OpenClaw requires it for any non-bundled plugin that uses `before_prompt_build`, `before_agent_finalize` or `agent_end`):

```json
{
  "plugins": {
    "entries": {
      "harold": {
        "enabled": true,
        "hooks": { "allowConversationAccess": true },
        "config": { "root": "/ABSOLUTE/PATH/TO/your-harold-workspace" }
      }
    }
  }
}
```

`config.root` is only needed when the agent's workspace folder is not the Harold workspace; otherwise the plugin uses `HAROLD_ROOT`, then the agent's workspace. Outside a Harold workspace it does nothing.

Sources: openclaw/openclaw `docs/plugins/hooks.md`, `docs/plugins/hooks/reference.md`, `docs/plugins/hooks/prompt-and-session.md`, `src/plugins/hook-types.ts`. `tests/harnesses.test.js` loads this plugin with a stand-in for OpenClaw's API; it has not been run inside OpenClaw itself.
