#!/usr/bin/env node
/*
 * Tests for how bin/harold close saves: it must never print "nothing to push" over commits that did not
 * reach the remote. A branch with no upstream is published with -u to origin under its own name; anything
 * that cannot be pushed is reported as NOT PUSHED with the reason (exit 1). The cloud path (routines,
 * Actions) pushes to the default branch and must say so too when origin cannot be reached; on a named
 * feature branch it pushes to that branch instead, so unreviewed work never lands on the default branch.
 *
 *   node --test tests/close-push.test.js
 *
 * Each workspace is a throwaway copy of this repository with a local bare repository as origin, and HOME
 * pointed at an empty directory so no real credentials are read.
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

const STRIP = ['HAROLD_ROOT', 'HAROLD_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'GITHUB_ACTIONS', 'CLAUDE_CODE_REMOTE', 'HAROLD_NOW', 'HAROLD_DETACHED', 'CURSOR_PROJECT_DIR', 'CURSOR_VERSION'];
function run(w, args, env = {}) {
  const clean = { ...process.env };
  STRIP.forEach(k => delete clean[k]);
  const r = spawnSync(process.execPath, [path.join(w.ws, 'bin/harold'), ...args], {
    cwd: w.ws, encoding: 'utf8', timeout: 120000, input: '',
    env: { ...clean, HOME: w.home, HAROLD_ENV_FILE: path.join(w.home, 'none'), ...env },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// origin: 'bare' (a bare repo holding main), 'empty' (a bare repo with no branches), 'gone' (a path that does not exist)
function workspace(origin = 'bare') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-push-'));
  dirs.push(dir);
  const ws = path.join(dir, 'ws'), home = path.join(dir, 'home'), bare = path.join(dir, 'origin.git');
  fs.mkdirSync(home);
  fs.cpSync(SRC, ws, { recursive: true, filter: s => !SKIP.has(path.basename(s)) && !/\/harold\/active-sessions\/[^/]+\.json$/.test(s) && !/\/harold\/briefs\/\d{4}-\d{2}-\d{2}\.md$/.test(s) });
  const g = (...a) => spawnSync('git', a, { cwd: ws, encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'test@example.com'); g('config', 'user.name', 'Test');
  g('add', '-A'); g('commit', '-qm', 'init');
  if (origin !== 'gone') spawnSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  g('remote', 'add', 'origin', bare);
  if (origin === 'bare') { g('push', '-q', '-u', 'origin', 'main'); g('fetch', '-q', 'origin'); g('remote', 'set-head', 'origin', 'main'); } // as a clone would
  const w = { dir, ws, home, bare, g };
  const chk = JSON.parse(run(w, ['check', '--json']).out);
  for (const d of [...chk.triggers.due, ...chk.triggers.overdue]) run(w, ['file', 'trigger', d.id, 'ran', 'test']);
  w.today = chk.today.iso;
  return w;
}
function work(w, env) {
  run(w, ['boot'], env);
  fs.writeFileSync(path.join(w.ws, `vault/daily/${w.today}-push-test.md`), `# ${w.today} push test\n\nChanged something worth saving.\n`);
}
const onOrigin = (w, ref) => spawnSync('git', ['--git-dir', w.bare, 'rev-parse', '--verify', '--quiet', ref], { encoding: 'utf8' }).stdout.trim();
const head = w => w.g('rev-parse', 'HEAD').stdout.trim();

test('a branch with no upstream is pushed with -u to origin under the same name', () => {
  const w = workspace();
  w.g('checkout', '-q', '-b', 'feature/x');
  work(w);
  const r = run(w, ['close']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.out, /nothing to push/);
  assert.match(r.out, /pushed feature\/x to origin/);
  assert.strictEqual(onOrigin(w, 'refs/heads/feature/x'), head(w));
  assert.strictEqual(w.g('rev-parse', '--abbrev-ref', '@{u}').stdout.trim(), 'origin/feature/x');
});

test('when the -u push fails, close says NOT PUSHED with the reason and exits 1', () => {
  const w = workspace();
  w.g('checkout', '-q', '-b', 'feature/y');
  w.g('remote', 'set-url', 'origin', path.join(w.dir, 'no-such-remote.git'));
  work(w);
  const r = run(w, ['close']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.doesNotMatch(r.out, /nothing to push/);
  assert.match(r.out, /NOT PUSHED: feature\/y has no upstream and push -u origin feature\/y failed: \S/);
});

test('a detached HEAD with no upstream is reported as NOT PUSHED, never "nothing to push"', () => {
  const w = workspace();
  w.g('checkout', '-q', '--detach');
  work(w);
  const r = run(w, ['close']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /NOT PUSHED: detached HEAD/);
});

test('a branch that has an upstream still pushes the normal way', () => {
  const w = workspace();
  work(w);
  const r = run(w, ['close']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /pushed \d+ commit\(s\)/);
  assert.strictEqual(onOrigin(w, 'refs/heads/main'), head(w));
});

test('cloud runner: origin unreachable is NOT PUSHED, not "nothing to push"', () => {
  const env = { CLAUDE_CODE_REMOTE: 'true' };
  const w = workspace('gone');
  w.g('checkout', '-q', '--detach');
  work(w, env);
  const r = run(w, ['close'], env);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.doesNotMatch(r.out, /nothing to push/);
  assert.match(r.out, /NOT PUSHED: could not reach origin\/main/);
});

test('cloud runner: an empty origin gets the default branch created', () => {
  const env = { CLAUDE_CODE_REMOTE: 'true' };
  const w = workspace('empty');
  w.g('checkout', '-q', '--detach');
  work(w, env);
  const r = run(w, ['close'], env);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /pushed \d+ commit\(s\) to new branch main/);
  assert.strictEqual(onOrigin(w, 'refs/heads/main'), head(w));
});

test('cloud runner on a feature branch pushes to that branch, never to the default branch', () => {
  const env = { CLAUDE_CODE_REMOTE: 'true' };
  const w = workspace();
  const mainBefore = onOrigin(w, 'refs/heads/main');
  w.g('checkout', '-q', '-b', 'feature/z');
  fs.writeFileSync(path.join(w.ws, 'feature.txt'), 'unreviewed change\n');
  w.g('add', 'feature.txt'); w.g('commit', '-qm', 'feature work');
  work(w, env);
  const r = run(w, ['close'], env);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /pushed \d+ commit\(s\) to feature\/z \(a feature branch/);
  assert.strictEqual(onOrigin(w, 'refs/heads/main'), mainBefore, 'the default branch on origin must not move');
  assert.strictEqual(onOrigin(w, 'refs/heads/feature/z'), head(w));
});

test('cloud runner on a feature branch that moved on origin replays onto it and pushes there', () => {
  const env = { CLAUDE_CODE_REMOTE: 'true' };
  const w = workspace();
  const mainBefore = onOrigin(w, 'refs/heads/main');
  w.g('checkout', '-q', '-b', 'feature/w'); w.g('push', '-q', 'origin', 'feature/w');
  // Another writer adds a commit to origin's feature/w.
  const other = path.join(w.dir, 'other');
  spawnSync('git', ['clone', '-q', '-b', 'feature/w', w.bare, other]);
  fs.writeFileSync(path.join(other, 'other.txt'), 'x\n');
  spawnSync('git', ['-C', other, 'add', 'other.txt']);
  spawnSync('git', ['-C', other, '-c', 'user.email=o@example.com', '-c', 'user.name=O', 'commit', '-qm', 'other']);
  spawnSync('git', ['-C', other, 'push', '-q', 'origin', 'feature/w']);
  work(w, env);
  const r = run(w, ['close'], env);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /to feature\/w \(a feature branch/);
  assert.strictEqual(onOrigin(w, 'refs/heads/feature/w'), head(w));
  assert.ok(fs.existsSync(path.join(w.ws, 'other.txt')), 'replayed onto the other writer\'s commit');
  assert.strictEqual(onOrigin(w, 'refs/heads/main'), mainBefore);
});

test('cloud runner on the default branch still pushes to it', () => {
  const env = { CLAUDE_CODE_REMOTE: 'true' };
  const w = workspace();
  work(w, env);
  const r = run(w, ['close'], env);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /pushed \d+ commit\(s\) to main/);
  assert.strictEqual(onOrigin(w, 'refs/heads/main'), head(w));
});
