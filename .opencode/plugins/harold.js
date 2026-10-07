// Harold for opencode. opencode loads every .opencode/plugins/*.js at startup (https://opencode.ai/docs/plugins/).
// It has no shell hooks for the session lifecycle, so this plugin runs bin/harold at the same three points:
//   start     the first request of each session runs `bin/harold boot`; its output joins that session's system prompt
//             (experimental.chat.system.transform, re-applied on every request of the session)
//   each turn session.idle runs `bin/harold close`; when filing is incomplete, the reason goes back into the session as
//             a new message, so the agent keeps going (bin/harold stops asking after four attempts)
//   end       a deleted session, or opencode shutting down, runs `bin/harold close --final` (detached)
// Source: sst/opencode, packages/plugin/src/index.ts (Hooks) and packages/web/src/content/docs/plugins.mdx.
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

// Run bin/harold with the hook input on stdin; resolves with its stdout ("" on failure or timeout).
function runHarold(root, args, input, timeoutMs) {
  return new Promise((resolve) => {
    let out = ""
    let child
    try {
      child = spawn(join(root, "bin", "harold"), [...args, "--via=opencode"], { cwd: root, stdio: ["pipe", "pipe", "ignore"] })
    } catch {
      return resolve("")
    }
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs)
    child.stdout.on("data", (d) => (out += d))
    child.on("error", () => { clearTimeout(timer); resolve("") })
    child.on("close", () => { clearTimeout(timer); resolve(out.trim()) })
    child.stdin.on("error", () => {})
    child.stdin.end(JSON.stringify(input))
  })
}

export const HaroldPlugin = async ({ client, directory, worktree }) => {
  const root = [process.env.HAROLD_ROOT, worktree, directory].find((d) => d && existsSync(join(d, "bin", "harold")))
  if (!root) return {}
  const context = new Map() // sessionID -> boot output (a promise, so concurrent requests boot once)
  const nudged = new Set() // sessions whose current turn was started by a close follow-up
  const input = (id, event, extra = {}) => ({ session_id: id, hook_event_name: event, cwd: root, ...extra })
  const finalClose = (id) => runHarold(root, ["close", "--final", "--detach"], input(id, "SessionEnd"), 10000)
  return {
    "experimental.chat.system.transform": async (hook, output) => {
      const id = hook && hook.sessionID
      if (!id) return
      if (!context.has(id)) context.set(id, runHarold(root, ["boot"], input(id, "SessionStart"), 60000))
      const text = await context.get(id)
      if (text) output.system.push(text)
    },
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        const id = event.properties.sessionID
        let reply = {}
        try { reply = JSON.parse(await runHarold(root, ["close"], input(id, "Stop", { stop_hook_active: nudged.has(id) }), 240000)) } catch {}
        if (reply.decision === "block" && reply.reason) {
          nudged.add(id)
          const body = { path: { id }, body: { parts: [{ type: "text", text: reply.reason }] } }
          if (client.session.promptAsync) await client.session.promptAsync(body)
          else client.session.prompt(body)
        } else nudged.delete(id)
      } else if (event.type === "session.deleted") {
        const id = event.properties.info && event.properties.info.id
        if (id) { context.delete(id); await finalClose(id) }
      }
    },
    dispose: async () => { await Promise.all([...context.keys()].map(finalClose)) },
  }
}
