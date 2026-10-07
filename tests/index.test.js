#!/usr/bin/env node
/*
 * Tests for the search index and link graph (bin/harold-index) and the bin/harold commands on top of it.
 *
 *   node --test tests/index.test.js
 *
 * 1. The unit tests in tests/test_harold_index.py (link resolution, backlinks, traversal, stale and
 *    broken flags, archives, incremental rebuilds, graph.json), run with python3.
 * 2. The commands end to end in a throwaway copy of this repository (its own git repo, no remote,
 *    HOME pointed at an empty directory): search lists linked notes, related ends with a gaps line,
 *    backlinks, and close writing harold/graph.json into its commit.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = path.resolve(__dirname, '..');
const SKIP = new Set(['.git', 'node_modules', '.next', 'search.db', 'graph.json', '.brief-job.json', '.brief-context.md', '.housekeeping-job.json', '.housekeeping-context.md', '.state', '__pycache__']);
const dirs = [];
test.after(() => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

const STRIP = ['HAROLD_ROOT', 'HAROLD_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'GITHUB_ACTIONS', 'CLAUDE_CODE_REMOTE', 'HAROLD_NOW', 'HAROLD_DETACHED', 'HAROLD_TODAY', 'HAROLD_STALE_DAYS'];
function run(w, args, env = {}) {
  const clean = { ...process.env };
  STRIP.forEach(k => delete clean[k]);
  const r = spawnSync(process.execPath, [path.join(w.ws, 'bin/harold'), ...args], {
    cwd: w.ws, encoding: 'utf8', timeout: 120000, input: '',
    env: { ...clean, HOME: w.home, HAROLD_ENV_FILE: path.join(w.home, 'none'), HAROLD_SESSION_ID: 'index-test', ...env },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-index-'));
  dirs.push(dir);
  const ws = path.join(dir, 'ws'), home = path.join(dir, 'home');
  fs.mkdirSync(home);
  fs.cpSync(SRC, ws, { recursive: true, filter: s => !SKIP.has(path.basename(s)) && !/\/harold\/active-sessions\/[^/]+\.json$/.test(s) && !/\/harold\/briefs\/\d{4}-\d{2}-\d{2}\.md$/.test(s) });
  const g = (...a) => spawnSync('git', a, { cwd: ws, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 'test@example.com'); g('config', 'user.name', 'Test');
  g('add', '-A'); g('commit', '-qm', 'init');
  const w = { dir, ws, home, git: (...a) => g(...a).stdout.trim() };
  const chk = JSON.parse(run(w, ['check', '--json']).out);
  for (const d of [...chk.triggers.due, ...chk.triggers.overdue]) run(w, ['file', 'trigger', d.id, 'ran', 'test']);
  return w;
}

test('unit tests: tests/test_harold_index.py', () => {
  const r = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', path.join(SRC, 'tests'), '-p', 'test_harold_index.py'], { cwd: SRC, encoding: 'utf8', timeout: 120000 });
  assert.strictEqual(r.status, 0, r.stderr.slice(-3000));
  assert.match(r.stderr, /\nOK/);
});

const w = workspace();

test('search lists each hit\'s linked notes; related ends with a gaps line; backlinks', () => {
  const s = run(w, ['search', 'Acme']);
  assert.strictEqual(s.code, 0, s.err);
  assert.match(s.out, /↳ links: /);
  assert.match(s.out, /bin\/harold related/);
  const r = run(w, ['related', 'Jane Doe']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /^Jane Doe {2}· {2}vault\/people\/Jane Doe\.md {2}· {2}person/);
  assert.match(r.out, /↔ Acme Corp/);
  assert.match(r.out.trim().split('\n').pop(), /^gaps: Jane Doe: /);
  const j = JSON.parse(run(w, ['related', 'Acme Corp', '--json']).out);
  assert.strictEqual(j.starts[0].path, 'vault/companies/Acme Corp.md');
  assert.ok(j.related.some(x => x.path === 'vault/people/Jane Doe.md'));
  const b = run(w, ['backlinks', 'Acme Corp']);
  assert.strictEqual(b.code, 0, b.err);
  assert.match(b.out, /← Jane Doe/);
  for (const sub of ['search', 'related', 'backlinks']) assert.strictEqual(run(w, [sub]).code, 2, `${sub} with no query is a usage error`);
});

test('the index refreshes itself: a new note and a newly linked archive are found without a manual rebuild', () => {
  fs.mkdirSync(path.join(w.ws, 'vault/archive'), { recursive: true });
  fs.writeFileSync(path.join(w.ws, 'vault/archive/Old Supplier.md'), '# Old Supplier\n\nSupplied [[Acme Corp]] with zeppelin parts until 2024.\n');
  const s = run(w, ['search', 'zeppelin']);
  assert.strictEqual(s.code, 0, s.err);
  assert.match(s.out, /vault\/archive\/Old Supplier\.md/);
  assert.match(run(w, ['backlinks', 'Acme Corp']).out, /← Old Supplier/);
  fs.rmSync(path.join(w.ws, 'vault/archive'), { recursive: true });
});

test('close writes harold/graph.json into its commit, and only rewrites it when the graph changed', () => {
  assert.strictEqual(run(w, ['boot']).code, 0);
  const c1 = run(w, ['close']);
  assert.strictEqual(c1.code, 0, c1.out + c1.err);
  assert.match(c1.out, /graph\.json written/);
  assert.match(w.git('ls-files', 'harold/graph.json'), /harold\/graph\.json/);
  const g = JSON.parse(fs.readFileSync(path.join(w.ws, 'harold/graph.json'), 'utf8'));
  assert.deepStrictEqual(g.node_fields, ['path', 'title', 'type', 'last_updated']);
  assert.ok(g.edges.some(([s, d]) => s === 'vault/people/Jane Doe.md' && d === 'vault/companies/Acme Corp.md'));
  assert.ok(!fs.readFileSync(path.join(w.ws, 'harold/graph.json'), 'utf8').includes('VP Partnerships'), 'graph.json carries no note text');
  assert.strictEqual(w.git('status', '--porcelain', 'harold/graph.json'), '');
  const head = w.git('rev-parse', 'HEAD');
  const c2 = run(w, ['close', '--final']);
  assert.strictEqual(c2.code, 0, c2.out + c2.err);
  assert.doesNotMatch(c2.out, /graph\.json written/);
  assert.strictEqual(w.git('diff', '--name-only', head, 'HEAD', '--', 'harold/graph.json'), '');
});
