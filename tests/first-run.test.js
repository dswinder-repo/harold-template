#!/usr/bin/env node
/*
 * A fresh install: the starter copied as-is into a new private repository, first boot, first close.
 *
 *   node --test tests/first-run.test.js
 *
 * The example content (Jane Doe, Acme Corp, blocker B001, the example event, the example alerts and
 * lesson) must not block the first close, whatever date it runs on. The first boot writes a
 * "harold-start" row into the empty trigger log; scheduled work counts from the day after.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { SRC } = require('./fixture'); // this repository, or in a workspace the starter's content with its machinery (tests/fixture.js)
const dirs = [];
// These tests are about the starter as published. In a workspace that has already booted (its trigger log records
// harold-start), the copy below is no longer a fresh install, so they skip themselves (review X-05).
const USED = (() => { try { return /"id":"harold-start"/.test(fs.readFileSync(path.join(SRC, 'harold/trigger-log.jsonl'), 'utf8')); } catch (_) { return false; } })();
const firstRun = (name, fn) => test(name, { skip: USED && 'this workspace has already booted (harold-start is in harold/trigger-log.jsonl); first-run tests apply to an unused starter' }, fn);
test.after(() => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

// Exactly what git would publish: tracked files plus new ones that are not ignored.
function freshInstall() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-first-run-'));
  dirs.push(dir);
  const ws = path.join(dir, 'ws'), home = path.join(dir, 'home'), remote = path.join(dir, 'remote.git');
  fs.mkdirSync(home);
  const files = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: SRC, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
  for (const f of files) {
    const from = path.join(SRC, f);
    if (!fs.existsSync(from) || fs.statSync(from).isDirectory()) continue;
    fs.mkdirSync(path.dirname(path.join(ws, f)), { recursive: true });
    fs.copyFileSync(from, path.join(ws, f));
    fs.chmodSync(path.join(ws, f), fs.statSync(from).mode);
  }
  const g = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  g(dir, 'init', '-q', '--bare', '-b', 'main', remote);
  g(ws, 'init', '-q', '-b', 'main'); g(ws, 'config', 'user.email', 'test@example.com'); g(ws, 'config', 'user.name', 'Test');
  g(ws, 'add', '-A'); g(ws, 'commit', '-qm', 'Initial commit');
  g(ws, 'remote', 'add', 'origin', remote); g(ws, 'push', '-q', '-u', 'origin', 'main');
  return { dir, ws, home, remote, git: (...a) => g(ws, ...a).stdout.trim(), remoteLog: () => g(dir, '--git-dir', remote, 'log', '--oneline').stdout.trim() };
}
const STRIP = ['HAROLD_ROOT', 'HAROLD_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'GITHUB_ACTIONS', 'CLAUDE_CODE_REMOTE', 'HAROLD_NOW', 'HAROLD_DETACHED', 'HAROLD_TZ', 'HAROLD_TODAY', 'HAROLD_AGENT'];
function run(w, args, env = {}) {
  const clean = { ...process.env };
  STRIP.forEach(k => delete clean[k]);
  const r = spawnSync(process.execPath, [path.join(w.ws, 'bin/harold'), ...args], {
    cwd: w.ws, encoding: 'utf8', timeout: 120000, input: '',
    env: { ...clean, HOME: w.home, HAROLD_ENV_FILE: path.join(w.home, 'none'), HAROLD_TZ: 'America/Chicago', HAROLD_SESSION_ID: 'first-run', ...env },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

firstRun('the starter ships an empty trigger log and undated example rows', () => {
  assert.strictEqual(fs.readFileSync(path.join(SRC, 'harold/trigger-log.jsonl'), 'utf8').trim(), '');
  const blockers = fs.readFileSync(path.join(SRC, 'harold/blockers.md'), 'utf8');
  assert.match(blockers, /\| B001 \|[^\n]*\(example: no date\)/);
  assert.match(fs.readFileSync(path.join(SRC, 'harold/alerts.md'), 'utf8'), /Last updated: never/);
});

// A Monday, a Friday that is the last business day, the 1st, and a Friday that is the 1st.
for (const now of ['2026-10-12T09:00:00', '2026-10-30T09:00:00', '2026-12-01T09:00:00', '2027-01-01T09:00:00']) {
  firstRun(`first boot and first close pass on a fresh install (${now.slice(0, 10)})`, () => {
    const w = freshInstall();
    const env = { HAROLD_NOW: now };
    const b = run(w, ['boot'], env);
    assert.strictEqual(b.code, 0, b.out + b.err);
    assert.match(b.out, /nothing due, nothing overdue/);
    assert.match(b.out, /Harold started in this workspace today/);
    assert.doesNotMatch(b.out, /over its \d+k budget/, 'the starter\'s own startup files fit their budgets');
    const log = fs.readFileSync(path.join(w.ws, 'harold/trigger-log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepStrictEqual(log.map(e => [e.id, e.date]), [['harold-start', now.slice(0, 10)]]);
    const c = run(w, ['close'], env);
    assert.strictEqual(c.code, 0, c.out + c.err);
    assert.match(c.out, /git: pushed 1 commit/);
    const msg = w.git('log', '-1', '--format=%B');
    assert.match(msg, /Recorded-By: bin\/harold/, 'a terminal close names no AI tool');
    assert.doesNotMatch(msg, /Co-Authored-By: Claude/);
    const f = run(w, ['close', '--final'], env);
    assert.strictEqual(f.code, 0, f.out + f.err);
    assert.match(w.remoteLog(), /chore\(session\)/);
  });
}

firstRun('after the first day, scheduled work counts as usual', () => {
  const w = freshInstall();
  assert.strictEqual(run(w, ['boot'], { HAROLD_NOW: '2026-10-07T09:00:00' }).code, 0);  // a Wednesday
  const ids = now => { const c = JSON.parse(run(w, ['check', '--json'], { HAROLD_NOW: now }).out); return { due: c.triggers.due.map(d => d.id), overdue: c.triggers.overdue.map(d => d.id) }; };
  assert.deepStrictEqual(ids('2026-10-08T09:00:00'), { due: [], overdue: [] });
  assert.ok(ids('2026-10-09T09:00:00').due.includes('weekly-scan'), 'the first Friday after install');
  assert.ok(ids('2026-10-09T09:00:00').due.includes('alerts-rebuild'), 'alerts count from the first boot: two days on, they are due');
  assert.ok(ids('2026-10-12T09:00:00').overdue.includes('weekly-scan'), 'missed that Friday');
  assert.ok(ids('2026-11-02T09:00:00').overdue.includes('full-audit'), 'the first 1st after install');
  assert.ok(!ids('2026-10-12T09:00:00').overdue.includes('full-audit'), 'October 1st was before install');
});

firstRun('an existing install (a trigger log without the start row) is unchanged', () => {
  const w = freshInstall();
  fs.writeFileSync(path.join(w.ws, 'harold/trigger-log.jsonl'), JSON.stringify({ id: 'weekly-scan', status: 'ran', date: '2026-09-25' }) + '\n');
  const c = JSON.parse(run(w, ['check', '--json'], { HAROLD_NOW: '2026-10-07T09:00:00' }).out);
  assert.ok(c.triggers.overdue.some(d => d.id === 'weekly-scan'));
  run(w, ['boot'], { HAROLD_NOW: '2026-10-07T09:00:00' });
  assert.ok(!fs.readFileSync(path.join(w.ws, 'harold/trigger-log.jsonl'), 'utf8').includes('harold-start'), 'boot marks only an empty log');
});

firstRun('a clone still pointing at the public starter is warned about at boot (review B-03)', () => {
  const w = freshInstall();
  const quiet = JSON.parse(run(w, ['check', '--json']).out);
  assert.ok(!quiet.warnings.some(x => /public Harold starter/.test(x)), 'your own repository: no warning');
  w.git('remote', 'set-url', 'origin', 'https://github.com/example-owner/harold-template.git');
  const c = JSON.parse(run(w, ['check', '--json']).out);
  assert.ok(c.warnings.some(x => /looks like the public Harold starter.*PRIVATE repository.*remote set-url origin/.test(x)), JSON.stringify(c.warnings));
});

firstRun('a committed Linear snapshot is dated by its "Pulled" line, not by checkout time (review C-16)', () => {
  const w = freshInstall();
  fs.writeFileSync(path.join(w.ws, 'harold/linear-snapshot.md'), '# Linear snapshot — team X\n\n*Pulled 2026-10-01T10:00:00.000Z (2026-10-01 06:00 America/New_York). 0 open issues.*\n');
  const b = run(w, ['boot'], { HAROLD_NOW: '2026-10-03T10:00:00Z', LINEAR_API_KEY: '' });
  assert.match(b.out, /committed snapshot 48h old/);
});

// A tool without hooks: the agent runs boot and close itself, each in its own shell, with no session id (review X-03).
function shell(w, args, env = {}) {
  const clean = { ...process.env };
  STRIP.forEach(k => delete clean[k]);
  const cmd = [process.execPath, path.join(w.ws, 'bin/harold'), ...args].map(a => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
  const r = spawnSync('/bin/sh', ['-c', `${cmd} < /dev/null`], {
    cwd: w.ws, encoding: 'utf8', timeout: 120000,
    env: { ...clean, HOME: w.home, HAROLD_ENV_FILE: path.join(w.home, 'none'), HAROLD_TZ: 'America/Chicago', ...env },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const lastBoot = w => JSON.parse(fs.readFileSync(path.join(w.ws, 'harold/.last-boot'), 'utf8'));

firstRun('no hooks, no session id: close finds the latest boot, and the starter\'s own files never count as changed', () => {
  const w = freshInstall();
  const b = shell(w, ['boot']);
  assert.strictEqual(b.code, 0, b.out + b.err);
  const lb = lastBoot(w);
  assert.match(lb.id, /^terminal-\d+$/);
  assert.strictEqual(lb.head, w.git('rev-parse', 'HEAD'), 'the boot records the commit it started on');
  assert.ok(!w.git('status', '--porcelain').includes('.last-boot'), 'harold/.last-boot is gitignored');
  // A normal turn: the agent sets its session file's task, does its work, and the turn ends.
  const sf = path.join(w.ws, lb.sessionFile);
  const j = JSON.parse(fs.readFileSync(sf, 'utf8')); j.task = 'Answer a question'; j.activities.research = { status: 'working', task: 'reading', progress: 50, started: new Date().toISOString() };
  fs.writeFileSync(sf, JSON.stringify(j, null, 2));
  const c = shell(w, ['close']);
  assert.strictEqual(c.code, 0, c.out + c.err);
  assert.match(c.out, /using the latest boot in this workspace/);
  assert.match(c.out, new RegExp(`set to sleeping: ${lb.sessionFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'the boot\'s own session file');
  assert.match(c.out, /git: pushed 1 commit/);
  assert.strictEqual(JSON.parse(fs.readFileSync(sf, 'utf8')).activities.research.status, 'sleeping');
});

firstRun('no hooks, no session id: what the session changed still has to be filed, and only that', () => {
  const w = freshInstall();
  assert.strictEqual(shell(w, ['boot']).code, 0);
  const today = JSON.parse(shell(w, ['check', '--json']).out).today.iso;
  fs.appendFileSync(path.join(w.ws, 'harold/facts.md'), '\n- A new fact.\n');
  const blocked = shell(w, ['close']);
  assert.strictEqual(blocked.code, 2, blocked.out + blocked.err);
  assert.match(blocked.err, /1 knowledge file\(s\) changed this session[\s\S]*Changed: harold\/facts\.md$/m);
  fs.writeFileSync(path.join(w.ws, `vault/daily/${today}-first-turn.md`), `# ${today}\n\nAdded a fact.\n`);
  const ok = shell(w, ['close']);
  assert.strictEqual(ok.code, 0, ok.out + ok.err);
  const fin = shell(w, ['close', '--final']);
  assert.strictEqual(fin.code, 0, fin.out + fin.err);
  assert.ok(!fs.existsSync(path.join(w.ws, 'harold/.last-boot')), 'the final close ends the session it belonged to');
});

firstRun('before the first boot, check judges an empty trigger log as boot does: nothing overdue (review X-08)', () => {
  for (const now of ['2026-10-12T09:00:00', '2026-11-02T09:00:00', '2026-10-30T09:00:00']) {
    const w = freshInstall();
    const c = JSON.parse(run(w, ['check', '--json'], { HAROLD_NOW: now }).out);
    assert.deepStrictEqual({ due: c.triggers.due.map(d => d.id), overdue: c.triggers.overdue.map(d => d.id) }, { due: [], overdue: [] }, now);
    assert.ok(c.triggers.info.some(i => /No boot has run in this workspace yet/.test(i)), JSON.stringify(c.triggers.info));
    assert.strictEqual(fs.readFileSync(path.join(w.ws, 'harold/trigger-log.jsonl'), 'utf8'), '', 'check writes nothing');
  }
});
