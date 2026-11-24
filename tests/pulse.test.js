#!/usr/bin/env node
/*
 * Tests for Project Pulse: `bin/harold pulse` and the PROJECT PULSE section of `bin/harold boot`.
 *
 *   node --test tests/pulse.test.js
 *
 * End to end in a throwaway copy of this repository (its own git repo with a fixed commit date, no remote,
 * HOME pointed at an empty directory), with HAROLD_NOW pinning "today". The procedure itself, and its parity
 * with the connector's harold_pulse, is unit-tested in tests/test_harold_index.py (PulseTest), which
 * tests/index.test.js runs.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { SRC } = require('./fixture'); // this repository, or in a workspace the starter's content with its machinery (tests/fixture.js)
const SKIP = new Set(['.git', 'node_modules', '.next', 'search.db', 'graph.json', '.brief-job.json', '.brief-context.md', '.housekeeping-job.json', '.housekeeping-context.md', '.state', '.last-boot', '__pycache__']);
const dirs = [];
test.after(() => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

const STRIP = ['HAROLD_ROOT', 'HAROLD_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'GITHUB_ACTIONS', 'CLAUDE_CODE_REMOTE', 'HAROLD_NOW', 'HAROLD_DETACHED', 'HAROLD_TODAY', 'HAROLD_STALE_DAYS', 'HAROLD_PULSE_DAYS', 'HAROLD_TZ'];
const COMMITTED = '2026-09-01T12:00:00Z';
function run(w, args, env = {}) {
  const clean = { ...process.env };
  STRIP.forEach(k => delete clean[k]);
  const r = spawnSync(process.execPath, [path.join(w.ws, 'bin/harold'), ...args], {
    cwd: w.ws, encoding: 'utf8', timeout: 120000, input: '',
    env: { ...clean, HOME: w.home, HAROLD_ENV_FILE: w.envFile, HAROLD_SESSION_ID: 'pulse-test', HAROLD_TZ: 'UTC', HAROLD_NOW: '2026-10-20T09:00:00', ...env },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-pulse-'));
  dirs.push(dir);
  const ws = path.join(dir, 'ws'), home = path.join(dir, 'home');
  fs.mkdirSync(home);
  fs.cpSync(SRC, ws, { recursive: true, filter: s => !SKIP.has(path.basename(s)) && !/\/harold\/active-sessions\/[^/]+\.json$/.test(s) && !/\/harold\/briefs\/\d{4}-\d{2}-\d{2}\.md$/.test(s) });
  const g = (a, env = {}) => spawnSync('git', a, { cwd: ws, encoding: 'utf8', env: { ...process.env, ...env } });
  g(['init', '-q']); g(['config', 'user.email', 'test@example.com']); g(['config', 'user.name', 'Test']);
  g(['add', '-A']); g(['commit', '-qm', 'init'], { GIT_AUTHOR_DATE: COMMITTED, GIT_COMMITTER_DATE: COMMITTED });
  const w = { dir, ws, home, envFile: path.join(home, 'env'), git: (...a) => g(a).stdout.trim() };
  return w;
}

const w = workspace();

test('pulse: active is derived; quiet projects on one line, never nagged', () => {
  const r = run(w, ['pulse']);
  assert.strictEqual(r.code, 0, r.err);
  // The example card's own date (2026-09-26) is not activity: only the first commit (2026-09-01) is, 49 days ago.
  assert.match(r.out, /^# Project pulse, 2026-10-20: 0 active, 2 quiet \(active: activity within 14 days\)\n/);
  assert.match(r.out, /\nQuiet \(not nagged; work there makes them active again\): Example Project, Harold \(this system\)\n/);
  assert.doesNotMatch(r.out, /no next step recorded|quiet \d+ days|Send Jane Doe the signed NDA/);
  assert.match(r.out, /A project is active with activity within HAROLD_PULSE_DAYS \(14\) days/);
});

test('pulse --json, and --all lists each quiet project and the archived and autonomous ones', () => {
  const j = JSON.parse(run(w, ['pulse', '--json']).out);
  assert.strictEqual(j.today, '2026-10-20');
  assert.strictEqual(j.pulse_days, 14);
  assert.strictEqual(j.git, 'ok');
  assert.deepStrictEqual([j.active, j.quiet], [0, 2]);
  assert.strictEqual(j.boot, '## Project pulse: 0 active, 2 quiet; active means activity within 14 days (bin/harold pulse)');
  const ex = j.projects.find(p => p.name === 'Example Project');
  assert.deepStrictEqual([ex.status, ex.set_status, ex.quiet, ex.days, ex.last.label, ex.last.date, ex.next_step_source],
    ['quiet', '', true, 49, 'commit', '2026-09-01', 'harold/projects.md']);
  fs.appendFileSync(path.join(w.ws, 'harold/projects.md'), '\n## Old Venture\n- folder: projects/old\n- status: archived\n\n## Watcher\n- folder: projects/watcher\n- status: autonomous (self-maintaining)\n');
  const all = run(w, ['pulse', '--all']);
  assert.match(all.out, /\nQuiet \(not nagged; work there makes them active again\):\n- Example Project — last activity 49 days ago \(commit 2026-09-01, "init"\)\n/);
  assert.match(all.out, /\nNot judged \(archived or autonomous\):\n- Old Venture \[archived\]\n- Watcher \[autonomous\]\n/);
  assert.doesNotMatch(run(w, ['pulse']).out, /Old Venture|Watcher/);
  w.git('checkout', 'harold/projects.md');
});

test('activity: a commit to the project folder, and a daily note that links its card, make it active', () => {
  fs.writeFileSync(path.join(w.ws, 'projects/example/plan.txt'), 'draft\n');
  w.git('add', 'projects/example/plan.txt');
  spawnSync('git', ['commit', '-qm', 'feat: first plan for the example'], { cwd: w.ws, env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-10T12:00:00Z', GIT_COMMITTER_DATE: '2026-10-10T12:00:00Z' } });
  assert.match(run(w, ['pulse']).out, /\nActive:\n- Example Project — last activity 10 days ago \(commit 2026-10-10, "feat: first plan for the example"\); next step: Send Jane Doe the signed NDA\n/);
  fs.writeFileSync(path.join(w.ws, 'vault/daily/2026-10-18-work.md'), '# Work\n\nWent over the sample project with Jane.\n');   // an alias, no link: a daily note that only names it does not count
  assert.match(run(w, ['pulse']).out, /- Example Project — last activity 10 days ago \(commit 2026-10-10/);
  fs.writeFileSync(path.join(w.ws, 'vault/daily/2026-10-18-work.md'), '# Work\n\nWent over [[Example Project]] with Jane.\n');   // links the card: counts
  assert.match(run(w, ['pulse']).out, /- Example Project — last activity 2 days ago \(daily note 2026-10-18, "Work"\)/);
  fs.rmSync(path.join(w.ws, 'vault/daily/2026-10-18-work.md'));
  w.git('reset', '-q', '--hard', 'HEAD~1');
});

test('an open task due soon in the task snapshot makes a quiet project active', () => {
  fs.writeFileSync(path.join(w.ws, 'harold/tasks-snapshot.md'), '# Tasks snapshot\n\n## Due this week (1)\n\n- **H-7** · Draft the plan · Example Project · due 2026-10-23 · medium\n');
  const r = run(w, ['pulse']);
  assert.match(r.out, /^# Project pulse, 2026-10-20: 1 active, 1 quiet/);
  assert.match(r.out, /\nActive:\n- Example Project — upcoming: task due in 3 days \(2026-10-23, "Draft the plan"\); next step: Send Jane Doe the signed NDA\n/);
  fs.rmSync(path.join(w.ws, 'harold/tasks-snapshot.md'));
});

test('boot and check print the counts only, never the quiet projects; terminal ones show their status; HAROLD_PULSE_DAYS comes from ~/.harold/env', () => {
  fs.appendFileSync(path.join(w.ws, 'harold/projects.md'), '\n## Old Venture\n- folder: projects/old\n- status: archived\n');
  const b = run(w, ['boot', '--full']);
  assert.strictEqual(b.code, 0, b.err);
  assert.match(b.out, /\n## Project pulse: 0 active, 2 quiet; active means activity within 14 days \(bin\/harold pulse\)\n\n/);
  const section = b.out.slice(b.out.indexOf('\n## Project pulse'), b.out.indexOf('\n## Active blockers'));
  assert.doesNotMatch(section, /Example Project|Harold \(this system\)|quiet \d+ days|next step/);
  assert.match(b.out, /\n## Project map — 3 entries, 0 active, 2 quiet .*\nQuiet: Example Project, Harold \(this system\)\nNot active: Old Venture \[archived\]\n/);
  assert.match(run(w, ['check']).out, /\nprojects: 3 in map \(0 active, 2 quiet\)\n/);
  w.git('checkout', 'harold/projects.md');
  fs.writeFileSync(w.envFile, 'HAROLD_PULSE_DAYS=60\n');
  const b2 = run(w, ['boot', '--full'], { HAROLD_SESSION_ID: 'pulse-test-2' });
  assert.match(b2.out, /\n## Project pulse: 2 active, 0 quiet; active means activity within 60 days \(bin\/harold pulse\)\n/);
  assert.match(b2.out, /\n- Example Project → projects\/example \(example, the example\)\n/);
  assert.match(run(w, ['pulse']).out, /: 2 active, 0 quiet \(active: activity within 60 days\)/);
  fs.rmSync(w.envFile);
});

test('where shows a status only when it is archived or autonomous', () => {
  assert.match(run(w, ['where', 'example']).out, /^Example Project\nfolder: /);
  fs.appendFileSync(path.join(w.ws, 'harold/projects.md'), '\n## Old Venture\n- folder: projects/old\n- status: archived\n- aliases: old venture\n');
  assert.match(run(w, ['where', 'old venture']).out, /^Old Venture \[archived\]\n/);
  w.git('checkout', 'harold/projects.md');
});

test('when pulse fails, boot falls back to the hand-set status and says why', () => {
  const hi = path.join(w.ws, 'bin/harold-index');
  fs.renameSync(hi, hi + '.real');
  fs.writeFileSync(hi, "import os, runpy, sys\nif sys.argv[1:2] == ['pulse']: sys.stderr.write('pulse broke here\\n'); sys.exit(1)\nsys.argv[0] = os.path.abspath(__file__) + '.real'\nrunpy.run_path(sys.argv[0], run_name='__main__')\n");
  try {
    const b = run(w, ['boot', '--full'], { HAROLD_SESSION_ID: 'pulse-test-3' });
    assert.strictEqual(b.code, 0, b.err);
    assert.match(b.out, /\n## Project map — 2 entries, 0 active \(active is derived.*\nderived status unavailable: pulse broke here \(showing the hand-set status: active instead\)\nNot active: Example Project \[no status\], Harold \(this system\) \[no status\]\n/);
    assert.match(b.out, /\n## Project pulse: unavailable \(pulse broke here\)\n/);
  } finally { fs.rmSync(hi); fs.renameSync(hi + '.real', hi); }
});

test('file heartbeat: appends to the project folder, and the pulse judges the project by it', () => {
  const x = workspace();
  const bad = run(x, ['file', 'heartbeat', JSON.stringify({ project: 'No Such Project', done: 'x' })]);
  assert.strictEqual(bad.code, 2);
  assert.match(bad.err, /no project "No Such Project" in harold\/projects\.md/);
  assert.strictEqual(run(x, ['file', 'heartbeat', JSON.stringify({ project: 'example' })]).code, 2, '"done" is required');
  const r = run(x, ['file', 'heartbeat', JSON.stringify({ project: 'the example', done: 'Signed the NDA with Jane Doe', running: 'Drafting the plan', waiting: 'Budget sign-off by 2026-10-31', detail: 'projects/example/plan.md' })]);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /heartbeat for Example Project → projects\/example\/heartbeats\.jsonl/);
  const row = JSON.parse(fs.readFileSync(path.join(x.ws, 'projects/example/heartbeats.jsonl'), 'utf8').trim().split('\n').pop());
  assert.deepStrictEqual({ date: row.date, project: row.project, done: row.done, waiting: row.waiting }, { date: '2026-10-20', project: 'Example Project', done: 'Signed the NDA with Jane Doe', waiting: 'Budget sign-off by 2026-10-31' });
  const p = run(x, ['pulse', '--json']);
  const ex = JSON.parse(p.out).projects.find(q => q.name === 'Example Project');
  assert.ok(ex, p.out);
  assert.strictEqual(JSON.stringify(ex).includes('Signed the NDA with Jane Doe'), true, JSON.stringify(ex));
  assert.strictEqual(ex.quiet, false, JSON.stringify(ex));
});
