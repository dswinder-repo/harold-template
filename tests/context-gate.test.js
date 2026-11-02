#!/usr/bin/env node
/*
 * The context gate (2026-11-02). A harness shows hook output to the model only up to a size limit: Claude Code
 * saves anything over about 10 KB to a file and shows a 2 KB preview, so an 80 KB boot reached the model as its
 * first lines and whole sessions ran without the critical learnings or the always-on monitors. Over
 * HAROLD_HOOK_BUDGET, boot hands the model a digest and writes the full context as parts; `harold context` prints
 * them; `harold gate` (PreToolUse) blocks other tools until every part is read; close blocks the turn meanwhile.
 * Close also blocks new work that belongs to no project: a new vault/intel or vault/decisions note without a
 * resolvable `project:`, and a new top-level folder with no entry in harold/projects.md.
 *
 *   node --test tests/context-gate.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { SRC } = require('./fixture');
const SKIP = new Set(['.git', 'node_modules', '.next', 'search.db', '.brief-job.json', '.brief-context.md', '.housekeeping-job.json', '.housekeeping-context.md', '.state', '.last-boot']);
const dirs = [];
test.after(() => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

const STRIP = ['HAROLD_ROOT', 'HAROLD_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'GITHUB_ACTIONS', 'CLAUDE_CODE_REMOTE', 'HAROLD_NOW', 'HAROLD_DETACHED', 'CURSOR_PROJECT_DIR', 'CURSOR_VERSION', 'HAROLD_HOOK_BUDGET', 'HAROLD_CONTEXT_PART'];
const SMALL = { HAROLD_HOOK_BUDGET: '1500', HAROLD_CONTEXT_PART: '3000' };   // forces the split on the starter's content
const LARGE = { HAROLD_HOOK_BUDGET: '100000000' };
function run(w, args, input, env = {}) {
  const clean = { ...process.env };
  STRIP.forEach(k => delete clean[k]);
  const r = spawnSync(process.execPath, [path.join(w.ws, 'bin/harold'), ...args], {
    cwd: w.ws, encoding: 'utf8', timeout: 120000, input: input === undefined ? '' : (typeof input === 'string' ? input : JSON.stringify(input)),
    env: { ...clean, HOME: w.home, HAROLD_ENV_FILE: path.join(w.home, 'none'), ...env },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-gate-'));
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
const json = r => { try { return JSON.parse(r.out); } catch (e) { throw new Error(`not JSON (exit ${r.code}): ${r.out.slice(0, 300)} ${r.err.slice(0, 300)}`); } };
const claude = (event, id, extra = {}) => ({ session_id: id, transcript_path: '/tmp/t.jsonl', cwd: '/tmp', hook_event_name: event, permission_mode: 'default', ...extra });
const bash = (id, command) => claude('PreToolUse', id, { tool_name: 'Bash', tool_input: { command } });
const edit = (id, file_path) => claude('PreToolUse', id, { tool_name: 'Edit', tool_input: { file_path, old_string: 'a', new_string: 'b' } });
function daily(w) { fs.writeFileSync(path.join(w.ws, `vault/daily/${w.today}-gate-test.md`), `# ${w.today} gate test\n\nWhat changed: a test.\n`); }
function partsOf(w) { const d = path.join(w.ws, 'harold/active-sessions/.state'); return fs.existsSync(d) ? fs.readdirSync(d).filter(f => /\.context-\d+\.md$/.test(f)) : []; }
function readAll(w, id, n) { const out = []; for (let k = 0; k < n; k++) out.push(run(w, ['context'], undefined, { HAROLD_SESSION_ID: id })); return out; }

test('over the hook budget, boot prints a digest and writes the full context as parts; under it, the whole context', () => {
  const w = workspace();
  const b = run(w, ['boot', '--via=claude'], claude('SessionStart', 'g-1', { source: 'startup' }), SMALL);
  assert.strictEqual(b.code, 0, b.err);
  assert.match(b.out, /^# HAROLD BOOTED/);
  assert.match(b.out, /⛔ CONTEXT GATE: .* split into (\d+) part\(s\)/);
  assert.match(b.out, /ALWAYS-ON MONITORS/, 'the monitors travel inline, never only in a part');
  assert.match(b.out, /## Exit condition/, 'so does the exit condition');
  assert.doesNotMatch(b.out, /## Playbooks/, 'the long sections are left to the parts');
  assert.match(b.out, /Then read memory\/(working-memory|CLAUDE)\.md/, 'names the working-memory file this workspace has');
  const n = Number(b.out.match(/split into (\d+) part/)[1]);
  assert.ok(n >= 2, `expected several parts, got ${n}`);
  assert.strictEqual(partsOf(w).length, n);

  const w2 = workspace();
  const full = run(w2, ['boot', '--via=claude'], claude('SessionStart', 'g-2', { source: 'startup' }), LARGE);
  assert.doesNotMatch(full.out, /CONTEXT GATE/);
  assert.match(full.out, /## Playbooks/);
  assert.strictEqual(partsOf(w2).length, 0);
  assert.strictEqual(run(w2, ['gate', '--via=claude'], bash('g-2', 'ls'), LARGE).code, 0, 'nothing to read: the gate is open');
  assert.match(run(w2, ['context'], undefined, { HAROLD_SESSION_ID: 'g-2' }).out, /nothing to read/);
});

test('context prints each part once in order, and together the parts are the whole boot', () => {
  const w = workspace();
  const b = run(w, ['boot', '--via=claude'], claude('SessionStart', 'g-3', { source: 'startup' }), SMALL);
  const n = Number(b.out.match(/split into (\d+) part/)[1]);
  const reads = readAll(w, 'g-3', n);
  reads.forEach((r, i) => {
    assert.strictEqual(r.code, 0, r.err);
    assert.match(r.out, new RegExp(`part ${i + 1} of ${n} =====`));
  });
  assert.match(reads[n - 2].out, new RegExp(`Still unread: ${n}\\.`));
  assert.match(reads[n - 1].out, /All parts read: the gate is open/);
  const body = reads.map(r => r.out.replace(/^===== Harold boot context, part \d+ of \d+ =====\n/, '').replace(/\n===== end of part [\s\S]*$/, '')).join('\n');
  assert.match(body, /^# HAROLD BOOTED/);
  assert.match(body, /## Playbooks/);
  assert.match(body, /## Exit condition/);
  // A part can be read again by number; a part that does not exist is an error.
  assert.match(run(w, ['context', '1'], undefined, { HAROLD_SESSION_ID: 'g-3' }).out, /part 1 of/);
  assert.strictEqual(run(w, ['context', String(n + 1)], undefined, { HAROLD_SESSION_ID: 'g-3' }).code, 2);
});

test('gate: blocks other tools while parts are unread, lets bin/harold and the session file through, then opens', () => {
  const w = workspace();
  const b = run(w, ['boot', '--via=claude'], claude('SessionStart', 'g-4', { source: 'startup' }), SMALL);
  const n = Number(b.out.match(/split into (\d+) part/)[1]);
  const gate = input => run(w, ['gate', '--via=claude'], input, SMALL);

  const blocked = gate(bash('g-4', 'ls -la'));
  assert.strictEqual(blocked.code, 2, 'exit 2 blocks the tool in Claude Code');
  assert.match(blocked.err, /Harold context gate: \d+ of \d+ boot context part\(s\) unread/);
  assert.match(blocked.err, /bin\/harold context/);
  assert.strictEqual(gate(edit('g-4', path.join(w.ws, 'harold/facts.md'))).code, 2);
  assert.strictEqual(gate(claude('PreToolUse', 'g-4', { tool_name: 'WebSearch', tool_input: { query: 'x' } })).code, 2);

  for (const cmd of ['bin/harold context', `"${w.ws}/bin/harold" context 2`, `cd ${w.ws} && bin/harold file learning '{}'`, `${w.ws}/bin/harold search "x"`, 'harold context']) {
    assert.strictEqual(gate(bash('g-4', cmd)).code, 0, `allowed: ${cmd}`);
  }
  assert.strictEqual(gate(bash('g-4', 'cat bin/harold-linear')).code, 2, 'another bin/harold-* script is not harold');
  assert.strictEqual(gate(edit('g-4', path.join(w.ws, 'harold/active-sessions/my-session.json'))).code, 0, 'the session file update AGENTS.md asks for first');

  readAll(w, 'g-4', n);
  assert.strictEqual(gate(bash('g-4', 'ls -la')).code, 0, 'all parts read: open');
});

test('gate fails open: no input, garbage, another session, a terminal', () => {
  const w = workspace();
  run(w, ['boot', '--via=claude'], claude('SessionStart', 'g-5', { source: 'startup' }), SMALL);
  assert.strictEqual(run(w, ['gate', '--via=claude'], bash('g-5', 'ls'), SMALL).code, 2, 'precondition: g-5 is gated');
  assert.strictEqual(run(w, ['gate', '--via=claude'], '', SMALL).code, 0, 'no input');
  assert.strictEqual(run(w, ['gate', '--via=claude'], '{not json', SMALL).code, 0, 'garbage');
  assert.strictEqual(run(w, ['gate', '--via=claude'], '[1,2]', SMALL).code, 0, 'not an object');
  assert.strictEqual(run(w, ['gate', '--via=claude'], bash('someone-else', 'ls'), SMALL).code, 0, 'a session that never booted here is never gated by another');
  fs.writeFileSync(path.join(w.ws, 'harold/active-sessions/.state/g-5.json'), '{broken');
  assert.strictEqual(run(w, ['gate', '--via=claude'], bash('g-5', 'ls'), SMALL).code, 0, 'unreadable state');
});

test('close blocks while boot context is unread, and passes once every part has been read', () => {
  const w = workspace();
  const b = run(w, ['boot', '--via=claude'], claude('SessionStart', 'g-6', { source: 'startup' }), SMALL);
  const n = Number(b.out.match(/split into (\d+) part/)[1]);
  daily(w);
  const blocked = json(run(w, ['close', '--via=claude'], claude('Stop', 'g-6', { stop_hook_active: false }), SMALL));
  assert.strictEqual(blocked.decision, 'block');
  assert.match(blocked.reason, /boot context is unread/);
  readAll(w, 'g-6', n);
  assert.deepStrictEqual(json(run(w, ['close', '--via=claude'], claude('Stop', 'g-6', { stop_hook_active: true }), SMALL)), {});
});

test('an agent-run boot that adopts a hook session (Grok Build) is split too, and that session\'s close waits for it', () => {
  const w = workspace();
  const grok = (event, extra = {}) => ({ hookEventName: event, sessionId: 'gk-1', workspaceRoot: w.ws, ...extra });
  run(w, ['boot', '--via=grok'], grok('SessionStart'), SMALL);
  const own = run(w, ['boot'], undefined, SMALL);  // the agent runs it itself, as AGENTS.md says
  assert.strictEqual(own.code, 0, own.err);
  assert.match(own.out, /CONTEXT GATE: .* split into (\d+) part/);
  const n = Number(own.out.match(/split into (\d+) part/)[1]);
  daily(w);
  const blocked = json(run(w, ['close', '--via=grok'], grok('Stop', { stopHookActive: false }), SMALL));
  assert.strictEqual(blocked.decision, 'block');
  assert.match(blocked.reason, /boot context is unread/);
  for (let k = 0; k < n; k++) run(w, ['context'], undefined, SMALL);  // no session id in the agent's shell
  const ok = run(w, ['close', '--via=grok'], grok('Stop', { stopHookActive: true }), SMALL);
  assert.doesNotMatch(ok.out, /boot context is unread/);
});

test('a terminal boot is never split: a person reads it whole', () => {
  const w = workspace();
  const t = run(w, ['boot'], undefined, SMALL);
  assert.strictEqual(t.code, 0, t.err);
  assert.doesNotMatch(t.out, /CONTEXT GATE/);
  assert.match(t.out, /## Playbooks/);
});

// ── new work must belong to a project ──
function bootFiled(w, id) {
  run(w, ['boot', '--via=claude'], claude('SessionStart', id, { source: 'startup' }), LARGE);
  daily(w);
}
const closeAs = (w, id, active = false) => run(w, ['close', '--via=claude'], claude('Stop', id, { stop_hook_active: active }), LARGE);
const note = (fm, title = 'Test synthesis') => `---\n${fm}type: intel\n---\n# ${title}\n\nBody.\n`;

test('close blocks a new intel or decision note with no project, or one that does not resolve; global and map names pass', () => {
  const w = workspace();
  bootFiled(w, 'p-1');
  fs.mkdirSync(path.join(w.ws, 'vault/intel'), { recursive: true });
  fs.mkdirSync(path.join(w.ws, 'vault/decisions'), { recursive: true });
  fs.writeFileSync(path.join(w.ws, 'vault/intel/2026-11-02-orphan.md'), note(''));
  fs.writeFileSync(path.join(w.ws, 'vault/decisions/D-99-unmapped.md'), note('project: no such venture\n'));
  const blocked = json(closeAs(w, 'p-1'));
  assert.strictEqual(blocked.decision, 'block');
  assert.match(blocked.reason, /new note\(s\) not tied to a project: .*vault\/intel\/2026-11-02-orphan\.md/);
  assert.match(blocked.reason, /vault\/decisions\/D-99-unmapped\.md/);
  assert.match(blocked.reason, /project-intake\.md/);

  // The name, an alias, the folder, or global; a wiki-link and a list both work.
  fs.writeFileSync(path.join(w.ws, 'vault/intel/2026-11-02-orphan.md'), note('project: [[Example Project]]\n'));
  fs.writeFileSync(path.join(w.ws, 'vault/decisions/D-99-unmapped.md'), note('project: global\n'));
  fs.writeFileSync(path.join(w.ws, 'vault/intel/2026-11-02-alias.md'), note('project: the example, projects/example\n'));
  const ok = closeAs(w, 'p-1', true);
  assert.doesNotMatch(ok.out, /not tied to a project/, ok.out);
});

test('an intel note that already existed before the session is never asked for a project', () => {
  const w = workspace();
  fs.mkdirSync(path.join(w.ws, 'vault/intel'), { recursive: true });
  fs.writeFileSync(path.join(w.ws, 'vault/intel/old-note.md'), note(''));
  spawnSync('git', ['add', '-A'], { cwd: w.ws }); spawnSync('git', ['commit', '-qm', 'old note'], { cwd: w.ws });
  bootFiled(w, 'p-2');
  fs.appendFileSync(path.join(w.ws, 'vault/intel/old-note.md'), '\nAn update.\n');
  const r = closeAs(w, 'p-2');
  assert.doesNotMatch(r.out, /not tied to a project/, r.out);
});

test('close blocks a new top-level folder with no project in the map; a mapped folder passes', () => {
  const w = workspace();
  bootFiled(w, 'p-3');
  fs.mkdirSync(path.join(w.ws, 'new-venture'), { recursive: true });
  fs.writeFileSync(path.join(w.ws, 'new-venture/README.md'), '# New venture\n');
  const blocked = json(closeAs(w, 'p-3'));
  assert.strictEqual(blocked.decision, 'block');
  assert.match(blocked.reason, /new top-level folder\(s\) with no project in harold\/projects\.md: new-venture/);

  fs.appendFileSync(path.join(w.ws, 'harold/projects.md'), '\n## New Venture\n- folder: new-venture\n- status: active\n- type: venture\n- aliases: new venture\n');
  const ok = closeAs(w, 'p-3', true);
  assert.doesNotMatch(ok.out, /top-level folder/, ok.out);
});

// ── every harness with a documented pre-tool block (exit 2, reason on stderr) runs the gate ──
test('the shipped hook files run the gate before tools, with the right --via', () => {
  const rd = p => JSON.parse(fs.readFileSync(path.join(SRC, p), 'utf8'));
  const has = (cmd, via) => assert.ok(String(cmd).includes(`/bin/harold" gate --via=${via}`), `${via}: ${cmd}`);
  has(rd('.claude/settings.json').hooks.PreToolUse[0].hooks[0].command, 'claude');
  has(rd('.codex/hooks.json').hooks.PreToolUse[0].hooks[0].command, 'codex');
  has(rd('.gemini/settings.json').hooks.BeforeTool[0].hooks[0].command, 'gemini');
  has(rd('.qwen/settings.json').hooks.PreToolUse[0].hooks[0].command, 'qwen');
  has(rd('.cursor/hooks.json').hooks.preToolUse[0].command, 'cursor');
  has(rd('.github/copilot/settings.json').hooks.preToolUse[0].bash, 'copilot');
  has(rd('.grok/hooks/harold.json').hooks.PreToolUse[0].hooks[0].command, 'grok');
  assert.match(fs.readFileSync(path.join(SRC, 'tools/harness-hooks/kimi-config.toml'), 'utf8'), /event = "PreToolUse"\ncommand = '.*bin\/harold" gate --via=kimi'/);
  assert.match(fs.readFileSync(path.join(SRC, 'tools/harness-hooks/hermes-config.yaml'), 'utf8'), /pre_tool_call:[\s\S]*?bin\/harold" gate --via=hermes/);
});

test('each harness\'s pre-tool input shape is read: blocked while unread (exit 2), bin/harold allowed', () => {
  const w = workspace();
  const id = 'hx-1';
  run(w, ['boot', '--via=claude'], claude('SessionStart', id, { source: 'startup' }), SMALL);
  const shapes = {
    codex: c => ({ session_id: id, hook_event_name: 'PreToolUse', turn_id: 't', tool_name: 'Bash', tool_input: { command: c } }),
    gemini: c => ({ session_id: id, hook_event_name: 'BeforeTool', tool_name: 'run_shell_command', tool_input: { command: c } }),
    qwen: c => ({ session_id: id, hook_event_name: 'PreToolUse', tool_name: 'run_shell_command', tool_input: { command: c } }),
    cursor: c => ({ conversation_id: id, hook_event_name: 'preToolUse', cursor_version: '2.1.0', workspace_roots: [w.ws], tool_name: 'Shell', tool_input: { command: c } }),
    copilot: c => ({ sessionId: id, timestamp: new Date().toISOString(), toolName: 'bash', toolArgs: JSON.stringify({ command: c }) }),
    grok: c => ({ hookEventName: 'PreToolUse', sessionId: id, workspaceRoot: w.ws, toolName: 'run_terminal_command', toolInput: { command: c } }),
    kimi: c => ({ session_id: id, hook_event_name: 'PreToolUse', tool_name: 'Shell', tool_input: { command: c } }),
    hermes: c => ({ session_id: id, hook_event_name: 'pre_tool_call', tool_name: 'terminal', tool_input: { command: c } }),
  };
  for (const [via, shape] of Object.entries(shapes)) {
    const no = run(w, ['gate', `--via=${via}`], shape('ls'), SMALL);
    assert.strictEqual(no.code, 2, `${via} blocks: ${no.out} ${no.err}`);
    assert.match(no.err, /Harold context gate/, via);
    assert.strictEqual(no.out, '', `${via}: nothing on stdout (Hermes reads a block message there first)`);
    assert.strictEqual(run(w, ['gate', `--via=${via}`], shape(`"${w.ws}/bin/harold" context`), SMALL).code, 0, `${via} allows bin/harold`);
  }
});

// ── learnings orient, they do not accumulate into boot ──
test('boot lists critical learnings one line each within a budget; harold learnings prints them in full; check warns past 15', () => {
  const w = workspace();
  const ledger = path.join(w.ws, 'harold/learnings.jsonl');
  const long = 'x'.repeat(600);
  const rows = Array.from({ length: 40 }, (_, i) => JSON.stringify({ id: `L${900 + i}`, date: '2026-11-02', severity: 'critical', project: i % 2 ? 'global' : 'acme', category: 'process', lesson: `Rule ${i} ${long}` }));
  rows.push(JSON.stringify({ id: 'L999', date: '2026-11-02', severity: 'warning', project: 'acme', category: 'process', lesson: 'Acme-only lesson' }));
  fs.appendFileSync(ledger, '\n' + rows.join('\n') + '\n');
  const b = run(w, ['boot'], undefined, { HAROLD_LEARNINGS_BUDGET: '2000' });
  const sec = b.out.split('## Critical learnings')[1].split('\n## ')[0];
  assert.ok(sec.length < 2600, `bounded: ${sec.length}`);
  assert.match(sec, /- \.\.\. \d+ more: .*bin\/harold learnings/);
  assert.ok(sec.split('\n').filter(l => /^- L9/.test(l)).every(l => l.length < 280), 'one line each');
  const all = run(w, ['learnings']);
  assert.match(all.out, new RegExp(`L939 \\[critical global/process\\][\\s\\S]*Rule 39 ${long}`), 'in full on demand');
  assert.doesNotMatch(all.out, /L999/, 'default: critical only');
  const acme = run(w, ['learnings', '--project', 'acme']);
  assert.match(acme.out, /L999/); assert.match(acme.out, /L901 \[critical global/, 'global entries come along');
  const chk = JSON.parse(run(w, ['check', '--json']).out);
  assert.ok(chk.warnings.some(m => /critical learnings \(more than 15\)/.test(m)), chk.warnings.join('\n'));
});
