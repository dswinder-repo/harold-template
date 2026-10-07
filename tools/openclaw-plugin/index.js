// Harold for OpenClaw: a native plugin (OpenClaw does not run Claude-style hook files; see docs/plugins/bundles.md).
// Typed hooks (docs/plugins/hooks.md, docs/plugins/hooks/reference.md, src/plugins/hook-types.ts):
//   before_prompt_build    first turn of a session: `bin/harold boot`, its output as prependContext
//   before_agent_finalize  `bin/harold close`; filing incomplete → {action: "revise"} with the reason (one more pass,
//                          at most three per run)
//   agent_end              `bin/harold close` again, for runtimes without a finalize step (it is a no-op right after a clean one)
//   session_end            `bin/harold close --final`, detached (shutdown gives session_end two seconds in all)
// Needs plugins.entries.harold.hooks.allowConversationAccess: true (see README.md).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

function runHarold(root, args, input, timeoutMs) {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(join(root, "bin", "harold"), [...args, "--via=openclaw"], { cwd: root, stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      return resolve("");
    }
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => { clearTimeout(timer); resolve(""); });
    child.on("close", () => { clearTimeout(timer); resolve(out.trim()); });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(input));
  });
}
const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };

export default {
  id: "harold",
  name: "Harold",
  description: "Runs bin/harold boot on the first turn of a session, close at the end of every turn, close --final at session end.",
  register(api) {
    const configured = api.pluginConfig && api.pluginConfig.root;
    const rootFor = (ctx) => [configured, process.env.HAROLD_ROOT, ctx && ctx.workspaceDir].find((d) => d && existsSync(join(d, "bin", "harold")));
    const sessions = new Map(); // sessionId -> workspace root, once booted
    const input = (root, id, event, extra = {}) => ({ session_id: id, hook_event_name: event, cwd: root, ...extra });
    const close = async (id, ctx, extra) => {
      const root = id && (sessions.get(id) || rootFor(ctx));
      return root ? parse(await runHarold(root, ["close"], input(root, id, "Stop", extra), 230000)) : {};
    };

    api.on("before_prompt_build", async (_event, ctx) => {
      const id = ctx && (ctx.sessionId || ctx.sessionKey);
      const root = rootFor(ctx);
      if (!id || !root || sessions.has(id)) return undefined;
      sessions.set(id, root);
      const text = await runHarold(root, ["boot"], input(root, id, "SessionStart"), 55000);
      return text ? { prependContext: text } : undefined;
    }, { timeoutMs: 60000 });

    api.on("before_agent_finalize", async (event, ctx) => {
      const reply = await close(event.sessionId || (ctx && ctx.sessionId), ctx, { stop_hook_active: !!event.stopHookActive });
      if (reply.decision === "block" && reply.reason) {
        return { action: "revise", reason: reply.reason, retry: { instruction: "File what Harold close lists, then finish.", idempotencyKey: "harold-close", maxAttempts: 3 } };
      }
      return undefined;
    }, { timeoutMs: 240000 });

    api.on("agent_end", async (_event, ctx) => { await close(ctx && ctx.sessionId, ctx, {}); }, { timeoutMs: 240000 });

    api.on("session_end", async (event, ctx) => {
      const id = event.sessionId || (ctx && ctx.sessionId);
      const root = sessions.get(id) || rootFor(ctx);
      sessions.delete(id);
      if (id && root) await runHarold(root, ["close", "--final", "--detach"], input(root, id, "SessionEnd"), 1500);
    }, { timeoutMs: 2000 });
  },
};
