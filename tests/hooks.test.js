#!/usr/bin/env node
/*
 * Tests for bin/harold as a lifecycle hook in Claude Code, Codex and Cursor.
 *
 *   node --test tests/hooks.test.js
 *
 * Each workspace is a throwaway copy of this repository (its own git repo, no remote), with HOME
 * pointed at an empty directory so no real ~/.harold/env, CRM or Linear credentials are read. The
 * hook input is what each tool documents sending on stdin; the assertions are on what each tool
 * documents accepting back:
 *   Claude Code, Codex  SessionStart: plain stdout. Stop: {} or {"decision":"block","reason"}.
 *   Cursor              sessionStart: {"additional_context"}. stop: {} or {"followup_message"}.
 * These tests prove the program's side of the contract. They do not run the tools themselves.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = path.resolve(__dirname, '..');
const SKIP = new Set(['.git', 'node_modules', '.next', 'search.db', '.brief-job.json', '.brief-context.md', '.housekeeping-job.json', '.housekeeping-context.md', '.state']);
const dirs = [];
test.after(() => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-hooks-'));
  dirs.push(dir);
  const ws = path.join(dir, 'ws'), home = path.join(dir, 'home');
  fs.mkdirSync(home);
  fs.cpSync(SRC, ws, { recursive: true, filter: s => !SKIP.has(path.basename(s)) && !/\/harold\/active-sessions\/[^/]+\.json$/.test(s) && !/\/harold\/briefs\/\d{4}-\d{2}-\d{2}\.md$/.test(s) });
  const g = (...a) => spawnSync('git', a, { cwd: ws, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 'test@example.com'); g('config', 'user.name', 'Test');
  g('add', '-A'); g('commit', '-qm', 'init');
  const w = { dir, ws, home };
  // Record the scheduled work due today, so a clean close is clean on any date the tests run.
  const chk = JSON.parse(run(w, ['check', '--json']).out);
  for (const d of [...chk.triggers.due, ...chk.triggers.overdue]) run(w, ['file', 'trigger', d.id, 'ran', 'test']);
  w.today = chk.today.iso;
  return w;
}

const STRIP = ['HAROLD_ROOT', 'HAROLD_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'GITHUB_ACTIONS', 'CLAUDE_CODE_REMOTE', 'HAROLD_NOW', 'HAROLD_DETACHED', 'CURSOR_PROJECT_DIR', 'CURSOR_VERSION'];
function run(w, args, input, env = {}) {
  const clean = { ...process.env };
  STRIP.forEach(k => delete clean[k]);
  const r = spawnSync(process.execPath, [path.join(w.ws, 'bin/harold'), ...args], {
    cwd: w.ws, encoding: 'utf8', timeout: 120000, input: input === undefined ? '' : JSON.stringify(input),
    env: { ...clean, HOME: w.home, HAROLD_ENV_FILE: path.join(w.home, 'none'), ...env },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const json = r => { try { return JSON.parse(r.out); } catch (e) { throw new Error(`not JSON (exit ${r.code}): ${r.out.slice(0, 300)} ${r.err.slice(0, 300)}`); } };

// What each tool sends (field names from their hook documentation).
const claude = (event, id, extra = {}) => ({ session_id: id, transcript_path: '/tmp/t.jsonl', cwd: '/tmp', hook_event_name: event, permission_mode: 'default', ...extra });
const codex = (event, id, extra = {}) => ({ session_id: id, transcript_path: null, cwd: '/tmp', hook_event_name: event, model: 'gpt-5', ...(event === 'Stop' ? { turn_id: 't1', stop_hook_active: false, last_assistant_message: 'ok' } : {}), ...extra });
const cursorBase = (event, id) => ({ conversation_id: id, generation_id: 'g1', model: 'm', hook_event_name: event, cursor_version: '2.1.0', workspace_roots: ['/tmp'], user_email: null, transcript_path: null });
const cursor = (event, id, extra = {}) => ({ ...cursorBase(event, id), ...(event === 'stop' ? { status: 'completed', loop_count: 0 } : { session_id: id, is_background_agent: false }), ...extra });

function dirty(w) { fs.appendFileSync(path.join(w.ws, 'harold/facts.md'), `\n- test fact ${Date.now()}\n`); }
function daily(w) { fs.writeFileSync(path.join(w.ws, `vault/daily/${w.today}-hook-test.md`), `# ${w.today} hook test\n\nWhat changed: a test fact.\n`); }

test('Claude Code: boot prints plain context; close answers {} when filed, decision:block when not', () => {
  const w = workspace();
  const b = run(w, ['boot', '--via=claude'], claude('SessionStart', 'cc-1', { source: 'startup' }));
  assert.strictEqual(b.code, 0, b.err);
  assert.match(b.out, /^# HAROLD BOOTED/);
  assert.match(b.out, /Harness: claude-code-hook/);
  const again = run(w, ['boot', '--via=claude'], claude('SessionStart', 'cc-1', { source: 'resume' }));
  assert.match(again.out, /^Harold already booted/, 'second boot in the same session is one line');

  // (Blocked case first: a clean close makes the next close within 20 seconds a no-op by design.)
  dirty(w);
  const blocked = json(run(w, ['close', '--via=claude'], claude('Stop', 'cc-1', { stop_hook_active: false })));
  assert.strictEqual(blocked.decision, 'block');
  assert.match(blocked.reason, /HAROLD CLOSE: filing incomplete/);
  assert.match(blocked.reason, /no vault\/daily note/);
  daily(w);
  assert.deepStrictEqual(json(run(w, ['close', '--via=claude'], claude('Stop', 'cc-1', { stop_hook_active: true }))), {});
  const log = spawnSync('git', ['log', '-1', '--format=%s'], { cwd: w.ws, encoding: 'utf8' }).stdout;
  assert.match(log, /^chore\(session\)/, 'a clean close commits');
});

test('Claude Code input without --via is still recognised (plugin hooks, older settings)', () => {
  const w = workspace();
  const b = run(w, ['boot'], claude('SessionStart', 'cc-2', { source: 'startup' }));
  assert.match(b.out, /^# HAROLD BOOTED/);
  assert.match(b.out, /Harness: claude-code-hook/);
  dirty(w);
  assert.strictEqual(json(run(w, ['close'], claude('Stop', 'cc-2'))).decision, 'block');
});

test('Codex: same formats as Claude Code; Stop input with turn_id is recognised as Codex', () => {
  const w = workspace();
  const b = run(w, ['boot', '--via=codex'], codex('SessionStart', 'cx-1', { source: 'startup' }));
  assert.strictEqual(b.code, 0, b.err);
  assert.match(b.out, /^# HAROLD BOOTED/);
  assert.match(b.out, /Harness: codex-hook/);
  dirty(w);
  const blocked = json(run(w, ['close'], codex('Stop', 'cx-1')));  // no flag: inferred from turn_id
  assert.strictEqual(blocked.decision, 'block');
  assert.match(blocked.reason, /filing incomplete/);
  daily(w);
  assert.deepStrictEqual(json(run(w, ['close', '--via=codex'], codex('Stop', 'cx-1', { stop_hook_active: true }))), {});
});

test('Codex SessionEnd: close --final --detach returns {} at once and finishes in a detached process', async () => {
  const w = workspace();
  run(w, ['boot', '--via=codex'], codex('SessionStart', 'cx-end', { source: 'startup' }));
  const sessions = path.join(w.ws, 'harold/active-sessions');
  const file = fs.readdirSync(sessions).find(f => f.endsWith('.json') && f.includes('cxend'));
  assert.ok(file, 'boot registered a session file');
  const t0 = Date.now();
  const r = run(w, ['close', '--final', '--via=codex', '--detach'], codex('SessionEnd', 'cx-end', { reason: 'other' }));
  assert.ok(Date.now() - t0 < 3000, 'inside the 3-second SessionEnd limit');
  assert.deepStrictEqual(json(r), {});
  let closed = false;
  for (let i = 0; i < 60 && !closed; i++) {
    await new Promise(res => setTimeout(res, 250));
    try { closed = JSON.parse(fs.readFileSync(path.join(sessions, file), 'utf8')).session === false; } catch (_) {}
  }
  assert.ok(closed, 'the detached close --final set "session": false');
  const log = fs.readFileSync(path.join(sessions, '.state/cx-end.detached.log'), 'utf8');
  assert.match(log, /harold close \(final\) OK/);
});

test('Cursor: sessionStart answers additional_context; stop answers {} or followup_message', () => {
  const w = workspace();
  const b = run(w, ['boot', '--via=cursor'], cursor('sessionStart', 'cu-1', { composer_mode: 'agent' }));
  assert.strictEqual(b.code, 0, b.err);
  const ctx = json(b);
  assert.deepStrictEqual(Object.keys(ctx), ['additional_context']);
  assert.match(ctx.additional_context, /^# HAROLD BOOTED/);
  assert.match(ctx.additional_context, /Harness: cursor-hook/);
  assert.match(json(run(w, ['boot', '--via=cursor'], cursor('sessionStart', 'cu-1'))).additional_context, /^Harold already booted/);

  dirty(w);
  const blocked = json(run(w, ['close', '--via=cursor'], cursor('stop', 'cu-1')));
  assert.deepStrictEqual(Object.keys(blocked), ['followup_message']);
  assert.match(blocked.followup_message, /HAROLD CLOSE: filing incomplete/);
  // The operator aborted the turn: never restart the agent.
  assert.deepStrictEqual(json(run(w, ['close', '--via=cursor'], cursor('stop', 'cu-1', { status: 'aborted', loop_count: 1 }))), {});
  daily(w);
  assert.deepStrictEqual(json(run(w, ['close', '--via=cursor'], cursor('stop', 'cu-1', { loop_count: 1 }))), {});
  const end = run(w, ['close', '--final', '--via=cursor'], cursor('sessionEnd', 'cu-1', { reason: 'user_close', duration_ms: 1000, final_status: 'completed' }));
  assert.deepStrictEqual(json(end), {});
});

test('Cursor input is recognised without --via (stop carries conversation_id, not session_id)', () => {
  const w = workspace();
  const b = run(w, ['boot'], cursor('sessionStart', 'cu-2'));
  assert.match(json(b).additional_context, /Harness: cursor-hook/);
  dirty(w);
  assert.ok(json(run(w, ['close'], cursor('stop', 'cu-2'))).followup_message);
  assert.ok(fs.existsSync(path.join(w.ws, 'harold/active-sessions/.state/cu-2.json')), 'stop found the session booted under the same id');
});

test('Cursor running the Claude Code hook file steps aside when .cursor/hooks.json exists', () => {
  const w = workspace();
  const b = run(w, ['boot', '--via=claude'], cursor('sessionStart', 'cu-3'));
  assert.deepStrictEqual(json(b), {});
  assert.ok(!fs.existsSync(path.join(w.ws, 'harold/active-sessions/.state/cu-3.json')), 'no session registered by the imported hook');
  dirty(w);
  assert.deepStrictEqual(json(run(w, ['close', '--via=claude'], cursor('stop', 'cu-3'))), {}, 'the imported Stop does nothing');
  // Without Cursor's own file, the imported hook does the work, in Cursor's format.
  fs.rmSync(path.join(w.ws, '.cursor/hooks.json'));
  assert.match(json(run(w, ['boot', '--via=claude'], cursor('sessionStart', 'cu-4'))).additional_context, /HAROLD BOOTED/);
  dirty(w);
  assert.ok(json(run(w, ['close', '--via=claude'], cursor('stop', 'cu-4'))).followup_message);
});

test('A second close for the same session while one is running steps aside', () => {
  const w = workspace();
  run(w, ['boot', '--via=claude'], claude('SessionStart', 'lock-1'));
  dirty(w);
  const lock = path.join(w.ws, 'harold/active-sessions/.state/lock-1.closing');
  fs.mkdirSync(lock, { recursive: true });
  assert.deepStrictEqual(json(run(w, ['close', '--via=claude'], claude('Stop', 'lock-1'))), {}, 'Claude/Codex: {}');
  assert.deepStrictEqual(json(run(w, ['close', '--via=cursor'], cursor('stop', 'lock-1'))), {}, 'Cursor: {}');
  fs.rmSync(lock, { recursive: true });
  assert.strictEqual(json(run(w, ['close', '--via=claude'], claude('Stop', 'lock-1'))).decision, 'block', 'with the lock gone, close checks again');
  assert.ok(!fs.existsSync(lock), 'close releases its lock');
});

test('Gives up after repeated blocks: systemMessage (Claude/Codex) or {} (Cursor), never a loop', () => {
  const w = workspace();
  run(w, ['boot', '--via=claude'], claude('SessionStart', 'loop-1'));
  run(w, ['boot', '--via=cursor'], cursor('sessionStart', 'loop-2'));
  dirty(w);
  let last;
  for (let i = 0; i < 4; i++) last = json(run(w, ['close', '--via=claude'], claude('Stop', 'loop-1', { stop_hook_active: i > 0 })));
  assert.match(last.systemMessage, /could not be satisfied after 4 attempts/);
  for (let i = 0; i < 4; i++) last = json(run(w, ['close', '--via=cursor'], cursor('stop', 'loop-2', { loop_count: i })));
  assert.deepStrictEqual(last, {});
});

test('Boot refusal reaches the model as a hook (exit 0 with the refusal), and exits 2 in a terminal', () => {
  const w = workspace();
  fs.rmSync(path.join(w.ws, 'harold/blockers.md'));
  const cc = run(w, ['boot', '--via=claude'], claude('SessionStart', 'ref-1'));
  assert.strictEqual(cc.code, 0);
  assert.match(cc.out, /HAROLD BOOT REFUSED/);
  const cu = run(w, ['boot', '--via=cursor'], cursor('sessionStart', 'ref-2'));
  assert.strictEqual(cu.code, 0);
  assert.match(json(cu).additional_context, /HAROLD BOOT REFUSED/);
  const term = run(w, ['boot']);
  assert.strictEqual(term.code, 2);
  assert.match(term.out, /HAROLD BOOT REFUSED/);
});

test('The shipped hook files parse and point every event at bin/harold with the right --via', () => {
  const cc = JSON.parse(fs.readFileSync(path.join(SRC, '.claude/settings.json'), 'utf8')).hooks;
  const cx = JSON.parse(fs.readFileSync(path.join(SRC, '.codex/hooks.json'), 'utf8')).hooks;
  const cu = JSON.parse(fs.readFileSync(path.join(SRC, '.cursor/hooks.json'), 'utf8'));
  assert.strictEqual(cu.version, 1);
  const cmd = (h, ev) => h[ev][0].hooks[0].command;
  for (const [ev, sub] of [['SessionStart', 'boot'], ['Stop', 'close'], ['SessionEnd', 'close --final']]) {
    assert.ok(cmd(cc, ev).includes(`/bin/harold" ${sub} --via=claude`), `claude ${ev}`);
    assert.ok(cmd(cx, ev).includes(`/bin/harold" ${sub} --via=codex`), `codex ${ev}`);
  }
  assert.ok(cmd(cx, 'SessionEnd').endsWith('--detach') && cx.SessionEnd[0].hooks[0].timeout <= 3, 'Codex SessionEnd fits its 3-second limit');
  for (const [ev, sub] of [['sessionStart', 'boot'], ['stop', 'close'], ['sessionEnd', 'close --final']]) assert.ok(cu.hooks[ev][0].command.includes(`/bin/harold" ${sub} --via=cursor`), `cursor ${ev}`);
});

test('The hook commands resolve the workspace from a subfolder, with and without the tool’s project variable', () => {
  const w = workspace();
  const sub = path.join(w.ws, 'vault/people');
  const cmds = [
    JSON.parse(fs.readFileSync(path.join(w.ws, '.claude/settings.json'), 'utf8')).hooks.SessionStart[0].hooks[0].command,
    JSON.parse(fs.readFileSync(path.join(w.ws, '.codex/hooks.json'), 'utf8')).hooks.SessionStart[0].hooks[0].command,
    JSON.parse(fs.readFileSync(path.join(w.ws, '.cursor/hooks.json'), 'utf8')).hooks.sessionStart[0].command,
  ];
  const clean = { ...process.env }; STRIP.forEach(k => delete clean[k]);
  cmds.forEach((c, i) => {
    const r = spawnSync('/bin/sh', ['-c', c], { cwd: sub, encoding: 'utf8', input: JSON.stringify(claude('SessionStart', `sh-${i}`)), env: { ...clean, HOME: w.home, HAROLD_ENV_FILE: path.join(w.home, 'none') } });
    assert.strictEqual(r.status, 0, `${c}\n${r.stderr}`);
    assert.match(r.stdout, /HAROLD BOOTED|additional_context/, c);
  });
});
