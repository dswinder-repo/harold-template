#!/usr/bin/env node
/*
 * Tests for heartbeat rollover: `bin/harold heartbeats roll` and the roll inside `bin/harold close`.
 * Status is the latest heartbeat, so a project's live heartbeats.jsonl keeps the last 14 days and never fewer than
 * 10 entries (and stays under 40,000 bytes); older entries move, unchanged and in order, to
 * <folder>/heartbeats/YYYY-MM.jsonl. Nothing is deleted.
 *
 *   node --test tests/heartbeats.test.js
 *
 * Each workspace is a throwaway copy of this repository (its own git repo, no remote), HOME pointed at an empty
 * directory, HAROLD_NOW pinning "today" to 2026-11-19.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { SRC } = require('./fixture');
const SKIP = new Set(['.git', 'node_modules', '.next', 'search.db', 'graph.json', '.brief-job.json', '.brief-context.md', '.housekeeping-job.json', '.housekeeping-context.md', '.state', '.last-boot', '__pycache__']);
const dirs = [];
test.after(() => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

const STRIP = ['HAROLD_ROOT', 'HAROLD_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'GITHUB_ACTIONS', 'CLAUDE_CODE_REMOTE', 'HAROLD_NOW', 'HAROLD_DETACHED', 'HAROLD_TODAY', 'HAROLD_TZ',
  'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];
function run(w, args, env = {}) {
  const clean = { ...process.env };
  STRIP.forEach(k => delete clean[k]);
  const r = spawnSync(process.execPath, [path.join(w.ws, 'bin/harold'), ...args], {
    cwd: w.ws, encoding: 'utf8', timeout: 120000, input: '',
    env: { ...clean, HOME: w.home, HAROLD_ENV_FILE: path.join(w.home, 'none'), HAROLD_SESSION_ID: 'hb-test', HAROLD_TZ: 'UTC', HAROLD_NOW: '2026-11-19T12:00:00', ...env },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-hb-'));
  dirs.push(dir);
  const ws = path.join(dir, 'ws'), home = path.join(dir, 'home');
  fs.mkdirSync(home);
  fs.cpSync(SRC, ws, { recursive: true, filter: s => !SKIP.has(path.basename(s)) && !/\/harold\/active-sessions\/[^/]+\.json$/.test(s) && !/\/harold\/briefs\/\d{4}-\d{2}-\d{2}\.md$/.test(s) && !/heartbeats(\.jsonl|\/)/.test(s) });
  const g = (...a) => spawnSync('git', a, { cwd: ws, encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'test@example.com'); g('config', 'user.name', 'Test');
  g('add', '-A'); g('commit', '-qm', 'init');
  const w = { dir, ws, home, g };
  const folder = (run(w, ['where', 'Harold (this system)']).out.match(/^folder: (.+)$/m) || [])[1];
  assert.ok(folder, 'the fixture maps Harold (this system) to a folder');
  w.live = path.join(folder, 'heartbeats.jsonl');
  w.archive = m => path.join(folder, 'heartbeats', `${m}.jsonl`);
  return w;
}
const hb = (date, n, extra = '') => JSON.stringify({ date, time: '10:00', project: 'Harold (this system)', done: `entry ${n}${extra}` });
const lines = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
const day = (base, i) => { const d = new Date(`${base}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); };

test('entries older than 14 days move to monthly files, in order; the newest 10 and the last 14 days stay', () => {
  const w = workspace();
  const old = Array.from({ length: 20 }, (_, i) => hb(day('2026-09-25', i * 2), i));     // 2026-09-25 .. 2026-11-02
  const recent = Array.from({ length: 5 }, (_, i) => hb(day('2026-11-15', i), 20 + i));  // 2026-11-15 .. 2026-11-19
  fs.writeFileSync(w.live, [...old, 'not json, kept', ...recent].join('\n') + '\n');
  const r = run(w, ['heartbeats', 'roll']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /moved 15 to .*heartbeats\/\{2026-09,2026-10\}\.jsonl, 11 kept/);
  // The newest 10 dated entries stay even though five of them are older than 14 days; the odd line is never moved.
  assert.deepStrictEqual(lines(w.live), [...old.slice(15), 'not json, kept', ...recent]);
  const moved = [...lines(w.archive('2026-09')), ...lines(w.archive('2026-10'))];
  assert.deepStrictEqual(moved, old.slice(0, 15));
  assert.ok(lines(w.archive('2026-09')).every(l => JSON.parse(l).date.startsWith('2026-09')));
  // Nothing is lost and a second run has nothing to do.
  const again = run(w, ['heartbeats', 'roll']);
  assert.match(again.out, /nothing to roll/);
  assert.deepStrictEqual([...lines(w.archive('2026-09')), ...lines(w.archive('2026-10'))], old.slice(0, 15));
});

test('an interrupted roll repeats safely: lines already in the archive are not written twice', () => {
  const w = workspace();
  const old = Array.from({ length: 12 }, (_, i) => hb(day('2026-10-01', i), i));
  const recent = Array.from({ length: 10 }, (_, i) => hb(day('2026-11-10', i), 12 + i));
  fs.writeFileSync(w.live, [...old, ...recent].join('\n') + '\n');
  fs.mkdirSync(path.dirname(w.archive('2026-10')), { recursive: true });
  fs.writeFileSync(w.archive('2026-10'), old.slice(0, 5).join('\n') + '\n'); // the archive was written, the live file was not
  assert.strictEqual(run(w, ['heartbeats', 'roll']).code, 0);
  assert.deepStrictEqual(lines(w.archive('2026-10')), old);
  assert.deepStrictEqual(lines(w.live), recent);
});

test('a live file over 40,000 bytes sheds its oldest entries even inside 14 days, never below 10', () => {
  const w = workspace();
  const pad = ' ' + 'x'.repeat(1900);
  const all = Array.from({ length: 30 }, (_, i) => hb(day('2026-11-10', Math.floor(i / 4)), i, pad)); // all within 14 days, ~58 KB
  fs.writeFileSync(w.live, all.join('\n') + '\n');
  assert.strictEqual(run(w, ['heartbeats', 'roll']).code, 0);
  const kept = lines(w.live);
  assert.ok(fs.statSync(w.live).size <= 40000, `live file is ${fs.statSync(w.live).size} bytes`);
  assert.ok(kept.length >= 10);
  assert.deepStrictEqual(kept, all.slice(all.length - kept.length));
  assert.deepStrictEqual(lines(w.archive('2026-11')), all.slice(0, all.length - kept.length));
});

test('ten or fewer entries are never rolled, however old', () => {
  const w = workspace();
  const all = Array.from({ length: 10 }, (_, i) => hb(day('2026-01-01', i), i));
  fs.writeFileSync(w.live, all.join('\n') + '\n');
  assert.match(run(w, ['heartbeats', 'roll']).out, /nothing to roll/);
  assert.deepStrictEqual(lines(w.live), all);
  assert.ok(!fs.existsSync(path.dirname(w.archive('2026-01'))));
});

test('--dry-run reports and writes nothing', () => {
  const w = workspace();
  const all = Array.from({ length: 15 }, (_, i) => hb(day('2026-10-01', i), i));
  fs.writeFileSync(w.live, all.join('\n') + '\n');
  assert.match(run(w, ['heartbeats', 'roll', '--dry-run']).out, /would move 5/);
  assert.deepStrictEqual(lines(w.live), all);
});

test('close rolls the heartbeats and commits them, without asking for a daily note for it', () => {
  const w = workspace();
  const all = Array.from({ length: 15 }, (_, i) => hb(day('2026-10-01', i), i));
  fs.writeFileSync(w.live, all.join('\n') + '\n');
  w.g('add', '-A'); w.g('commit', '-qm', 'heartbeats');
  const chk = JSON.parse(run(w, ['check', '--json']).out);
  for (const d of [...chk.triggers.due, ...chk.triggers.overdue]) run(w, ['file', 'trigger', d.id, 'ran', 'test']);
  w.g('add', '-A'); w.g('commit', '-qm', 'triggers');
  run(w, ['boot']);
  const r = run(w, ['close']);
  assert.doesNotMatch(r.out + r.err, /no vault\/daily note/, r.out + r.err);
  assert.match(r.out + r.err, /heartbeats rolled: .*heartbeats\.jsonl, 5 moved to 2026-10, 10 kept/);
  assert.deepStrictEqual(lines(w.live), all.slice(5));
  assert.strictEqual(w.g('status', '--porcelain', '--', path.dirname(w.live)).stdout.split('\n').filter(l => /heartbeats/.test(l)).length, 0, 'the roll was committed');
});

test('heartbeat files changed earlier in the session (a manual roll) do not count as knowledge needing a daily note', () => {
  const w = workspace();
  const all = Array.from({ length: 15 }, (_, i) => hb(day('2026-10-01', i), i));
  fs.writeFileSync(w.live, all.join('\n') + '\n');
  const chk = JSON.parse(run(w, ['check', '--json']).out);
  for (const d of [...chk.triggers.due, ...chk.triggers.overdue]) run(w, ['file', 'trigger', d.id, 'ran', 'test']);
  w.g('add', '-A'); w.g('commit', '-qm', 'setup');
  run(w, ['boot']);
  assert.strictEqual(run(w, ['heartbeats', 'roll']).code, 0);
  const r = run(w, ['close']);
  assert.doesNotMatch(r.out + r.err, /no vault\/daily note/, r.out + r.err);
});
