// Harold for Amp. Amp loads project plugins from .amp/plugins/*.ts (the @ampcode/plugin package, index.d.ts and README).
// Amp has no shell hooks, so this plugin runs bin/harold at the same points:
//   start     the first prompt of each thread (agent.start) runs `bin/harold boot`; its output is added to that message
//   each turn agent.end runs `bin/harold close`; when filing is incomplete it answers {action: 'continue'} with the
//             reason, so Amp starts another turn (bin/harold stops asking after four attempts)
//   end       when Amp stops the plugin (quitting, reloading) `bin/harold close --final` runs, detached
// Written without type annotations so it is also plain JavaScript.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const description = 'Harold: boot context on the first prompt of a thread, filing check at the end of every turn'

function runHarold(root, args, input, timeoutMs) {
	return new Promise((resolve) => {
		let out = ''
		let child
		try {
			child = spawn(join(root, 'bin', 'harold'), [...args, '--via=amp'], { cwd: root, stdio: ['pipe', 'pipe', 'ignore'] })
		} catch {
			return resolve('')
		}
		const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
		child.stdout.on('data', (d) => (out += d))
		child.on('error', () => { clearTimeout(timer); resolve('') })
		child.on('close', () => { clearTimeout(timer); resolve(out.trim()) })
		child.stdin.on('error', () => {})
		child.stdin.end(JSON.stringify(input))
	})
}

export default function (amp) {
	let workspace = null
	try { workspace = amp.system.workspaceRoot ? amp.helpers.filePathFromURI(amp.system.workspaceRoot) : null } catch {}
	const root = [process.env.HAROLD_ROOT, workspace].find((d) => d && existsSync(join(d, 'bin', 'harold')))
	if (!root) return
	const booted = new Set()
	const nudged = new Set()
	const input = (id, event, extra = {}) => ({ session_id: id, hook_event_name: event, cwd: root, ...extra })

	amp.on('agent.start', async (event) => {
		const id = event.thread.id
		if (booted.has(id)) return {}
		booted.add(id)
		const text = await runHarold(root, ['boot'], input(id, 'SessionStart'), 60000)
		return text ? { message: { content: text, display: false } } : {}
	})

	amp.on('agent.end', async (event) => {
		if (event.status !== 'done') return
		const id = event.thread.id
		let reply = {}
		try { reply = JSON.parse(await runHarold(root, ['close'], input(id, 'Stop', { stop_hook_active: nudged.has(id) }), 240000)) } catch {}
		if (reply.decision === 'block' && reply.reason) {
			nudged.add(id)
			return { action: 'continue', userMessage: reply.reason, maxContinuations: 4 }
		}
		nudged.delete(id)
	})

	// Amp gives all dispose callbacks about 3 seconds together: hand the work to a detached close.
	amp.onDispose(async () => {
		await Promise.all([...booted].map((id) => runHarold(root, ['close', '--final', '--detach'], input(id, 'SessionEnd'), 2500)))
	})
}
