#!/usr/bin/env node
/*
 * Tests for bin/harold as a lifecycle hook (or behind a small plugin) in every harness beyond Claude Code, Codex
 * and Cursor (those are in tests/hooks.test.js): Gemini CLI, Qwen Code, Copilot CLI, Grok Build, Kimi Code,
 * goose, Hermes Agent, Cline, opencode, Amp and OpenClaw.
 *
 *   node --test tests/harnesses.test.js
 *
 * Same method as tests/hooks.test.js: each workspace is a throwaway copy of this repository with HOME pointed at
 * an empty directory. The input is what each tool documents (or, where its source is the documentation, what that
 * source sends); the assertions are on what each tool documents accepting back. The plugins are loaded with a stand-in
 * for the host API. These tests prove Harold's side of each contract; they do not run the tools themselves.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const { SRC } = require('./fixture'); // this repository, or in a workspace the starter's content with its machinery (tests/fixture.js)
const SKIP = new Set(['.git', 'node_modules', '.next', 'search.db', '.brief-job.json', '.brief-context.md', '.housekeeping-job.json', '.housekeeping-context.md', '.state', '.last-boot']);
const dirs = [];
test.after(() => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

const STRIP = ['HAROLD_ROOT', 'HAROLD_SESSION_ID', 'HAROLD_AGENT', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'CLAUDECODE', 'GITHUB_ACTIONS', 'CLAUDE_CODE_REMOTE', 'HAROLD_NOW', 'HAROLD_DETACHED', 'CURSOR_PROJECT_DIR', 'CURSOR_VERSION', 'GROK_WORKSPACE_ROOT', 'QWEN_PROJECT_DIR', 'GEMINI_PROJECT_DIR'];
function cleanEnv(w, extra = {}) {
  const env = { ...process.env };
  STRIP.forEach(k => delete env[k]);
  return { ...env, HOME: w.home, HAROLD_ENV_FILE: path.join(w.home, 'none'), ...extra };
}
function run(w, args, input, env = {}) {
  const r = spawnSync(process.execPath, [path.join(w.ws, 'bin/harold'), ...args], {
    cwd: w.ws, encoding: 'utf8', timeout: 120000, input: input === undefined ? '' : JSON.stringify(input), env: cleanEnv(w, env),
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const json = r => { try { return JSON.parse(r.out); } catch (e) { throw new Error(`not JSON (exit ${r.code}): ${r.out.slice(0, 300)} ${r.err.slice(0, 300)}`); } };

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-harness-'));
  dirs.push(dir);
  const ws = path.join(dir, 'ws'), home = path.join(dir, 'home');
  fs.mkdirSync(home);
  fs.cpSync(SRC, ws, { recursive: true, filter: s => !SKIP.has(path.basename(s)) && !/\/harold\/active-sessions\/[^/]+\.json$/.test(s) && !/\/harold\/briefs\/\d{4}-\d{2}-\d{2}\.md$/.test(s) });
  const g = (...a) => spawnSync('git', a, { cwd: ws, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 'test@example.com'); g('config', 'user.name', 'Test');
  g('add', '-A'); g('commit', '-qm', 'init');
  const w = { dir, ws, home };
  const chk = JSON.parse(run(w, ['check', '--json']).out);
  for (const d of [...chk.triggers.due, ...chk.triggers.overdue]) run(w, ['file', 'trigger', d.id, 'ran', 'test']);
  w.today = chk.today.iso;
  return w;
}
function dirty(w) { fs.appendFileSync(path.join(w.ws, 'harold/facts.md'), `\n- test fact ${Date.now()}\n`); }
function daily(w) { fs.writeFileSync(path.join(w.ws, `vault/daily/${w.today}-hook-test.md`), `# ${w.today} hook test\n\nWhat changed: a test fact.\n`); }
const stateOf = (w, id) => JSON.parse(fs.readFileSync(path.join(w.ws, `harold/active-sessions/.state/${id}.json`), 'utf8'));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise(r => setTimeout(r, 200)); } return false; }

// What each tool sends on stdin (field names from its documentation or source).
const gemini = (event, id, extra = {}) => ({ session_id: id, transcript_path: '/tmp/t.json', cwd: '/tmp', hook_event_name: event, timestamp: new Date().toISOString(), ...extra });
const qwen = (event, id, extra = {}) => ({ session_id: id, transcript_path: '/tmp/t.jsonl', cwd: '/tmp', hook_event_name: event, timestamp: new Date().toISOString(), permission_mode: 'default', ...extra });
const copilot = (id, extra = {}) => ({ sessionId: id, timestamp: Date.now(), cwd: '/tmp', ...extra });                       // camelCase events
const copilotVsc = (event, id, extra = {}) => ({ hook_event_name: event, session_id: id, timestamp: new Date().toISOString(), cwd: '/tmp', ...extra }); // PascalCase events
const grok = (event, id, extra = {}) => ({ hookEventName: event.replace(/[A-Z]/g, (c, i) => (i ? '_' : '') + c.toLowerCase()), hook_event_name: event, sessionId: id, session_id: id, cwd: '/tmp', workspaceRoot: '/tmp', timestamp: new Date().toISOString(), ...extra });
const kimi = (event, id, extra = {}) => ({ hook_event_name: event, session_id: id, cwd: '/tmp', ...extra });
const goose = (event, id, extra = {}) => ({ event, session_id: id, ...extra });
const hermes = (event, id, extra = {}) => ({ hook_event_name: event, tool_name: null, tool_input: null, session_id: id, cwd: '/tmp', profile: 'default', extra });
const cline = (hookName, id, extra = {}) => ({ taskId: id, hookName, clineVersion: '4.0.0', timestamp: String(Date.now()), workspaceRoots: ['/tmp'], ...extra });

test('Gemini CLI: SessionStart answers hookSpecificOutput.additionalContext; AfterAgent blocks with decision; SessionEnd detaches', () => {
  const w = workspace();
  const b = run(w, ['boot', '--via=gemini'], gemini('SessionStart', 'ge-1', { source: 'startup' }));
  assert.strictEqual(b.code, 0, b.err);
  const ctx = json(b);
  assert.strictEqual(ctx.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(ctx.hookSpecificOutput.additionalContext, /^# HAROLD BOOTED/);
  assert.match(ctx.hookSpecificOutput.additionalContext, /Harness: gemini-hook/);
  dirty(w);
  const blocked = json(run(w, ['close', '--via=gemini'], gemini('AfterAgent', 'ge-1', { prompt: 'p', prompt_response: 'r', stop_hook_active: false })));
  assert.strictEqual(blocked.decision, 'block');
  assert.match(blocked.reason, /filing incomplete/);
  daily(w);
  assert.deepStrictEqual(json(run(w, ['close', '--via=gemini'], gemini('AfterAgent', 'ge-1', { stop_hook_active: true }))), {});
  const t0 = Date.now();
  assert.deepStrictEqual(json(run(w, ['close', '--final', '--via=gemini', '--detach'], gemini('SessionEnd', 'ge-1', { reason: 'exit' }))), {});
  assert.ok(Date.now() - t0 < 5000);
});

test('Qwen Code: plain stdout at SessionStart, Claude Code answers at Stop', () => {
  const w = workspace();
  const b = run(w, ['boot', '--via=qwen'], qwen('SessionStart', 'qw-1', { source: 'startup', model: 'qwen3-coder' }));
  assert.match(b.out, /^# HAROLD BOOTED/);
  assert.match(b.out, /Harness: qwen-hook/);
  dirty(w);
  assert.strictEqual(json(run(w, ['close', '--via=qwen'], qwen('Stop', 'qw-1', { stop_hook_active: false, last_assistant_message: 'ok' }))).decision, 'block');
  daily(w);
  assert.deepStrictEqual(json(run(w, ['close', '--via=qwen'], qwen('Stop', 'qw-1', { stop_hook_active: true }))), {});
});

test('Copilot CLI: sessionStart answers {additionalContext}; agentStop blocks with decision; camelCase sessionId is the session', () => {
  const w = workspace();
  const b = run(w, ['boot', '--via=copilot'], copilot('cp-1', { source: 'new', initialPrompt: 'hi' }));
  const ctx = json(b);
  assert.deepStrictEqual(Object.keys(ctx), ['additionalContext']);
  assert.match(ctx.additionalContext, /^# HAROLD BOOTED/);
  assert.match(ctx.additionalContext, /Harness: copilot-hook/);
  dirty(w);
  const blocked = json(run(w, ['close', '--via=copilot'], copilot('cp-1', { transcriptPath: '/tmp/t', stopReason: 'end_turn', stop_hook_active: false })));
  assert.strictEqual(blocked.decision, 'block');
  assert.ok(fs.existsSync(path.join(w.ws, 'harold/active-sessions/.state/cp-1.json')), 'stop found the session booted under the same id');
  daily(w);
  assert.deepStrictEqual(json(run(w, ['close', '--via=copilot'], copilot('cp-1', { stopReason: 'end_turn', stop_hook_active: true }))), {});
  assert.deepStrictEqual(json(run(w, ['close', '--final', '--via=copilot', '--detach'], copilot('cp-1', { reason: 'user_exit' }))), {});
});

test('Copilot CLI running .claude/settings.json steps aside while .github/copilot/settings.json wires Harold, else answers as Copilot', () => {
  const w = workspace();
  assert.deepStrictEqual(json(run(w, ['boot', '--via=claude'], copilotVsc('SessionStart', 'cpc-1', { source: 'startup' }))), {});
  assert.ok(!fs.existsSync(path.join(w.ws, 'harold/active-sessions/.state/cpc-1.json')), 'no session registered by the borrowed hook');
  dirty(w);
  assert.deepStrictEqual(json(run(w, ['close', '--via=claude'], copilotVsc('Stop', 'cpc-1', { transcript_path: '/tmp/t', stop_reason: 'end_turn', stop_hook_active: false }))), {});
  fs.rmSync(path.join(w.ws, '.github/copilot/settings.json'));
  const b = json(run(w, ['boot', '--via=claude'], copilotVsc('SessionStart', 'cpc-2', { source: 'startup' })));
  assert.match(b.additionalContext, /Harness: copilot-hook/);
  // Claude Code's own input has no timestamp: still Claude Code, plain text.
  assert.match(run(w, ['boot', '--via=claude'], { session_id: 'cc-x', transcript_path: '/tmp/t', cwd: '/tmp', hook_event_name: 'SessionStart', source: 'startup' }).out, /^# HAROLD BOOTED[\s\S]*Harness: claude-code-hook/);
});

test('Grok Build: start output never reaches the model, so the agent\'s own boot adopts the session and close blocks until it has run', () => {
  const w = workspace();
  const b = run(w, ['boot', '--via=grok'], grok('SessionStart', 'gk-1', { source: 'startup' }));
  assert.strictEqual(b.code, 0, b.err);
  assert.doesNotMatch(b.out, /HAROLD BOOTED/, 'no full context where nobody reads it');
  assert.match(b.out, /session registered/);
  assert.strictEqual(stateOf(w, 'gk-1').contextDelivered, false);
  // The first Stop of the session: the context is not loaded yet.
  const first = json(run(w, ['close', '--via=grok'], grok('Stop', 'gk-1', { reason: 'end_turn', stopHookActive: false })));
  assert.strictEqual(first.decision, 'block');
  assert.match(first.reason, /context is not loaded[\s\S]*bin\/harold boot/);
  // The agent runs boot itself (a shell command: no hook input). That run prints the context for the hook's session.
  const own = run(w, ['boot']);
  assert.strictEqual(own.code, 0, own.err);
  assert.match(own.out, /^# HAROLD BOOTED[\s\S]*Harness: grok-hook {3}\(this run loads the context/);
  assert.match(own.out, /session-[\d-]+-gk1\.json/, 'same session file as the hook registered');
  assert.ok(stateOf(w, 'gk-1').adoptedAt);
  assert.strictEqual(fs.readdirSync(path.join(w.ws, 'harold/active-sessions')).filter(f => f.endsWith('.json')).length, 1, 'one session file, not two');
  assert.deepStrictEqual(json(run(w, ['close', '--via=grok'], grok('Stop', 'gk-1', { reason: 'end_turn', stopHookActive: true }))), {});
  // The extra Stop Grok fires at session end does nothing; SessionEnd does the final close.
  dirty(w);
  assert.deepStrictEqual(json(run(w, ['close', '--via=grok'], grok('Stop', 'gk-1', { reason: 'shutdown' }))), {});
  assert.strictEqual(stateOf(w, 'gk-1').blocks || 0, 0, 'the session-end Stop checked nothing');
});

test('Grok Build running the Claude Code and Cursor hook files steps aside while .grok/hooks/harold.json exists', () => {
  const w = workspace();
  for (const via of ['claude', 'cursor']) {
    assert.strictEqual(run(w, ['boot', `--via=${via}`], grok('SessionStart', `gkx-${via}`)).out, '');
    dirty(w);
    assert.deepStrictEqual(json(run(w, ['close', `--via=${via}`], grok('Stop', `gkx-${via}`, { reason: 'end_turn' }))), {});
  }
  assert.ok(!fs.existsSync(path.join(w.ws, 'harold/active-sessions/.state/gkx-claude.json')));
  fs.rmSync(path.join(w.ws, '.grok/hooks/harold.json'));
  run(w, ['boot', '--via=claude'], grok('SessionStart', 'gkx-2'));
  assert.strictEqual(stateOf(w, 'gkx-2').harness, 'grok-hook', 'without Grok\'s own file the borrowed hook does the work, as Grok');
});

test('Kimi Code: SessionStart registers silently; Stop keeps the agent going with exit 2 and the reason on stderr', () => {
  const w = workspace();
  const b = run(w, ['boot', '--via=kimi'], kimi('SessionStart', 'km-1', { source: 'startup' }));
  assert.strictEqual(b.code, 0);
  assert.strictEqual(b.out, '', 'Kimi never reads it');
  const blocked = run(w, ['close', '--via=kimi'], kimi('Stop', 'km-1', { stop_hook_active: false }));
  assert.strictEqual(blocked.code, 2);
  assert.strictEqual(blocked.out, '');
  assert.match(blocked.err, /context is not loaded/);
  assert.match(run(w, ['boot']).out, /Harness: kimi-hook {3}\(this run loads the context/);
  dirty(w);
  assert.match(run(w, ['close', '--via=kimi'], kimi('Stop', 'km-1')).err, /no vault\/daily note/);
  daily(w);
  const ok = run(w, ['close', '--via=kimi'], kimi('Stop', 'km-1', { stop_hook_active: true }));
  assert.strictEqual(ok.code, 0, ok.err);
  assert.strictEqual(ok.out, '');
});

test('goose: SessionStart answers a banner for the person; Stop answers decision block, or allow (never an empty decision)', () => {
  const w = workspace();
  const b = json(run(w, ['boot', '--via=goose'], goose('SessionStart', 'gs-1')));
  assert.deepStrictEqual(Object.keys(b), ['banner']);
  assert.match(b.banner, /^Harold: session registered/);
  assert.strictEqual(json(run(w, ['close', '--via=goose'], goose('Stop', 'gs-1', { last_assistant_message: 'done' }))).decision, 'block');
  run(w, ['boot']);
  daily(w);
  assert.deepStrictEqual(json(run(w, ['close', '--via=goose'], goose('Stop', 'gs-1'))), { decision: 'allow' });
});

test('Hermes Agent: first-turn pre_llm_call gets {context}; pre_verify blocks; later turns carry what the last close found', () => {
  const w = workspace();
  const first = json(run(w, ['boot', '--via=hermes'], hermes('pre_llm_call', 'hm-1', { is_first_turn: true, user_message: 'hi', model: 'm', platform: 'cli' })));
  assert.match(first.context, /^# HAROLD BOOTED[\s\S]*Harness: hermes-hook/);
  assert.deepStrictEqual(json(run(w, ['boot', '--via=hermes'], hermes('pre_llm_call', 'hm-1', { is_first_turn: false }))), {}, 'nothing to add on a clean later turn');
  dirty(w);
  const blocked = json(run(w, ['close', '--via=hermes'], hermes('pre_verify', 'hm-1', { attempt: 0, coding: false, changed_paths: ['harold/facts.md'] })));
  assert.strictEqual(blocked.decision, 'block');
  assert.match(blocked.reason, /filing incomplete/);
  // on_session_end cannot block: it answers {} and the problems wait for the next turn.
  assert.deepStrictEqual(json(run(w, ['close', '--via=hermes'], hermes('on_session_end', 'hm-1', { completed: true, interrupted: false }))), {});
  assert.match(json(run(w, ['boot', '--via=hermes'], hermes('pre_llm_call', 'hm-1', { is_first_turn: false }))).context, /filing incomplete[\s\S]*no vault\/daily note/);
  daily(w);
  assert.deepStrictEqual(json(run(w, ['close', '--via=hermes'], hermes('pre_verify', 'hm-1', { attempt: 1 }))), {});
  assert.deepStrictEqual(json(run(w, ['boot', '--via=hermes'], hermes('pre_llm_call', 'hm-1', { is_first_turn: false }))), {});
});

test('Cline: TaskStart answers contextModification once per task; TaskComplete closes detached and the next TaskStart reports problems', async () => {
  const w = workspace();
  const start = json(run(w, ['boot', '--via=cline'], cline('TaskStart', 'cl-1', { taskStart: { taskMetadata: { taskId: 'cl-1', ulid: '', initialTask: 'hi' } } })));
  assert.strictEqual(start.cancel, false);
  assert.match(start.contextModification, /^# HAROLD BOOTED[\s\S]*Harness: cline-hook/);
  assert.ok(start.contextModification.length < 50000, 'inside Cline\'s 50,000-character context limit');
  dirty(w);
  const t0 = Date.now();
  const done = json(run(w, ['close', '--via=cline', '--detach'], cline('TaskComplete', 'cl-1', { taskComplete: { taskMetadata: { taskId: 'cl-1', result: 'ok' } } })));
  assert.deepStrictEqual(done, { cancel: false, contextModification: '', errorMessage: '' });
  assert.ok(Date.now() - t0 < 5000, 'inside Cline\'s 30-second hook limit');
  assert.ok(await until(() => (stateOf(w, 'cl-1').lastProblems || []).length > 0), 'the detached close recorded what is unfiled');
  const next = json(run(w, ['boot', '--via=cline'], cline('TaskStart', 'cl-1')));
  assert.match(next.contextModification, /filing incomplete[\s\S]*no vault\/daily note/);
  assert.doesNotMatch(next.contextModification, /HAROLD BOOTED/, 'the full context only once per task');
});

test('The global (user-level) snippets for Kimi and Hermes do nothing outside a Harold workspace', () => {
  const w = workspace();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'not-harold-')); dirs.push(elsewhere);
  const toml = fs.readFileSync(path.join(SRC, 'tools/harness-hooks/kimi-config.toml'), 'utf8');
  const kimiCmds = [...toml.matchAll(/^command = '(.*)'$/gm)].map(m => m[1]);
  const yaml = fs.readFileSync(path.join(SRC, 'tools/harness-hooks/hermes-config.yaml'), 'utf8');
  const hermesCmds = [...yaml.matchAll(/command: >-\n((?:\s{8}.*\n)+)/g)].map(m => m[1].split('\n').map(l => l.trim()).filter(Boolean).join(' '))
    .map(c => c.replace(/^sh -c '(.*)'$/, '$1'));
  assert.strictEqual(kimiCmds.length, 3);
  assert.strictEqual(hermesCmds.length, 4);
  for (const c of [...kimiCmds, ...hermesCmds]) {
    const r = spawnSync('/bin/sh', ['-c', c], { cwd: elsewhere, encoding: 'utf8', input: '{}', env: cleanEnv(w) });
    assert.strictEqual(r.status, 0, c);
    assert.ok(r.stdout.trim() === '' || r.stdout.trim() === '{}', `no-op outside a workspace: ${c}`);
  }
  // Inside the workspace (from a subfolder) they reach bin/harold.
  const sub = path.join(w.ws, 'vault/people');
  const kb = spawnSync('/bin/sh', ['-c', kimiCmds[0]], { cwd: sub, encoding: 'utf8', input: JSON.stringify(kimi('SessionStart', 'km-snip')), env: cleanEnv(w) });
  assert.strictEqual(kb.status, 0, kb.stderr);
  assert.ok(fs.existsSync(path.join(w.ws, 'harold/active-sessions/.state/km-snip.json')));
  const hb = spawnSync('/bin/sh', ['-c', hermesCmds[0]], { cwd: sub, encoding: 'utf8', input: JSON.stringify(hermes('pre_llm_call', 'hm-snip', { is_first_turn: true })), env: cleanEnv(w) });
  assert.match(JSON.parse(hb.stdout).context, /HAROLD BOOTED/);
});

// ───────── plugins: loaded with a stand-in for the host API ─────────
async function load(w, rel) {
  const copy = path.join(w.dir, path.basename(rel).replace(/\.(ts|js)$/, '') + '-' + Math.random().toString(36).slice(2) + '.mjs');
  fs.copyFileSync(path.join(w.ws, rel), copy);
  return import(pathToFileURL(copy).href);
}
function withEnv(w, fn) {
  const saved = { ...process.env };
  Object.assign(process.env, cleanEnv(w));
  STRIP.forEach(k => delete process.env[k]);
  return Promise.resolve(fn()).finally(() => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); });
}

test('opencode plugin: boot output joins the system prompt; an idle session with incomplete filing gets the reason as a new message', async () => {
  const w = workspace();
  await withEnv(w, async () => {
    const mod = await load(w, '.opencode/plugins/harold.js');
    assert.deepStrictEqual(Object.keys(mod), ['HaroldPlugin'], 'opencode runs every export as a plugin');
    const sent = [];
    const hooks = await mod.HaroldPlugin({ client: { session: { promptAsync: async b => sent.push(b) } }, directory: w.ws, worktree: w.ws });
    const out = { system: [] };
    await hooks['experimental.chat.system.transform']({ sessionID: 'oc-1', model: {} }, out);
    assert.match(out.system.join('\n'), /^# HAROLD BOOTED[\s\S]*Harness: opencode-hook/);
    const again = { system: [] };
    await hooks['experimental.chat.system.transform']({ sessionID: 'oc-1', model: {} }, again);
    assert.strictEqual(again.system.join(), out.system.join(), 'every request of the session carries the same context; boot ran once');
    dirty(w);
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'oc-1' } } });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].path.id, 'oc-1');
    assert.match(sent[0].body.parts[0].text, /filing incomplete/);
    daily(w);
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'oc-1' } } });
    assert.strictEqual(sent.length, 1, 'filed: no follow-up');
    const none = await mod.HaroldPlugin({ client: {}, directory: w.home, worktree: w.home });
    assert.deepStrictEqual(none, {}, 'outside a Harold workspace the plugin does nothing');
  });
});

test('Amp plugin: agent.start adds the context to the first prompt of a thread; agent.end answers continue while filing is incomplete', async () => {
  const w = workspace();
  await withEnv(w, async () => {
    const mod = await load(w, '.amp/plugins/harold.ts');
    const handlers = {}; const disposers = [];
    mod.default({ system: { workspaceRoot: { toString: () => pathToFileURL(w.ws).href } }, helpers: { filePathFromURI: u => new URL(u.toString()).pathname }, on: (e, h) => { handlers[e] = h; }, onDispose: f => disposers.push(f) });
    const s = await handlers['agent.start']({ thread: { id: 'T-1' }, message: 'hi', id: 1 });
    assert.match(s.message.content, /^# HAROLD BOOTED[\s\S]*Harness: amp-hook/);
    assert.strictEqual(s.message.display, false);
    assert.deepStrictEqual(await handlers['agent.start']({ thread: { id: 'T-1' }, message: 'more', id: 2 }), {}, 'once per thread');
    dirty(w);
    const c = await handlers['agent.end']({ thread: { id: 'T-1' }, status: 'done', messages: [] });
    assert.strictEqual(c.action, 'continue');
    assert.match(c.userMessage, /filing incomplete/);
    assert.strictEqual(await handlers['agent.end']({ thread: { id: 'T-1' }, status: 'cancelled', messages: [] }), undefined, 'a cancelled turn is not checked');
    daily(w);
    assert.strictEqual(await handlers['agent.end']({ thread: { id: 'T-1' }, status: 'done', messages: [] }), undefined);
    assert.strictEqual(disposers.length, 1);
  });
});

test('OpenClaw plugin: before_prompt_build prepends the context once; before_agent_finalize revises while filing is incomplete', async () => {
  const w = workspace();
  await withEnv(w, async () => {
    const mod = await import(pathToFileURL(path.join(w.ws, 'tools/openclaw-plugin/index.js')).href);
    const plugin = mod.default;
    assert.strictEqual(plugin.id, 'harold');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(w.ws, 'tools/openclaw-plugin/openclaw.plugin.json'), 'utf8')).id, plugin.id);
    const handlers = {};
    plugin.register({ pluginConfig: {}, on: (e, h, opts) => { handlers[e] = { h, opts }; } });
    assert.deepStrictEqual(Object.keys(handlers).sort(), ['agent_end', 'before_agent_finalize', 'before_prompt_build', 'session_end']);
    const ctx = { sessionId: 'oc-s1', workspaceDir: w.ws };
    const first = await handlers.before_prompt_build.h({ prompt: 'hi', messages: [] }, ctx);
    assert.match(first.prependContext, /^# HAROLD BOOTED[\s\S]*Harness: openclaw-hook/);
    assert.strictEqual(await handlers.before_prompt_build.h({ prompt: 'more', messages: [] }, ctx), undefined, 'once per session');
    dirty(w);
    const r = await handlers.before_agent_finalize.h({ sessionId: 'oc-s1', stopHookActive: false }, ctx);
    assert.strictEqual(r.action, 'revise');
    assert.match(r.reason, /filing incomplete/);
    assert.ok(handlers.before_agent_finalize.opts.timeoutMs >= 240000, 'longer than the 15-second default budget');
    daily(w);
    assert.strictEqual(await handlers.before_agent_finalize.h({ sessionId: 'oc-s1', stopHookActive: true }, ctx), undefined);
  });
});

// ───────── the shipped wiring ─────────
test('Every shipped hook file parses and points each event at bin/harold with the right --via', () => {
  const read = rel => JSON.parse(fs.readFileSync(path.join(SRC, rel), 'utf8'));
  const g = read('.gemini/settings.json');
  assert.deepStrictEqual(g.context.fileName, ['AGENTS.md', 'GEMINI.md'], 'Gemini still reads AGENTS.md');
  const q = read('.qwen/settings.json').hooks, gk = read('.grok/hooks/harold.json').hooks, gs = read('.agents/plugins/harold/hooks/hooks.json').hooks;
  const cp = read('.github/copilot/settings.json').hooks;
  const cmd = (h, ev) => h[ev][0].hooks[0].command;
  const cases = [
    [g.hooks, 'SessionStart', 'boot --via=gemini'], [g.hooks, 'AfterAgent', 'close --via=gemini'], [g.hooks, 'SessionEnd', 'close --final --via=gemini --detach'],
    [q, 'SessionStart', 'boot --via=qwen'], [q, 'Stop', 'close --via=qwen'], [q, 'SessionEnd', 'close --final --via=qwen'],
    [gk, 'SessionStart', 'boot --via=grok'], [gk, 'Stop', 'close --via=grok'], [gk, 'SessionEnd', 'close --final --via=grok --detach'],
    [gs, 'SessionStart', 'boot --via=goose'], [gs, 'Stop', 'close --via=goose'], [gs, 'SessionEnd', 'close --final --via=goose'],
  ];
  for (const [h, ev, tail] of cases) assert.ok(cmd(h, ev).endsWith(`/bin/harold" ${tail}`), `${ev}: ${cmd(h, ev)}`);
  assert.ok(g.hooks.SessionStart[0].hooks[0].timeout >= 1000, 'Gemini timeouts are milliseconds');
  for (const [ev, tail] of [['sessionStart', 'boot --via=copilot'], ['agentStop', 'close --via=copilot'], ['sessionEnd', 'close --final --via=copilot --detach']]) assert.ok(cp[ev][0].bash.endsWith(`/bin/harold" ${tail}`), ev);
  assert.strictEqual(read('.agents/plugins/harold/plugin.json').name, 'harold');
  for (const [f, tail] of [['TaskStart', 'boot --via=cline'], ['TaskComplete', 'close --via=cline --detach'], ['TaskCancel', 'close --via=cline --detach'], ['TaskError', 'close --via=cline --detach'], ['SessionShutdown', 'close --final --via=cline --detach']]) {
    const p = path.join(SRC, '.clinerules/hooks', f);
    assert.ok(fs.statSync(p).mode & 0o111, `${f} is executable`);
    assert.match(fs.readFileSync(p, 'utf8'), new RegExp(`^#!/bin/sh[\\s\\S]*bin/harold" ${tail}\\n$`));
  }
});

test('The hook commands resolve the workspace from a subfolder', () => {
  const w = workspace();
  const sub = path.join(w.ws, 'vault/people');
  const read = rel => JSON.parse(fs.readFileSync(path.join(w.ws, rel), 'utf8'));
  const cmds = [
    ['gemini', read('.gemini/settings.json').hooks.SessionStart[0].hooks[0].command, gemini('SessionStart', 'sh-ge'), {}],
    ['qwen', read('.qwen/settings.json').hooks.SessionStart[0].hooks[0].command, qwen('SessionStart', 'sh-qw'), {}],
    ['copilot', read('.github/copilot/settings.json').hooks.sessionStart[0].bash, copilot('sh-cp'), {}],
    ['grok', read('.grok/hooks/harold.json').hooks.SessionStart[0].hooks[0].command, grok('SessionStart', 'sh-gk'), {}],
    ['grok+root', read('.grok/hooks/harold.json').hooks.SessionStart[0].hooks[0].command, grok('SessionStart', 'sh-gk2'), { GROK_WORKSPACE_ROOT: w.ws }],
    ['goose', read('.agents/plugins/harold/hooks/hooks.json').hooks.SessionStart[0].hooks[0].command.replace('${PLUGIN_ROOT}', path.join(w.ws, '.agents/plugins/harold')), goose('SessionStart', 'sh-gs'), {}],
    ['cline', `"${path.join(w.ws, '.clinerules/hooks/TaskStart')}"`, cline('TaskStart', 'sh-cl'), {}],
  ];
  for (const [name, c, input, env] of cmds) {
    const r = spawnSync('/bin/sh', ['-c', c], { cwd: sub, encoding: 'utf8', input: JSON.stringify(input), env: cleanEnv(w, env) });
    assert.strictEqual(r.status, 0, `${name}: ${c}\n${r.stderr}`);
    assert.match(r.stdout, /HAROLD BOOTED|session registered/, `${name}: ${r.stdout.slice(0, 200)}`);
  }
});
