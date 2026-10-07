#!/usr/bin/env node
/*
 * Tests for the CRM pieces of the starter that need no database.
 *
 *   node --test tests/crm.test.js
 *
 * 1. One schema, one source: the web app's first migration is a byte-for-byte copy of
 *    tools/harold-mcp/schema.sql.
 * 2. HAROLD_NO_LOG_TYPES is optional and off by default: with it empty, a contact of any type is
 *    filed like everyone else; with it set, `harold file crm` refuses interactions for those types
 *    (records can still be updated) and `harold close` does not ask for them to be filed.
 *
 * Each workspace is a throwaway copy of this repository (its own git repo, no remote), with HOME
 * pointed at an empty directory so no real ~/.harold/env or CRM credentials are read.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = path.resolve(__dirname, '..');
const SKIP = new Set(['.git', 'node_modules', '.next', 'search.db', '.brief-job.json', '.brief-context.md', '.housekeeping-job.json', '.housekeeping-context.md', '.state', '.last-boot']);
const dirs = [];
test.after(() => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

const STRIP = ['HAROLD_ROOT', 'HAROLD_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'GITHUB_ACTIONS', 'CLAUDE_CODE_REMOTE', 'HAROLD_NOW', 'HAROLD_DETACHED', 'CURSOR_PROJECT_DIR', 'CURSOR_VERSION', 'HAROLD_NO_LOG_TYPES', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
function run(w, args, input, env = {}) {
  const clean = { ...process.env };
  STRIP.forEach(k => delete clean[k]);
  const r = spawnSync(process.execPath, [path.join(w.ws, 'bin/harold'), ...args], {
    cwd: w.ws, encoding: 'utf8', timeout: 120000, input: input === undefined ? '' : JSON.stringify(input),
    env: { ...clean, HOME: w.home, HAROLD_ENV_FILE: path.join(w.home, 'none'), ...env },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-crm-'));
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
const stop = id => ({ session_id: id, transcript_path: '/tmp/t.jsonl', cwd: '/tmp', hook_event_name: 'Stop', permission_mode: 'default', stop_hook_active: false });
const start = id => ({ session_id: id, transcript_path: '/tmp/t.jsonl', cwd: '/tmp', hook_event_name: 'SessionStart', permission_mode: 'default', source: 'startup' });
function teamCard(w, name) {
  fs.writeFileSync(path.join(w.ws, 'vault/people', `${name}.md`), `---\ntags: [person]\ntype: team\nlabels: []\ncompany: Example Co\nrole: Engineer\nwarmth:\nstatus: active\ncrm: yes\nlast_updated: ${w.today}\n---\n\n# ${name}\n\nColleague. Talked through the release plan.\n`);
  fs.writeFileSync(path.join(w.ws, `vault/daily/${w.today}-crm-test.md`), `# ${w.today} crm test\n\nTalked with ${name}.\n`);
}

test('the web app migration 001 is a byte-for-byte copy of tools/harold-mcp/schema.sql', () => {
  const schema = fs.readFileSync(path.join(SRC, 'tools/harold-mcp/schema.sql'));
  const copy = fs.readFileSync(path.join(SRC, 'tools/harold-crm/supabase/migrations/001_harold_core.sql'));
  assert.ok(schema.equals(copy), 'they differ: edit tools/harold-mcp/schema.sql, then copy it over tools/harold-crm/supabase/migrations/001_harold_core.sql');
});

test('HAROLD_NO_LOG_TYPES empty (the default): file crm queues an interaction for a contact of any type', () => {
  const w = workspace();
  teamCard(w, 'Sam Lee');
  const r = run(w, ['file', 'crm', JSON.stringify({ contact: 'Sam Lee', action: 'log_interaction', payload: { type: 'meeting', subject: 'Release plan' } })]);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /queued log_interaction for Sam Lee/);
});

test('HAROLD_NO_LOG_TYPES set: file crm refuses the interaction but still queues a record update', () => {
  const w = workspace();
  teamCard(w, 'Sam Lee');
  const env = { HAROLD_NO_LOG_TYPES: 'Team, advisor' };
  const refused = run(w, ['file', 'crm', JSON.stringify({ contact: 'Sam Lee', action: 'log_interaction', payload: { type: 'meeting', subject: 'Release plan' } })], undefined, env);
  assert.strictEqual(refused.code, 3);
  assert.match(refused.err, /REFUSED: Sam Lee is type: team/);
  const upsert = run(w, ['file', 'crm', JSON.stringify({ contact: 'Sam Lee', action: 'upsert_contact', payload: { role: 'Engineer' } })], undefined, env);
  assert.strictEqual(upsert.code, 0, upsert.err);
  assert.match(upsert.out, /queued upsert_contact for Sam Lee/);
});

test('close asks for a touched contact to be filed unless its type is in HAROLD_NO_LOG_TYPES', () => {
  const w = workspace();
  assert.strictEqual(run(w, ['boot', '--via=claude'], start('crm-1')).code, 0);
  teamCard(w, 'Sam Lee');
  const blocked = JSON.parse(run(w, ['close', '--via=claude'], stop('crm-1')).out);
  assert.strictEqual(blocked.decision, 'block', 'by default a team contact is filed like anyone else');
  assert.match(blocked.reason, /contact touched but not fully filed: Sam Lee/);

  const w2 = workspace();
  const env = { HAROLD_NO_LOG_TYPES: 'team' };
  const b = run(w2, ['boot', '--via=claude'], start('crm-2'), env);
  assert.strictEqual(b.code, 0, b.err);
  assert.match(b.out, /HAROLD_NO_LOG_TYPES \(team\) are never logged/);
  teamCard(w2, 'Sam Lee');
  const r = run(w2, ['close'], undefined, env);
  assert.strictEqual(r.code, 0, `${r.out}\n${r.err}`);
  assert.match(r.out, /Sam Lee: type team is in HAROLD_NO_LOG_TYPES/);
});

// Focus Area is retired. Nothing in the starter reads, writes or mentions it, except the migration that
// drops the column from databases created before it was retired, and that migration's test.
test('Focus Area is gone: only migration 007 (and its test) names it, to drop it', () => {
  const files = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: SRC, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
  const self = path.relative(SRC, __filename);
  const hits = files.filter(f => f !== self && f !== 'tools/harold-crm/supabase/migrations/007_drop_focus_area.sql' && f !== 'tools/harold-crm/scripts/test-migrations.mjs' && fs.existsSync(path.join(SRC, f)) && fs.statSync(path.join(SRC, f)).isFile())
    .filter(f => /focus[ _]?area/i.test(fs.readFileSync(path.join(SRC, f), 'utf8').replace(/007_drop_focus_area\.sql/g, '')));  // the migration's file name may be listed
  assert.deepStrictEqual(hits, []);
  assert.match(fs.readFileSync(path.join(SRC, 'tools/harold-crm/supabase/migrations/007_drop_focus_area.sql'), 'utf8'), /drop column if exists focus_area/);
});

// The app's migrations, applied to an in-memory Postgres (PGlite), including the upgrade of a database that
// predates 007. Needs the app's dev dependencies (cd tools/harold-crm && pnpm install); skipped without them.
test('CRM migrations apply, re-run, and upgrade an older database', { skip: !fs.existsSync(path.join(SRC, 'tools/harold-crm/node_modules/@electric-sql/pglite')) && 'run pnpm install in tools/harold-crm first' }, () => {
  const r = spawnSync(process.execPath, [path.join(SRC, 'tools/harold-crm/scripts/test-migrations.mjs')], { cwd: path.join(SRC, 'tools/harold-crm'), encoding: 'utf8', timeout: 180000 });
  assert.strictEqual(r.status, 0, (r.stdout || '').split('\n').filter(l => /FAIL/.test(l)).join('\n') + (r.stderr || '').slice(-2000));
  assert.match(r.stdout, /All checks passed/);
});

// The connector writes the CRM directly; a computer without CRM credentials cannot see that write, so the
// session records it. That counts as filed at close, and is never replayed.
test('a write made through the connector: file crm "applied":"connector" satisfies close and is never replayed', () => {
  const w = workspace();
  assert.strictEqual(run(w, ['boot', '--via=claude'], start('crm-conn')).code, 0);
  fs.writeFileSync(path.join(w.ws, 'vault/people', 'Ana Ruiz.md'), `---\ntags: [person]\ntype: partner\nlabels: []\ncompany: Example Co\nwarmth: Warm\nstatus: active\nlast_updated: ${w.today}\n---\n\n# Ana Ruiz\n\nIntro call about a pilot.\n`);
  fs.writeFileSync(path.join(w.ws, `vault/daily/${w.today}-crm-conn.md`), `# ${w.today}\n\nCall with Ana Ruiz.\n`);
  const blocked = JSON.parse(run(w, ['close', '--via=claude'], stop('crm-conn')).out);
  assert.strictEqual(blocked.decision, 'block');
  assert.match(blocked.reason, /"applied":"connector"/, 'the block says how to record a connector write');
  const rec = run(w, ['file', 'crm', JSON.stringify({ contact: 'Ana Ruiz', action: 'log_interaction', applied: 'connector' })]);
  assert.strictEqual(rec.code, 0, rec.err);
  assert.match(rec.out, /not replayed/);
  const q = fs.readFileSync(path.join(w.ws, 'harold/crm-queue.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(q[q.length - 1].replayed, true);
  assert.match(run(w, ['replay', '--dry-run']).out, /nothing|0 of 0|no queued/i);
  const ok = run(w, ['close', '--via=claude'], stop('crm-conn'));
  assert.strictEqual(ok.code, 0);
  assert.ok(!/"decision":"block"/.test(ok.out), ok.out);
  assert.strictEqual(run(w, ['file', 'crm', JSON.stringify({ contact: 'Ana Ruiz', action: 'upsert_contact', applied: 'yes' })]).code, 2);
});

// harold_cadence_check (harold-mcp) uses the connector's crm_stale rule (review Y-01): open pipeline entries only,
// and the skip types match the contact's one type, never its labels.
test('harold-mcp cadence rule: open pipeline entries only; skip types match the one type, never labels', async () => {
  const { staleFromRows, cadenceSkipTypes } = await import(path.join(SRC, 'tools/harold-mcp/cadence.js'));
  const now = new Date('2026-10-07T12:00:00Z');
  const ago = d => new Date(now.getTime() - d * 86400000).toISOString();
  const stages = [{ stage_name: 'Reached Out', default_cadence: 'weekly' }, { stage_name: 'Active', default_cadence: 'quarterly' }];
  const rows = [
    // 10 days quiet, Warm (14d). Its only weekly-cadence entry is closed: it must not tighten the threshold.
    { id: '1', name: 'Closed Entry', category: 'investor', warmth: 'Warm', contact_pipelines: [{ stage: 'Reached Out', closed_at: ago(20) }], interactions: [{ occurred_at: ago(10), type: 'call' }] },
    // The same with the entry open: weekly cadence, 10 days → stale.
    { id: '2', name: 'Open Entry', category: 'investor', warmth: 'Warm', contact_pipelines: [{ stage: 'Reached Out', closed_at: null }], interactions: [{ occurred_at: ago(10), type: 'call' }] },
    // Type "other" is skipped by default, whatever its labels say.
    { id: '3', name: 'Other With Label', category: 'other', warmth: 'Hot', contact_categories: [{ category_name: 'investor' }], interactions: [] },
    // A tracked type with an "other" label is still checked: labels never skip anyone.
    { id: '4', name: 'Investor Labelled Other', category: 'investor', warmth: 'Hot', contact_categories: [{ category_name: 'other' }], interactions: [{ occurred_at: ago(8), type: 'email' }] },
    // Cold or unset warmth: no nudge.
    { id: '5', name: 'Cold', category: 'investor', warmth: 'Cold', interactions: [] },
    // Lukewarm: twice the Warm threshold (28d).
    { id: '6', name: 'Lukewarm Recent', category: 'partner', warmth: 'Lukewarm', interactions: [{ occurred_at: ago(20), type: 'note' }] },
    { id: '7', name: 'Lukewarm Old', category: 'partner', warmth: 'Lukewarm', interactions: [{ occurred_at: ago(30), type: 'note' }] },
  ];
  const skipTypes = cadenceSkipTypes(undefined, ['team']);
  assert.deepStrictEqual(skipTypes, ['other', 'team']);
  const names = staleFromRows(rows, stages, { skipTypes, now }).map(c => c.name).sort();
  assert.deepStrictEqual(names, ['Investor Labelled Other', 'Lukewarm Old', 'Open Entry']);
  const open = staleFromRows(rows, stages, { skipTypes, now }).find(c => c.name === 'Open Entry');
  assert.strictEqual(open.threshold, 7); assert.match(open.basis, /stage Reached Out, weekly/);
  assert.deepStrictEqual(staleFromRows(rows, stages, { skipTypes, now, type: 'partner' }).map(c => c.name), ['Lukewarm Old']);
  assert.deepStrictEqual(cadenceSkipTypes('', []), [], 'HAROLD_NO_CADENCE_TYPES set empty tracks every type');
  // harold-mcp's server reads the rule from this module and asks for closed_at.
  const server = fs.readFileSync(path.join(SRC, 'tools/harold-mcp/server.js'), 'utf8');
  assert.match(server, /from "\.\/cadence\.js"/);
  assert.match(server, /contact_pipelines \( stage, purpose, project, closed_at \), interactions/);
});
