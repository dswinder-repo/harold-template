# Playbook: Expedition HQ (Launch the Visualizer)

**Purpose:** Start the Expedition HQ live dashboard so you can watch every session's activity in a browser.
**Trigger:** "Open Expedition HQ", "start the visualizer", "show me the dashboard", or at session start when live monitoring is wanted.

Expedition HQ is a small zero-dependency Node server at `tools/visualizer/serve.js`. It reads the session files in `harold/active-sessions/*.json` and serves a page that refreshes every 3 seconds.

---

## Steps

1. **Check if it is already running**
   - Fetch `http://localhost:3210/api/sessions` (e.g. `curl -s http://localhost:3210/api/sessions`).
   - If it responds with JSON, the server is up: skip to step 3.

2. **Start the server** (from the workspace root, `bin/harold root`)
   ```bash
   node tools/visualizer/serve.js
   ```
   - Options: `--port <n>` to use another port, `--sessions <dir>` to read session files from somewhere else.
   - In a harness that supports launch configs (for example a preview/launch config file), you can add an entry named `expedition-hq` that runs `node tools/visualizer/serve.js` on port 3210 and start it from there.
   - Wait until `http://localhost:3210/api/sessions` responds.
   - **If it fails to start:** check that Node is installed (`node --version`), and whether port 3210 is taken (`lsof -i :3210`); if it is, pass `--port`.

3. **Verify your session is visible**
   - Confirm the current session's JSON file exists in `harold/active-sessions/` and `/api/sessions` lists it.
   - If it is missing, write it per the Dashboard State Protocol in `AGENTS.md`.

4. **Open it in a browser**
   - Go to `http://localhost:3210`.
   - The page auto-refreshes every 3 seconds.

---

## Notes

- Zero dependencies: no `npm install` step.
- It reads `harold/active-sessions/` relative to the workspace (override with `--sessions`).
- Active sessions sort to the top; ended sessions dim, and ended sessions older than about 2 hours are retired from the view.
- If a session stops updating its file, the server can infer recent activity from the harness's local session logs so the view does not freeze.
- It is local-only. Do not expose port 3210 to the internet.
- Optional: start it at login with your operating system's service manager. It is a local viewer only: nothing else in Harold needs it running.

---

## Completion checklist

- [ ] `/api/sessions` checked before starting a second copy
- [ ] Server running from the workspace root (`node tools/visualizer/serve.js`)
- [ ] Current session's file present in `harold/active-sessions/` and listed by `/api/sessions`
- [ ] `http://localhost:3210` opened and showing sessions
- [ ] Any start failure (Node missing, port in use) reported to the operator with the fix
