#!/usr/bin/env node
/*
 * Tests for Harold's own task list: bin/harold task list|create|start|done|cancel|reopen|update|conflicts, the
 * offline queue and its replay, the snapshot, and boot's Tasks section.
 *
 *   node --test tests/tasks.test.js
 *
 * The database is tests/mock-rest.js, a small in-memory stand-in for the Supabase REST endpoint, run as its own
 * process (bin/harold is called through a blocking spawn, which would freeze a server inside this process).
 * `--legacy` makes it behave like the database before the task-list migration. Nothing here touches a real database:
 * each workspace is a throwaway copy of this repository, HOME is an empty directory, and the only database
 * key in the environment is a dummy one pointing at 127.0.0.1.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { SRC } = require('./fixture'); // this repository, or in a workspace the starter's content with its machinery (tests/fixture.js)
const SKIP = new Set(['.git', 'node_modules', '.next', 'search.db', '.brief-job.json', '.brief-context.md', '.housekeeping-job.json', '.housekeeping-context.md', '.state', '.last-boot']);
const dirs = [], mocks = [];
test.after(() => { dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })); mocks.forEach(m => m.kill()); });

const NOW = '2026-11-18T09:00:00'; // wall-clock time in HAROLD_TZ: today is 2026-11-18
const PROJECTS = `# Harold Project Map

---

## Alpha Launch
- folder: vault
- status: active
- type: workstream
- aliases: alpha, the launch
- keywords: rollout

## Beta Studio
- folder: vault
- status: active
- type: workstream
- aliases: beta
- keywords: studio
`;

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-tasks-'));
  dirs.push(dir);
  const ws = path.join(dir, 'ws'), home = path.join(dir, 'home');
  fs.mkdirSync(home);
  fs.cpSync(SRC, ws, { recursive: true, filter: s => !SKIP.has(path.basename(s)) && !/\/harold\/active-sessions\/[^/]+\.json$/.test(s) && !/\/harold\/briefs\/\d{4}-\d{2}-\d{2}\.md$/.test(s) });
  fs.writeFileSync(path.join(ws, 'harold/projects.md'), PROJECTS);
  fs.rmSync(path.join(ws, 'harold/tasks-snapshot.md'), { force: true });
  fs.writeFileSync(path.join(ws, 'harold/crm-queue.jsonl'), '');
  const g = (...a) => spawnSync('git', a, { cwd: ws, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 'test@example.com'); g('config', 'user.name', 'Test');
  g('add', '-A'); g('commit', '-qm', 'init');
  return { dir, ws, home, g };
}

const STRIP = ['HAROLD_ROOT', 'HAROLD_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'GITHUB_ACTIONS', 'CLAUDE_CODE_REMOTE', 'HAROLD_NOW', 'HAROLD_DETACHED', 'CURSOR_PROJECT_DIR', 'CURSOR_VERSION', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'LINEAR_API_KEY'];
// `m` is a running mock (the database is reachable) or null (no database key at all).
function run(w, m, args, env = {}) {
  const clean = { ...process.env };
  STRIP.forEach(k => delete clean[k]);
  const db = m ? { SUPABASE_URL: `http://127.0.0.1:${m.port}`, SUPABASE_SERVICE_ROLE_KEY: 'dummy-test-key', NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' } : {};
  const r = spawnSync(process.execPath, [path.join(w.ws, 'bin/harold'), ...args], {
    cwd: w.ws, encoding: 'utf8', timeout: 120000, input: '',
    env: { ...clean, HOME: w.home, HAROLD_ENV_FILE: path.join(w.home, 'none'), HAROLD_TZ: 'America/New_York', HAROLD_NOW: NOW, ...db, ...env },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') };
}

async function mock(...args) {
  const child = spawn(process.execPath, [path.join(__dirname, 'mock-rest.js'), ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
  mocks.push(child);
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', d => { buf += d; const m = buf.match(/PORT (\d+)/); if (m) resolve(+m[1]); });
    child.on('exit', c => reject(new Error(`mock exited ${c}`)));
  });
  const base = `http://127.0.0.1:${port}`;
  return {
    port, kill: () => child.kill(),
    seed: (table, rows) => fetch(`${base}/__seed/${table}`, { method: 'POST', body: JSON.stringify(rows) }),
    fail: down => fetch(`${base}/__fail?mode=${down ? 'down' : 'ok'}`, { method: 'POST' }),
    log: async () => (await fetch(`${base}/__log`)).json(),
  };
}
const task = (ref, title, extra = {}) => ({ ref, title, description: '', status: 'pending', priority: 'medium', due_date: null, contact_id: null, project: null, source: 'harold', changed_by: 'harold', completed_at: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...extra });
const queueRows = w => fs.readFileSync(path.join(w.ws, 'harold/crm-queue.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

test('create, list, start, update and done work against the new schema; the project is stored by its canonical name', async () => {
  const m = await mock(), w = workspace();
  const c = run(w, m, ['task', 'create', 'Send the revised deck', '--project', 'alpha', '--due', '2026-11-20', '--priority', 'high', '--desc', 'with pricing page']);
  assert.strictEqual(c.code, 0, c.all);
  assert.match(c.out, /created H-1 "Send the revised deck" \(Alpha Launch, due 2026-11-20, high\)/);
  const sent = (await m.log()).find(r => r.method === 'POST' && r.path === 'tasks');
  assert.strictEqual(sent.body.due_date, '2026-11-20T00:00:00Z', 'a due date is a calendar day stored as UTC midnight');
  assert.strictEqual(sent.body.project, 'Alpha Launch');
  const c2 = run(w, m, ['task', 'create', 'Call Ben', '--due', '2026-11-18']);
  assert.match(c2.out, /created H-2 "Call Ben" \(due 2026-11-18\)/);

  const list = JSON.parse(run(w, m, ['task', 'list', '--json']).out);
  assert.strictEqual(list.source, 'live');
  assert.deepStrictEqual(list.groups['Due this week'].map(t => [t.ref, t.project, t.due, t.priority]), [['H-1', 'Alpha Launch', '2026-11-20', 'high']]);
  assert.deepStrictEqual(list.groups['Due today'].map(t => t.ref), ['H-2']);

  assert.match(run(w, m, ['task', 'start', 'H-1']).out, /start H-1 "Send the revised deck" → in_progress/);
  const u = run(w, m, ['task', 'update', 'H-2', '--due', '2026-11-30', '--priority', 'low', '--project', 'beta', '--title', 'Call Ben Hyman']);
  assert.strictEqual(u.code, 0, u.all);
  assert.match(u.out, /updated H-2 "Call Ben Hyman" \[pending, due 2026-11-30, Beta Studio\]/);
  assert.match(run(w, m, ['task', 'update', 'H-2', '--due', 'none']).out, /updated H-2 "Call Ben Hyman" \[pending, Beta Studio\]/);
  assert.match(run(w, m, ['task', 'done', 'H-1']).out, /done H-1 .* → completed/);
  assert.match(run(w, m, ['task', 'reopen', 'H-1']).out, /reopen H-1 .* → pending/);
  assert.match(run(w, m, ['task', 'cancel', 'H-1']).out, /cancel H-1 .* → cancelled/);

  const open = JSON.parse(run(w, m, ['task', 'list', '--json']).out);
  assert.strictEqual(open.total, 1, 'a cancelled task leaves the open list');
  assert.strictEqual(open.groups['Later or undated'][0].ref, 'H-2');
  const all = JSON.parse(run(w, m, ['task', 'list', '--all', '--json']).out);
  assert.deepStrictEqual(all.closed.map(t => t.ref), ['H-1']);
});

test('create refuses an unknown project (with close matches), a secret, a bad date and a bad priority; a duplicate returns the existing task', async () => {
  const m = await mock(), w = workspace();
  const p = run(w, m, ['task', 'create', 'Ship the beta rollout', '--project', 'betta studios']);
  assert.strictEqual(p.code, 2);
  assert.match(p.err, /refused: no project matches "betta studios"/);
  const near = run(w, m, ['task', 'create', 'Thing', '--project', 'rollout notes']);
  assert.strictEqual(near.code, 2, 'a keyword-only match is not a project');
  assert.match(near.err, /Close matches: Alpha Launch/);
  assert.match(run(w, m, ['task', 'create', 'Rotate the key sk-ant-abcdefghijklmnopqrstuvwxyz']).err, /looks like it contains a key or secret/);
  assert.match(run(w, m, ['task', 'create', 'Fine title', '--desc', 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789']).err, /looks like it contains a key or secret/);
  assert.match(run(w, m, ['task', 'create', 'X', '--due', '2026-02-30']).err, /--due must be a real date/);
  assert.match(run(w, m, ['task', 'create', 'X', '--priority', 'urgent']).err, /--priority must be one of/);
  assert.strictEqual(JSON.parse(run(w, m, ['task', 'list', '--json']).out).total, 0, 'nothing was created by a refused call');

  assert.match(run(w, m, ['task', 'create', 'Write the memo', '--project', 'alpha']).out, /created H-1/);
  assert.match(run(w, m, ['task', 'create', 'write the memo', '--project', 'the launch']).out, /H-1 already open with the same title and project/);
  assert.match(run(w, m, ['task', 'create', 'Write the memo', '--project', 'beta']).out, /created H-2/, 'the same title in another project is a different task');
  assert.match(run(w, m, ['task', 'create', 'Write the memo']).out, /created H-3/, 'and with no project another');
  assert.match(run(w, m, ['task', 'create', 'Write the memo']).out, /H-3 already open/);
  assert.strictEqual(JSON.parse(run(w, m, ['task', 'list', '--json']).out).total, 3);
});

test('list groups by due date in HAROLD_TZ, shows the contact and the outside key, and filters by project', async () => {
  const m = await mock(), w = workspace();
  const cid = '11111111-1111-4111-8111-111111111111', tid = '22222222-2222-4222-8222-222222222222';
  await m.seed('contacts', [{ id: cid, name: 'Jane Doe' }]);
  await m.seed('tasks', [
    task('H-1', 'Past due', { due_date: '2026-11-10T00:00:00+00:00', priority: 'high', project: 'Alpha Launch' }),
    task('H-2', 'Due today', { due_date: '2026-11-18T00:00:00+00:00', contact_id: cid }),
    task('H-3', 'Next week edge', { due_date: '2026-11-25T00:00:00+00:00' }),
    task('H-4', 'Too far', { due_date: '2026-11-26T00:00:00+00:00' }),
    task('H-5', 'Working on it', { status: 'in_progress' }),
    task('H-6', 'Linked', { id: tid, project: 'Beta Studio' }),
    task('H-7', 'Already done', { status: 'completed' }),
  ]);
  await m.seed('task_links', [{ task_id: tid, provider: 'linear', external_id: 'abc', external_key: 'ENG-123' }]);
  const j = JSON.parse(run(w, m, ['task', 'list', '--json']).out);
  assert.deepStrictEqual(Object.fromEntries(Object.entries(j.groups).map(([k, v]) => [k, v.map(t => t.ref)])), {
    'Overdue': ['H-1'], 'Due today': ['H-2'], 'Due this week': ['H-3'], 'In progress': ['H-5'], 'Later or undated': ['H-4', 'H-6'],
  });
  assert.strictEqual(j.groups['Due today'][0].contact, 'Jane Doe');
  assert.deepStrictEqual(j.groups['Later or undated'].find(t => t.ref === 'H-6').links, ['ENG-123']);
  const text = run(w, m, ['task', 'list']).out;
  assert.match(text, /### Overdue \(1\)\n\| Ref \| Title \| Project \| Contact \| Status \| Due \| Priority \| Linked \|/);
  assert.match(text, /\| H-2 \| Due today \| — \| Jane Doe \| pending \| 2026-11-18 \| medium \| — \|/);
  assert.match(text, /\| H-6 \| Linked \| Beta Studio \| — \| pending \| — \| medium \| ENG-123 \|/);
  const onlyBeta = JSON.parse(run(w, m, ['task', 'list', '--project', 'beta', '--json']).out);
  assert.deepStrictEqual(onlyBeta.groups['Later or undated'].map(t => t.ref), ['H-6']);
  assert.strictEqual(onlyBeta.total, 1);
  // The day follows HAROLD_TZ: at 23:30 New York on the 18th it is already the 19th in UTC, but still today here.
  const late = JSON.parse(run(w, m, ['task', 'list', '--json'], { HAROLD_NOW: '2026-11-18T23:30:00' }).out);
  assert.deepStrictEqual(late.groups['Due today'].map(t => t.ref), ['H-2']);
  // An outside key finds the task.
  assert.match(run(w, m, ['task', 'done', 'ENG-123']).out, /done H-6 "Linked" → completed/);
});

test('list rewrites harold/tasks-snapshot.md; with no database key it reads the snapshot and says how old it is', async () => {
  const m = await mock(), w = workspace();
  run(w, m, ['task', 'create', 'Snapshot me', '--project', 'alpha', '--due', '2026-11-18']);
  run(w, m, ['task', 'create', 'A | pipe in a title']);
  run(w, m, ['task', 'list']);
  const snap = fs.readFileSync(path.join(w.ws, 'harold/tasks-snapshot.md'), 'utf8');
  assert.match(snap, /^\*Written \d{4}-\d{2}-\d{2}T[\d:.]+Z by bin\/harold task list\.\*$/m);
  assert.match(snap, /### Due today \(1\)\n\| Ref \|[^\n]*\n\|---[^\n]*\n\| H-1 \| Snapshot me \| Alpha Launch \|/);
  assert.match(snap, /A \\\| pipe in a title/);
  assert.doesNotMatch(snap, /dummy-test-key/);

  // No key: the same list, from the file, with its age. The snapshot was written "now"; ask three days later.
  const later = new Date(Date.now() + 3 * 86400000 + 3600000).toISOString().slice(0, 19);
  const off = run(w, null, ['task', 'list'], { HAROLD_NOW: `${later}Z` });
  assert.strictEqual(off.code, 0, off.all);
  assert.match(off.out, /# Tasks — snapshot, written \S+ by bin\/harold task list, 3 days old/);
  assert.match(off.out, /\| H-1 \| Snapshot me \| Alpha Launch \|/);
  assert.match(off.out, /A \\\| pipe in a title/);
  const json = JSON.parse(run(w, null, ['task', 'list', '--json']).out);
  assert.strictEqual(json.source, 'snapshot');
  assert.strictEqual(json.total, 2);
  // With no key and no snapshot there is nothing to show, and it says so without crashing.
  fs.rmSync(path.join(w.ws, 'harold/tasks-snapshot.md'));
  const none = run(w, null, ['task', 'list']);
  assert.strictEqual(none.code, 1);
  assert.match(none.err, /no task list available/);
});

test('with no key, a snapshot written by the connector sync (one bullet per task) is read, not shown as empty', () => {
  const w = workspace();
  fs.writeFileSync(path.join(w.ws, 'harold/tasks-snapshot.md'), `# Tasks snapshot

*Written 2026-11-18T00:56:15-05:00 by the connector sync.*

Open tasks from Harold's task list, grouped by due date in New York time.

## Overdue (1)

- **H-3** · Chase the signed NDA · Alpha Launch · due 2026-11-10 · high · [PRI-5](https://linear.app/x/issue/PRI-5/chase)

## Due today (1)

- **H-7** · Create the monitoring accounts · Alpha Launch · due 2026-11-18 · medium · [PRI-9](https://linear.app/x/issue/PRI-9/create)

## Due this week (0)

- none

## In progress (1)

- **H-9** · Draft the pitch deck · no project · medium

## Later (1)

- **H-12** · Follow up on the data center status · no project · medium · [PRI-14](https://linear.app/x/issue/PRI-14/follow)
`);
  const json = JSON.parse(run(w, null, ['task', 'list', '--json']).out);
  assert.strictEqual(json.source, 'snapshot');
  assert.strictEqual(json.total, 4, 'every bullet is a task');
  assert.deepStrictEqual(json.groups['Overdue'].map(t => [t.ref, t.title, t.project, t.due, t.priority, t.links.join()]), [['H-3', 'Chase the signed NDA', 'Alpha Launch', '2026-11-10', 'high', 'PRI-5']]);
  assert.deepStrictEqual(json.groups['Due today'].map(t => t.ref), ['H-7']);
  assert.deepStrictEqual(json.groups['In progress'].map(t => [t.ref, t.project, t.status]), [['H-9', '', 'in_progress']]);
  assert.deepStrictEqual(json.groups['Later or undated'].map(t => t.ref), ['H-12']);
  const out = run(w, null, ['task', 'list']).out;
  assert.match(out, /### Overdue \(1\)/);
  assert.match(out, /\| H-12 \| Follow up on the data center status \| — \|/);
  assert.match(run(w, null, ['boot']).out + '', /Tasks[^\n]*\n[\s\S]*H-3/, 'boot lists the overdue task too');
});

test('with no key, writes queue in harold/crm-queue.jsonl as Q- refs and replay applies them in order, including one that names a queued ref', async () => {
  const m = await mock(), w = workspace();
  run(w, m, ['task', 'create', 'Existing', '--project', 'beta']); // H-1, written live
  run(w, m, ['task', 'list']); // leaves the snapshot a session with no key reads
  const a = run(w, null, ['task', 'create', 'Queued while offline', '--project', 'alpha', '--due', '2026-11-19', '--contact', 'Nobody Known']);
  assert.strictEqual(a.code, 0, a.all);
  const qid = a.out.match(/queued (Q-[0-9a-f]{6}) "Queued while offline"/)[1];
  assert.match(a.out, /no database key here/);
  const b = run(w, null, ['task', 'start', qid]);
  assert.match(b.out, /queued Q-[0-9a-f]{6}: start Q-[0-9a-f]{6}/);
  assert.match(run(w, null, ['task', 'done', 'H-1']).out, /queued Q-[0-9a-f]{6}: done H-1/);
  assert.match(run(w, null, ['task', 'update', 'H-1', '--due', '2026-12-01']).out, /queued Q-[0-9a-f]{6}: update H-1/);
  const q = queueRows(w);
  assert.deepStrictEqual(q.map(r => [r.action, r.contact, r.payload.op, r.replayed]), [['task', '(task)', 'create', false], ['task', '(task)', 'start', false], ['task', '(task)', 'done', false], ['task', '(task)', 'update', false]]);
  assert.strictEqual(q[0].payload.project, 'Alpha Launch');
  assert.match(run(w, null, ['task', 'list', '--json']).out, /"queued": 4/);
  assert.match(run(w, m, ['task', 'start', qid]).err, /still in the offline queue/);

  // The queued create names a contact that is not in the database: refused for good, the rest still go in.
  const first = run(w, m, ['replay']);
  assert.match(first.out, /NO\s+task create Q-[0-9a-f]{6}: contact: no CRM contact matches "Nobody Known"/);
  assert.match(first.out, /OK\s+task done Q-[0-9a-f]{6}: done H-1 "Existing" → completed/);
  assert.match(first.out, /OK\s+task update Q-[0-9a-f]{6}: update H-1 "Existing" → completed/);
  const after = queueRows(w);
  assert.strictEqual(after[0].refused, true);
  assert.deepStrictEqual(after.slice(2).map(r => r.replayed), [true, true]);
  assert.strictEqual(after[1].refused, true, 'a start naming a ref whose create was refused is refused too');
  assert.match(after[1].result, /Q-[0-9a-f]{6} was refused when the queue was applied/);

  // The same flow with a contact that exists: the create goes in, and the start that names its Q- ref follows it.
  const w2 = workspace();
  await m.seed('contacts', [{ id: '33333333-3333-4333-8333-333333333333', name: 'Jane Doe' }]);
  const c = run(w2, null, ['task', 'create', 'Follow up with Jane', '--contact', 'Jane Doe', '--due', '2026-11-19']);
  const cq = c.out.match(/queued (Q-[0-9a-f]{6})/)[1];
  run(w2, null, ['task', 'start', cq]);
  const rp = run(w2, m, ['replay']);
  assert.match(rp.out, /OK\s+task create Q-[0-9a-f]{6}: created H-2 "Follow up with Jane"/);
  assert.match(rp.out, /OK\s+task start Q-[0-9a-f]{6}: start H-2 "Follow up with Jane" → in_progress/);
  const t = JSON.parse(run(w2, m, ['task', 'list', '--json']).out).groups['Due this week'].find(x => x.ref === 'H-2');
  assert.strictEqual(t.contact, 'Jane Doe');
  assert.strictEqual(t.status, 'in_progress');
  assert.match(run(w2, m, ['task', 'done', cq]).out, /done H-2 .* → completed/, 'the Q- ref keeps working after the replay');
  assert.match(run(w2, m, ['replay']).out, /nothing waiting/);
});

test('an unreachable database queues the write instead of failing; a refused or unknown request is not queued', async () => {
  const m = await mock(), w = workspace();
  run(w, m, ['task', 'create', 'Before the outage']);
  run(w, m, ['task', 'list']); // the snapshot
  await m.fail(true);
  const r = run(w, m, ['task', 'create', 'During the outage', '--project', 'beta']);
  assert.strictEqual(r.code, 0, r.all);
  assert.match(r.out, /queued Q-[0-9a-f]{6} "During the outage" \(the database is not answering \(HTTP 503/);
  assert.match(run(w, m, ['task', 'done', 'H-1']).out, /queued Q-[0-9a-f]{6}: done H-1/);
  const down = run(w, m, ['task', 'list']);
  assert.strictEqual(down.code, 0, 'the snapshot answers when the database does not');
  assert.match(down.out, /snapshot/);
  await m.fail(false);
  const missing = run(w, m, ['task', 'done', 'H-99']);
  assert.strictEqual(missing.code, 2);
  assert.match(missing.err, /refused: no task H-99/);
  assert.strictEqual(queueRows(w).length, 2, 'only the two outage writes were queued');
  assert.match(run(w, m, ['replay']).out, /replayed 2 of 2/);
  const list = JSON.parse(run(w, m, ['task', 'list', '--json']).out);
  assert.deepStrictEqual(list.groups['Later or undated'].map(t => t.title), ['During the outage']);
});

test('the old schema (no ref or project columns) degrades instead of crashing', async () => {
  const m = await mock('--legacy'), w = workspace();
  const c = run(w, m, ['task', 'create', 'Works on the old schema', '--project', 'alpha', '--due', '2026-11-17']);
  assert.strictEqual(c.code, 0, c.all);
  const ref = c.out.match(/created (T-[0-9a-f]{8}) "Works on the old schema"/)[1];
  assert.match(c.out, /the project was not stored because the database has not been migrated/);
  const list = run(w, m, ['task', 'list']);
  assert.strictEqual(list.code, 0, list.all);
  assert.match(list.out, /has not been migrated to the new task list yet/);
  assert.match(list.out, new RegExp(`### Overdue \\(1\\)[\\s\\S]*\\| ${ref} \\| Works on the old schema \\| — \\|`));
  assert.match(run(w, m, ['task', 'start', ref]).out, new RegExp(`start ${ref} .* → in_progress`));
  assert.match(run(w, m, ['task', 'update', ref, '--due', '2026-11-30', '--project', 'beta']).out, /updated .*due 2026-11-30.*\n.*not stored/);
  assert.match(run(w, m, ['task', 'done', ref]).out, new RegExp(`done ${ref} .* → completed`));
  const h = run(w, m, ['task', 'done', 'H-1']);
  assert.strictEqual(h.code, 2);
  assert.match(h.err, /has not been migrated to refs yet/);
  assert.match(run(w, m, ['task', 'done', 'ENG-5']).err, /outside keys are only known once the database is migrated/);
  assert.match(run(w, m, ['task', 'conflicts']).out, /No sync log yet/);
  const boot = run(w, m, ['boot', '--full']);
  assert.strictEqual(boot.code, 0, boot.all);
  assert.match(boot.out, /## Tasks \(Harold's own list\)/);
  assert.match(boot.out, /has not been migrated to the new task list yet/);
  // The queue replays on the old schema too.
  const w2 = workspace();
  run(w2, null, ['task', 'create', 'Queued for the old schema', '--project', 'alpha']);
  const rp = run(w2, m, ['replay']);
  assert.match(rp.out, /OK\s+task create Q-[0-9a-f]{6}: created T-[0-9a-f]{8} "Queued for the old schema" \(project not stored/);
});

test('boot prints a Tasks section from the table (counts, overdue and due-today rows), refreshes the snapshot, and counts new sync conflicts', async () => {
  const m = await mock(), w = workspace();
  const tid = '44444444-4444-4444-8444-444444444444';
  await m.seed('tasks', [
    task('H-1', 'Late one', { due_date: '2026-11-01T00:00:00+00:00', priority: 'high', project: 'Alpha Launch' }),
    task('H-2', 'Today one', { due_date: '2026-11-18T00:00:00+00:00' }),
    task('H-3', 'Whenever'),
    task('H-4', 'Conflicted', { id: tid }),
  ]);
  await m.seed('sync_log', [
    { id: 1, at: '2026-11-18T08:00:00Z', provider: 'linear', task_id: tid, kind: 'conflict', detail: { winner: 'linear', harold: { title: 'A' }, linear: { title: 'B' } }, seen: false },
    { id: 2, at: '2026-11-17T08:00:00Z', provider: 'linear', task_id: tid, kind: 'conflict', detail: {}, seen: true },
    { id: 3, at: '2026-11-18T08:05:00Z', provider: 'linear', task_id: tid, kind: 'push', detail: {}, seen: false },
  ]);
  const boot = run(w, m, ['boot', '--full']);
  assert.strictEqual(boot.code, 0, boot.all);
  assert.match(boot.out, /## Tasks \(Harold's own list\) — live, 4 open/);
  assert.match(boot.out, /Overdue 1 · due today 1 · due this week 0 · in progress 0 · later or undated 2\./);
  assert.match(boot.out, /- H-1 \[pending, due 2026-11-01, high\] Late one \(Alpha Launch\)/);
  assert.match(boot.out, /- H-2 \[pending, due 2026-11-18, medium\] Today one/);
  assert.match(boot.out, /1 new sync conflict — \S*bin\/harold task conflicts/);
  assert.doesNotMatch(boot.out, /Linear \(task layer/);
  assert.match(fs.readFileSync(path.join(w.ws, 'harold/tasks-snapshot.md'), 'utf8'), /by bin\/harold boot\.\*/);

  const c = run(w, m, ['task', 'conflicts']);
  assert.match(c.out, /1 unseen sync conflict/);
  assert.match(c.out, /#1 2026-11-18 08:00 linear H-4 "Conflicted": \{"winner":"linear"/);
  assert.doesNotMatch(c.out, /#2 |#3 /);
  assert.match(run(w, m, ['task', 'conflicts', '--seen']).out, /marked 1 seen/);
  assert.match(run(w, m, ['task', 'conflicts']).out, /No unseen sync conflicts/);
  assert.doesNotMatch(run(w, m, ['boot', '--full']).out, /new sync conflict/);
});

