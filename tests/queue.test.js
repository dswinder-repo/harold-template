#!/usr/bin/env node
/*
 * Tests for writes that wait in harold/crm-queue.jsonl: a session with no database key is told plainly that a queued
 * write is NOT in the database and how to apply it through the connector; `harold queue` lists, marks and defers
 * them; close blocks the turn while one is waiting (never in a scheduled job); and harold/settings.env's
 * HAROLD_UPDATE_CHECK="0" is honoured.
 *
 *   node --test tests/queue.test.js
 *
 * Each workspace is a throwaway copy of this repository with a local bare repository as origin, HOME pointed at an
 * empty directory, and no database key or git identity from the environment.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { SRC } = require('./fixture');
const SKIP = new Set(['.git', 'node_modules', '.next', 'search.db', '.brief-job.json', '.brief-context.md', '.housekeeping-job.json', '.housekeeping-context.md', '.state', '.last-boot', 'upstream-check.json']);
const dirs = [];
test.after(() => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

const STRIP = ['HAROLD_ROOT', 'HAROLD_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'GITHUB_ACTIONS', 'CLAUDE_CODE_REMOTE', 'HAROLD_NOW', 'HAROLD_DETACHED',
  'CURSOR_PROJECT_DIR', 'CURSOR_VERSION', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'LINEAR_API_KEY', 'HAROLD_JOB', 'HAROLD_HOUSEKEEPING_JOB', 'HAROLD_UPDATE_CHECK',
  'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];
function run(w, args, env = {}) {
  const clean = { ...process.env };
  STRIP.forEach(k => delete clean[k]);
  const r = spawnSync(process.execPath, [path.join(w.ws, 'bin/harold'), ...args], {
    cwd: w.ws, encoding: 'utf8', timeout: 120000, input: '',
    env: { ...clean, HOME: w.home, HAROLD_ENV_FILE: path.join(w.home, 'none'), HAROLD_TZ: 'America/New_York', ...env },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') };
}

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-queue-'));
  dirs.push(dir);
  const ws = path.join(dir, 'ws'), home = path.join(dir, 'home'), bare = path.join(dir, 'origin.git');
  fs.mkdirSync(home);
  fs.cpSync(SRC, ws, { recursive: true, filter: s => !SKIP.has(path.basename(s)) && !/\/harold\/active-sessions\/[^/]+\.json$/.test(s) && !/\/harold\/briefs\/\d{4}-\d{2}-\d{2}\.md$/.test(s) });
  fs.writeFileSync(path.join(ws, 'harold/crm-queue.jsonl'), '');
  const g = (...a) => spawnSync('git', a, { cwd: ws, encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'test@example.com'); g('config', 'user.name', 'Test');
  g('add', '-A'); g('commit', '-qm', 'init');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  g('remote', 'add', 'origin', bare); g('push', '-q', '-u', 'origin', 'main');
  const w = { dir, ws, home, g };
  const chk = JSON.parse(run(w, ['check', '--json']).out);
  for (const d of [...chk.triggers.due, ...chk.triggers.overdue]) run(w, ['file', 'trigger', d.id, 'ran', 'test']);
  w.today = chk.today.iso;
  return w;
}
const rows = w => fs.readFileSync(path.join(w.ws, 'harold/crm-queue.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

test('no key: task create queues, says plainly it is not in the database, and gives the connector call and the command to mark it', () => {
  const w = workspace();
  const r = run(w, ['task', 'create', 'Call the venue', '--due', '2026-12-01']);
  assert.strictEqual(r.code, 0, r.all);
  const id = r.out.match(/queued (Q-[0-9a-f]{6}) "Call the venue"/)[1];
  assert.match(r.out, /NOT IN THE DATABASE YET \(no database key here\)/);
  assert.match(r.out, new RegExp(`Queue id ${id}`));
  assert.match(r.out, /task_create \{"title":"Call the venue","priority":"medium","due_date":"2026-12-01"\}/);
  assert.match(r.out, new RegExp(`queue done ${id} "`));
  assert.match(r.out, /If this session has the connector, apply it now/);
  assert.match(r.out, /replay applies it where the database key is/);
  assert.strictEqual(rows(w).length, 1);
  assert.strictEqual(rows(w)[0].replayed, false);

  const l = run(w, ['queue']);
  assert.match(l.out, /1 write waiting/);
  assert.match(l.out, new RegExp(`${id} .*task create "Call the venue"`));
  assert.match(l.out, /apply: task_create/);
  const j = JSON.parse(run(w, ['queue', 'list', '--json']).out);
  assert.deepStrictEqual(j.map(x => [x.id, x.tool]), [[id, 'task_create']]);

  // A change to the queued task names its Q- ref; once that is marked done, the H- ref from the result is used.
  const s = run(w, ['task', 'start', id]);
  assert.match(s.out, /NOT IN THE DATABASE YET/);
  assert.match(s.out, /task_update \{"task":"Q-[0-9a-f]{6}","state":"start"\}.*use the H- ref/);
  const d = run(w, ['queue', 'done', id, 'created H-41 "Call the venue"']);
  assert.strictEqual(d.code, 0, d.all);
  const row = rows(w).find(x => x.payload.qid === id.slice(2));
  assert.strictEqual(row.replayed, true);
  assert.strictEqual(row.replayed_to, 'connector');
  assert.match(row.replayed_at, /^\d{4}-/);
  assert.strictEqual(row.result, 'created H-41 "Call the venue"');
  const after = JSON.parse(run(w, ['queue', 'list', '--json']).out);
  assert.strictEqual(after.length, 1, 'only the start is still waiting');
  assert.deepStrictEqual(after[0].args, { task: 'H-41', state: 'start' }, 'the queued start now names the H- ref');
  const later = run(w, ['task', 'done', id]);
  assert.match(later.out, /task_update \{"task":"H-41","state":"done"\}/, 'a later task command resolves the Q- ref to H-41');
  assert.match(run(w, ['queue', 'done', id, 'again']).err, /not waiting: it was already applied/);
  assert.strictEqual(run(w, ['queue', 'done', 'Q-ffffff', 'x']).code, 2);
  assert.strictEqual(run(w, ['queue', 'done', id]).code, 2, 'a result is required');
});

test('close blocks on a waiting write and passes after queue done or queue defer; never blocks a scheduled job', () => {
  const w = workspace();
  assert.strictEqual(run(w, ['boot']).code, 0);
  const id = run(w, ['task', 'create', 'Send the deck']).out.match(/queued (Q-[0-9a-f]{6})/)[1];
  const c1 = run(w, ['close']);
  assert.strictEqual(c1.code, 2, c1.all);
  assert.match(c1.all, /1 queued write NOT in the database/);
  assert.match(c1.all, new RegExp(`${id} .*task create "Send the deck"`));
  assert.match(c1.all, /queue done <id>/);
  assert.match(c1.all, /queue defer <id>\|all/);

  const job = run(w, ['close'], { HAROLD_JOB: '1' });
  assert.doesNotMatch(job.all, /NOT in the database/, 'a scheduled job is never blocked by the queue');

  assert.match(run(w, ['queue', 'defer', id, 'no connector in this session']).out, /deferred/);
  const c2 = run(w, ['close']);
  assert.notStrictEqual(c2.code, 2, c2.all);
  assert.doesNotMatch(c2.all, /NOT in the database/);
  assert.match(run(w, ['queue']).out, /deferred today: no connector in this session/, 'deferred is still waiting, just not blocking today');

  // A second write: blocks again until it is marked applied.
  const crm = run(w, ['file', 'crm', '{"contact":"Sam Lee","action":"log_interaction","payload":{"type":"call","subject":"Intro"}}']);
  assert.match(crm.out, /queued log_interaction for Sam Lee/);
  assert.match(crm.out, /NOT IN THE DATABASE YET/);
  assert.match(crm.out, /crm_log_interaction \{"type":"call","subject":"Intro","contact_name":"Sam Lee"\}/);
  const cid = crm.out.match(/Queue id (C-[0-9a-f]{6})/)[1];
  // --final: a plain close within 20 seconds of a clean one returns at once without checking anything.
  assert.strictEqual(run(w, ['close', '--final']).code, 2);
  assert.match(run(w, ['queue', 'done', cid.toLowerCase(), 'logged call "Intro" for Sam Lee']).out, /marked C-/);
  const c3 = run(w, ['close', '--final']);
  assert.notStrictEqual(c3.code, 2, c3.all);
});

test('a write recorded as already applied through the connector is not waiting and never blocks close', () => {
  const w = workspace();
  assert.strictEqual(run(w, ['boot']).code, 0);
  const r = run(w, ['file', 'crm', '{"contact":"Sam Lee","action":"upsert_contact","applied":"connector"}']);
  assert.match(r.out, /already written through a connector/);
  assert.doesNotMatch(r.out, /NOT IN THE DATABASE/);
  assert.match(run(w, ['queue']).out, /Nothing waiting/);
  const c = run(w, ['close']);
  assert.notStrictEqual(c.code, 2, c.all);
  assert.doesNotMatch(c.all, /NOT in the database/);
});

test('a first-run workspace with no queue file: queue and close have nothing to say about it', () => {
  const w = workspace();
  fs.rmSync(path.join(w.ws, 'harold/crm-queue.jsonl'));
  assert.strictEqual(run(w, ['boot']).code, 0);
  assert.match(run(w, ['queue']).out, /Nothing waiting/);
  const c = run(w, ['close']);
  assert.notStrictEqual(c.code, 2, c.all);
});

test('boot lists waiting writes as due work when it cannot replay them here', () => {
  const w = workspace();
  const id = run(w, ['task', 'create', 'Book the room']).out.match(/queued (Q-[0-9a-f]{6})/)[1];
  const b = run(w, ['boot']);
  assert.strictEqual(b.code, 0, b.all);
  assert.match(b.out, /## Waiting writes — DUE: 1 queued write NOT in the database/);
  assert.match(b.out, new RegExp(`- ${id} .*task create "Book the room"\\n    apply: task_create \\{"title":"Book the room"`));
  assert.match(b.out, /CRM queue: 1 queued CRM write waiting; no SUPABASE_URL.*queue done <id>/);
  assert.match(b.out, /No connector here: .*queue defer <id>\|all/);
});

test('HAROLD_UPDATE_CHECK="0" in harold/settings.env turns off the starter check', () => {
  const w = workspace();
  const up = path.join(w.dir, 'up.git'), src = path.join(w.dir, 'up');
  spawnSync('git', ['init', '-q', '-b', 'main', src]);
  fs.writeFileSync(path.join(src, 'README.md'), 'starter\n');
  const u = (...a) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', ...a], { cwd: src, encoding: 'utf8' });
  u('add', '-A'); u('commit', '-qm', 'v1');
  spawnSync('git', ['clone', '-q', '--bare', src, up]);
  fs.writeFileSync(path.join(w.ws, 'harold/upstream.json'), JSON.stringify({ url: up, ref: 'main', commit: '1'.repeat(40), date: '2026-10-01' }));
  const stateFile = path.join(w.ws, 'harold/active-sessions/.state/upstream-check.json');
  fs.rmSync(stateFile, { force: true });
  assert.match(run(w, ['boot']).out, /Harold update available/, 'the check runs by default');
  fs.rmSync(stateFile, { force: true });
  fs.appendFileSync(path.join(w.ws, 'harold/settings.env'), '\nHAROLD_UPDATE_CHECK="0"\n');
  assert.doesNotMatch(run(w, ['boot']).out, /Harold update available/, 'settings.env turns it off');
});
