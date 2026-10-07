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

const SRC = path.resolve(__dirname, '..');
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

test('pulse: quiet projects first, with what the last activity was, its date and the next step', () => {
  const r = run(w, ['pulse']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /^# Project pulse, 2026-10-20: 2 of 2 active projects quiet \(no activity in more than 14 days\)/);
  // The example card (last_updated 2026-09-26) is its newest activity: 24 days.
  assert.match(r.out, /\nQuiet:\n(- .*\n)*- Example Project — quiet 24 days \(last: project card 2026-09-26\); next step: Send Jane Doe the signed NDA\n/);
  assert.match(r.out, /- Harold \(this system\) — quiet \d+ days \(last: .*\); next step: no next step recorded/);
  assert.match(r.out, /Quiet after HAROLD_PULSE_DAYS \(14\) days without any/);
});

test('pulse --json, and --all lists the projects that are not judged', () => {
  const j = JSON.parse(run(w, ['pulse', '--json']).out);
  assert.strictEqual(j.today, '2026-10-20');
  assert.strictEqual(j.pulse_days, 14);
  assert.strictEqual(j.git, 'ok');
  const ex = j.projects.find(p => p.name === 'Example Project');
  assert.deepStrictEqual([ex.quiet, ex.days, ex.last.label, ex.last.date, ex.next_step_source], [true, 24, 'project card', '2026-09-26', 'harold/projects.md']);
  fs.appendFileSync(path.join(w.ws, 'harold/projects.md'), '\n## Old Venture\n- folder: projects/old\n- status: archived\n');
  const all = run(w, ['pulse', '--all']);
  assert.match(all.out, /\nNot judged \(not active\):\n- Old Venture \[archived\]/);
  assert.doesNotMatch(run(w, ['pulse']).out, /Old Venture/);
  w.git('checkout', 'harold/projects.md');
});

test('activity: a commit to the project folder, and a daily note that names the project', () => {
  fs.writeFileSync(path.join(w.ws, 'projects/example/plan.txt'), 'draft\n');
  w.git('add', 'projects/example/plan.txt');
  spawnSync('git', ['commit', '-qm', 'feat: first plan for the example'], { cwd: w.ws, env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-10T12:00:00Z', GIT_COMMITTER_DATE: '2026-10-10T12:00:00Z' } });
  assert.match(run(w, ['pulse']).out, /- Example Project — active 10 days ago \(last: commit 2026-10-10, "feat: first plan for the example"\)/);
  fs.writeFileSync(path.join(w.ws, 'vault/daily/2026-10-18-work.md'), '# Work\n\nWent over the sample project with Jane.\n');   // an alias, no link
  assert.match(run(w, ['pulse']).out, /- Example Project — active 2 days ago \(last: daily note 2026-10-18, "Work"\)/);
  fs.rmSync(path.join(w.ws, 'vault/daily/2026-10-18-work.md'));
  w.git('reset', '-q', '--hard', 'HEAD~1');
});

test('boot prints only the quiet projects, or one line; HAROLD_PULSE_DAYS comes from ~/.harold/env', () => {
  const b = run(w, ['boot']);
  assert.strictEqual(b.code, 0, b.err);
  assert.match(b.out, /\n## Project pulse: 2 of 2 active projects quiet, no activity in more than 14 days \(bin\/harold pulse for all\)\n- /);
  assert.match(b.out, /- Example Project — quiet 24 days \(last: project card 2026-09-26\); next step: Send Jane Doe the signed NDA/);
  fs.writeFileSync(w.envFile, 'HAROLD_PULSE_DAYS=60\n');
  const b2 = run(w, ['boot', '--full'], { HAROLD_SESSION_ID: 'pulse-test-2' });
  assert.match(b2.out, /\n## Project pulse: all 2 active projects active within 60 days \(bin\/harold pulse\)\n/);
  assert.match(run(w, ['pulse']).out, /0 of 2 active projects quiet \(no activity in more than 60 days\)/);
  fs.rmSync(w.envFile);
});