test('boot with no key reads the snapshot and gives its age; with neither it says the list is unavailable and how writes still work', async () => {
  const m = await mock(), w = workspace();
  await m.seed('tasks', [task('H-1', 'Late one', { due_date: '2026-11-01T00:00:00+00:00' }), task('H-2', 'Later', {})]);
  run(w, m, ['task', 'list']);
  const later = new Date(Date.now() + 26 * 3600000).toISOString().slice(0, 19);
  const boot = run(w, null, ['boot', '--full'], { HAROLD_NOW: `${later}Z`, HAROLD_TZ: 'UTC' });
  assert.strictEqual(boot.code, 0, boot.all);
  assert.match(boot.out, /## Tasks \(Harold's own list\) — no database key here; snapshot 26h old \S*tasks-snapshot\.md, written by bin\/harold task list\)/);
  assert.match(boot.out, /Overdue 1 · /);
  assert.match(boot.out, /- H-1 \[pending, due 2026-11-01, medium\] Late one/);
  assert.doesNotMatch(boot.out, /new sync conflict/);
  fs.rmSync(path.join(w.ws, 'harold/tasks-snapshot.md'));
  const bare = run(w, null, ['boot', '--full']);
  assert.strictEqual(bare.code, 0, bare.all);
  assert.match(bare.out, /## Tasks \(Harold's own list\) — UNAVAILABLE: no SUPABASE_URL/);
  assert.match(bare.out, /task_create on the connector.*task create "<title>".* queues the write/);
});

test('the project is resolved as `harold where` does; a tie is refused and both are listed', () => {
  const w = workspace();
  const where = run(w, null, ['where', 'the launch']);
  assert.match(where.out, /^Alpha Launch/);
  assert.match(run(w, null, ['task', 'create', 'Launch task', '--project', 'the launch']).out, /queued Q-/);
  assert.strictEqual(queueRows(w)[0].payload.project, 'Alpha Launch', 'the canonical name is stored');
  fs.appendFileSync(path.join(w.ws, 'harold/projects.md'), '\n## Alpha Labs\n- folder: vault\n- status: active\n- type: workstream\n- aliases: alpha\n- keywords: lab\n');
  const amb = run(w, null, ['task', 'create', 'Ambiguous', '--project', 'alpha']);
  assert.strictEqual(amb.code, 2, amb.all);
  assert.match(amb.err, /more than one fits equally.*Alpha (Launch|Labs); Alpha (Launch|Labs)/);
  assert.match(run(w, null, ['task', 'create', 'Exact', '--project', 'alpha labs']).out, /queued Q-/, 'an exact name settles it');
});
