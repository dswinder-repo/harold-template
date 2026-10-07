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
const SKIP = new Set(['.git', 'node_modules', '.next', 'search.db', '.brief-job.json', '.brief-context.md', '.housekeeping-job.json', '.housekeeping-context.md', '.state']);
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
    .filter(f => /focus[ _]?area/i.test(fs.readFileSync(path.join(SRC, f), 'utf8')));
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
