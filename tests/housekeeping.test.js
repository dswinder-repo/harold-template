#!/usr/bin/env node
/*
 * Tests for the housekeeping gate and job in bin/harold (`housekeeping start | finish | status`), and for
 * what sessions do with the three housekeeping triggers when harold/housekeeping.json says "cloud": true.
 *
 *   node --test tests/housekeeping.test.js
 *
 * Each workspace is a throwaway copy of this repository (its own git repo, no remote), with HOME pointed
 * at an empty directory (no real ~/.harold/env is read) and HAROLD_NOW fixing the clock. HAROLD_NOW
 * without Z/offset is wall-clock time in HAROLD_TZ; with Z it is an absolute instant, which is how the same
 * moment is judged in different zones.
 *
 * Calendar used below: 2026-10-02 Friday; 2026-10-30 Friday, the last business day of October (the 31st
 * is a Saturday); 2026-11-01 Sunday; 2027-01-01 Friday (the 1st and a Friday); 2026-05-29 Friday (May 31
 * is a Sunday); 2026-02-27 Friday (Feb 28 is a Saturday); 2027-01-29 Friday (Jan 31 is a Sunday);
 * 2026-09-30 Wednesday (a month that ends on a weekday).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = path.resolve(__dirname, '..');
const SKIP = new Set(['.git', 'node_modules', '.next', 'search.db', '.brief-job.json', '.brief-context.md', '.housekeeping-job.json', '.housekeeping-context.md', '.state', '.last-boot', 'harold-connector']);
const dirs = [];
test.after(() => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

function workspace({ cloud = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-housekeeping-'));
  dirs.push(dir);
  const ws = path.join(dir, 'ws'), home = path.join(dir, 'home');
  fs.mkdirSync(home);
  fs.cpSync(SRC, ws, { recursive: true, filter: s => !SKIP.has(path.basename(s)) && !/\/harold\/active-sessions\/[^/]+\.json$/.test(s) && !/\/harold\/briefs\/\d{4}-\d{2}-\d{2}\.md$/.test(s) && !/\/harold\/briefs\/housekeeping-notes\.md$/.test(s) });
  const cfg = path.join(ws, 'harold/housekeeping.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), cloud }, null, 2));
  // An install that has been running for a while (an empty log would mean "before the first boot": nothing due).
  fs.writeFileSync(path.join(ws, 'harold/trigger-log.jsonl'), JSON.stringify({ id: 'harold-start', status: 'ran', reason: 'test', date: '2026-01-01' }) + '\n');
  const g = (...a) => spawnSync('git', a, { cwd: ws, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 'test@example.com'); g('config', 'user.name', 'Test');
  g('add', '-A'); g('commit', '-qm', 'init');
  return { dir, ws, home, git: g };
}

const STRIP = ['HAROLD_JOB', 'HAROLD_TZ', 'HAROLD_NOW', 'HAROLD_ROOT', 'HAROLD_SESSION_ID', 'HAROLD_HOUSEKEEPING_JOB', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'GITHUB_ACTIONS', 'CLAUDE_CODE_REMOTE', 'GITHUB_OUTPUT', 'HAROLD_DETACHED'];
function harold(w, args, env = {}) {
  const out = path.join(w.dir, `gh-output-${Math.random().toString(36).slice(2)}`);
  const clean = { ...process.env };
  STRIP.forEach(k => delete clean[k]);
  const r = spawnSync(process.execPath, [path.join(w.ws, 'bin/harold'), ...args], {
    cwd: w.ws, encoding: 'utf8', timeout: 120000, input: '',
    env: { ...clean, HOME: w.home, HAROLD_ENV_FILE: path.join(w.home, 'none'), GITHUB_OUTPUT: out, ...env },
  });
  let gh = ''; try { gh = fs.readFileSync(out, 'utf8'); } catch (_) {}
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', gh };
}
// `housekeeping status` judges each job on its own; returns { 'weekly-scan': true|false, ... } (true = its day, not run yet)
function dueMap(w, env) {
  const r = harold(w, ['housekeeping', 'status'], env);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const m = {};
  for (const id of ['weekly-scan', 'full-audit', 'month-end']) {
    const line = r.out.split('\n').find(l => l.startsWith(`- ${id}:`));
    assert.ok(line, `no status line for ${id}:\n${r.out}`);
    m[id] = /its day today, not run yet/.test(line);
  }
  return m;
}
const dueJobs = (w, env) => Object.entries(dueMap(w, env)).filter(([, v]) => v).map(([k]) => k);
function clearJob(w) { for (const f of ['harold/.housekeeping-job.json', 'harold/.housekeeping-context.md']) fs.rmSync(path.join(w.ws, f), { force: true }); }

const w = workspace();

test('cloud off (the shipped default): start is not due, sessions keep the triggers', () => {
  const off = workspace({ cloud: false });
  const r = harold(off, ['housekeeping', 'start'], { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-02T09:00:00' });
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /^NOT DUE: cloud housekeeping is off/);
  assert.strictEqual(r.out.trim().split('\n').length, 1);
  assert.match(r.gh, /due=false/);
  assert.ok(!fs.existsSync(path.join(off.ws, 'harold/.housekeeping-context.md')), 'nothing expensive ran');
  const chk = JSON.parse(harold(off, ['check', '--json'], { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-02T09:00:00' }).out);
  assert.ok(chk.triggers.due.some(d => d.id === 'weekly-scan'), 'a Friday session is asked for the weekly scan');
  // the shipped file really is off
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(SRC, 'harold/housekeeping.json'), 'utf8')).cloud, false);
});

test('cloud on: sessions are never asked for the three jobs; boot says the cloud job runs them', () => {
  const env = { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-30T09:00:00' }; // Friday + last business day
  const chk = JSON.parse(harold(w, ['check', '--json'], env).out);
  const ids = [...chk.triggers.due, ...chk.triggers.overdue].map(d => d.id);
  for (const id of ['weekly-scan', 'full-audit', 'month-end']) assert.ok(!ids.includes(id), `${id} not demanded`);
  assert.ok(chk.triggers.info.some(i => /Housekeeping \(cloud job\): month-end is today's/.test(i)));
  assert.ok(chk.triggers.info.some(i => /Housekeeping \(cloud job\): weekly-scan is today's/.test(i)));
  assert.ok(chk.triggers.info.some(i => /Housekeeping \(cloud job\): Monthly full audit not run since 2026-10-01/.test(i)), 'a missed run is a note, not a demand');
});

test('weekly scan: Fridays in HAROLD_TZ, the same instant judged in each zone', () => {
  const weekly = env => dueMap(w, env)['weekly-scan'];
  const at = { HAROLD_NOW: '2026-10-02T03:00:00Z' }; // Friday 03:00 UTC
  assert.strictEqual(weekly({ ...at, HAROLD_TZ: 'America/Chicago' }), false, 'Chicago: Thursday 22:00');
  assert.strictEqual(weekly({ ...at, HAROLD_TZ: 'Pacific/Honolulu' }), false, 'Honolulu: Thursday 17:00');
  assert.strictEqual(weekly({ ...at, HAROLD_TZ: 'Europe/London' }), true, 'London: Friday 04:00');
  assert.strictEqual(weekly({ ...at, HAROLD_TZ: 'Asia/Tokyo' }), true, 'Tokyo: Friday 12:00');
  // Friday afternoon in UTC is already Saturday in Auckland
  assert.strictEqual(weekly({ HAROLD_NOW: '2026-10-02T13:00:00Z', HAROLD_TZ: 'Pacific/Auckland' }), false);
  assert.strictEqual(weekly({ HAROLD_NOW: '2026-10-02T13:00:00Z', HAROLD_TZ: 'UTC' }), true);
  assert.deepStrictEqual(dueJobs(w, { ...at, HAROLD_TZ: 'Europe/London' }), ['weekly-scan'], 'and nothing else that day');
});

test('full audit: the 1st in HAROLD_TZ', () => {
  const at = { HAROLD_NOW: '2026-11-01T02:00:00Z' };
  assert.deepStrictEqual(dueJobs(w, { ...at, HAROLD_TZ: 'America/New_York' }), [], 'New York: Saturday Oct 31');
  assert.deepStrictEqual(dueJobs(w, { ...at, HAROLD_TZ: 'America/Los_Angeles' }), [], 'Los Angeles: Oct 31');
  assert.deepStrictEqual(dueJobs(w, { ...at, HAROLD_TZ: 'Asia/Tokyo' }), ['full-audit'], 'Tokyo: Sunday Nov 1');
  assert.deepStrictEqual(dueJobs(w, { ...at, HAROLD_TZ: 'Pacific/Auckland' }), ['full-audit'], 'Auckland: Nov 1');
  assert.deepStrictEqual(dueJobs(w, { HAROLD_NOW: '2026-11-02T00:30:00', HAROLD_TZ: 'Europe/Berlin' }), [], 'the 2nd: not due');
});

test('month-end: the last business day, including months that end on a weekend', () => {
  const tz = { HAROLD_TZ: 'America/Chicago' };
  // October 2026 ends on a Saturday: Friday the 30th is the day (and a Friday, so the weekly scan too)
  assert.deepStrictEqual(dueJobs(w, { ...tz, HAROLD_NOW: '2026-10-30T01:00:00' }).sort(), ['month-end', 'weekly-scan']);
  assert.deepStrictEqual(dueJobs(w, { ...tz, HAROLD_NOW: '2026-10-31T01:00:00' }), [], 'Saturday the 31st is not');
  const r = harold(w, ['housekeeping', 'status'], { ...tz, HAROLD_NOW: '2026-10-31T01:00:00' });
  assert.match(r.out, /month-end: it is 2026-10-31; the month-end review runs on the last business day of the month \(2026-10-30\)/);
  assert.ok(dueJobs(w, { ...tz, HAROLD_NOW: '2026-05-29T12:00:00' }).includes('month-end'), 'May 2026 ends on a Sunday → Friday the 29th');
  assert.ok(!dueJobs(w, { ...tz, HAROLD_NOW: '2026-05-31T12:00:00' }).includes('month-end'));
  assert.ok(dueJobs(w, { ...tz, HAROLD_NOW: '2026-02-27T12:00:00' }).includes('month-end'), 'Feb 2026 ends on a Saturday → the 27th');
  assert.ok(dueJobs(w, { ...tz, HAROLD_NOW: '2026-09-30T12:00:00' }).includes('month-end'), 'a weekday month end is the day itself');
  assert.ok(!dueJobs(w, { ...tz, HAROLD_NOW: '2026-09-29T12:00:00' }).includes('month-end'));
  // January 2027 ends on a Sunday: the same instant is Friday the 29th in Los Angeles, Saturday the 30th in Tokyo
  const at = { HAROLD_NOW: '2027-01-30T01:00:00Z' };
  assert.ok(dueJobs(w, { ...at, HAROLD_TZ: 'America/Los_Angeles' }).includes('month-end'));
  assert.ok(!dueJobs(w, { ...at, HAROLD_TZ: 'Asia/Tokyo' }).includes('month-end'));
});

test('start: one job per run, the first due; a second start keeps it; a recorded job is done for the day', () => {
  const env = { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-30T01:00:00' };
  const r = harold(w, ['housekeeping', 'start'], env);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /^START month-end \(MONTH-END REVIEW\) 2026-10-30/);
  assert.match(r.gh, /due=true/); assert.match(r.gh, /job=month-end/);
  const ctx = fs.readFileSync(path.join(w.ws, 'harold/.housekeeping-context.md'), 'utf8');
  assert.ok(ctx.length > 1000);
  assert.match(ctx, /DUE {6}month-end/, 'inside the job, its context lists the job as due');
  const again = harold(w, ['housekeeping', 'start'], { ...env, HAROLD_NOW: '2026-10-30T01:05:00' });
  assert.match(again.out, /^START \(already started .*\) — job: month-end/);
  clearJob(w);
  harold(w, ['file', 'trigger', 'month-end', 'ran', 'test'], env);
  const next = harold(w, ['housekeeping', 'start'], { ...env, HAROLD_NOW: '2026-10-30T04:00:00' });
  assert.match(next.out, /^START weekly-scan/, 'the next wake-up takes the other job');
  clearJob(w);
  harold(w, ['file', 'trigger', 'weekly-scan', 'skipped', 'test'], env);
  const done = harold(w, ['housekeeping', 'start'], { ...env, HAROLD_NOW: '2026-10-30T07:00:00' });
  assert.match(done.out, /^NOT DUE: .*month-end: already ran today \(2026-10-30\).*weekly-scan: already skipped today/);
  clearJob(w);
});

test('a Friday that is the 1st: the full audit goes first', () => {
  const r = harold(w, ['housekeeping', 'start'], { HAROLD_TZ: 'Europe/London', HAROLD_NOW: '2027-01-01T01:00:00' });
  assert.match(r.out, /^START full-audit/);
  clearJob(w);
});

test('a named job, --force and bad input', () => {
  const env = { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-02T09:00:00' };
  const named = harold(w, ['housekeeping', 'start', 'full-audit'], env);
  assert.strictEqual(named.code, 0);
  assert.match(named.out, /^NOT DUE: full-audit: it is 2026-10-02; the full audit runs on the 1st of the month/);
  const forced = harold(w, ['housekeeping', 'start', 'full-audit', '--force'], env);
  assert.match(forced.out, /^START full-audit .*\n.*forced with --force/);
  clearJob(w);
  assert.strictEqual(harold(w, ['housekeeping', 'start', '--force'], env).code, 2, '--force needs a job');
  assert.strictEqual(harold(w, ['housekeeping', 'start', 'spring-clean'], env).code, 2);
});

test('finish: refuses until recorded and noted, then commits everything except runtime state', () => {
  const x = workspace();
  const env = { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-02T02:00:00' };
  assert.match(harold(x, ['housekeeping', 'start'], env).out, /^START weekly-scan/);
  const early = harold(x, ['housekeeping', 'finish'], env);
  assert.strictEqual(early.code, 2);
  assert.match(early.out, /not recorded/); assert.match(early.out, /no daily note/);
  fs.writeFileSync(path.join(x.ws, 'harold/weekly-summary.md'), '# Weekly summary\n\nAll quiet.\n');
  harold(x, ['file', 'daily', 'weekly-scan', 'Checked alerts, events, names.'], env);
  harold(x, ['file', 'trigger', 'weekly-scan', 'ran', 'clean'], env);
  const ok = harold(x, ['housekeeping', 'finish'], env);
  assert.strictEqual(ok.code, 0, ok.out + ok.err);
  assert.match(ok.out, /^FINISH ok: weekly-scan 2026-10-02, \d+ file\(s\) committed locally/);
  const files = x.git('show', '--name-only', '--format=%s', 'HEAD').stdout;
  assert.match(files, /^chore\(housekeeping\): weekly-scan 2026-10-02/);
  assert.match(files, /harold\/weekly-summary\.md/); assert.match(files, /vault\/daily\/2026-10-02-weekly-scan\.md/); assert.match(files, /harold\/trigger-log\.jsonl/);
  assert.doesNotMatch(files, /housekeeping-job|housekeeping-context|active-sessions/);
  assert.match(harold(x, ['housekeeping', 'finish'], env).out, /already saved/);
});

test('finish --anyway saves an unfinished job, notes it for the brief, and does not start it again today', () => {
  const x = workspace();
  const env = { HAROLD_TZ: 'Asia/Tokyo', HAROLD_NOW: '2026-11-01T03:00:00' };
  assert.match(harold(x, ['housekeeping', 'start'], env).out, /^START full-audit/);
  fs.writeFileSync(path.join(x.ws, 'vault/intel/half-done.md'), '---\ntags: [intel]\n---\n\npartial work\n');
  const r = harold(x, ['housekeeping', 'finish', '--anyway'], env);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /^FINISH saved UNFINISHED: full-audit 2026-11-01/);
  const notes = fs.readFileSync(path.join(x.ws, 'harold/briefs/housekeeping-notes.md'), 'utf8');
  assert.match(notes, /## New\n\n- 2026-11-01 full-audit: the unattended job ended unfinished/);
  assert.match(x.git('show', '--name-only', 'HEAD').stdout, /vault\/intel\/half-done\.md/);
  fs.rmSync(path.join(x.ws, 'harold/.housekeeping-job.json'));
  assert.match(harold(x, ['housekeeping', 'start'], { ...env, HAROLD_NOW: '2026-11-01T06:00:00' }).out, /^NOT DUE: .*full-audit: already skipped today/);
  // boot points at the waiting note
  assert.match(harold(x, ['boot'], { ...env, HAROLD_SESSION_ID: 'notes-check' }).out, /Housekeeping notes: 1 new/);
});

test('close inside a cloud job checks the job, not session filing, and saves it once everything is recorded', () => {
  const x = workspace();
  const env = { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-02T02:00:00', GITHUB_ACTIONS: 'true' };
  assert.match(harold(x, ['housekeeping', 'start'], env).out, /^START weekly-scan/);
  const blocked = harold(x, ['close'], env);
  assert.strictEqual(blocked.code, 2);
  assert.match(blocked.err, /HAROLD CLOSE \(housekeeping job weekly-scan 2026-10-02\): not finished/);
  harold(x, ['file', 'daily', 'weekly-scan', 'Scan done.'], env);
  harold(x, ['file', 'trigger', 'weekly-scan', 'ran', 'clean'], env);
  const ok = harold(x, ['close'], env);
  assert.strictEqual(ok.code, 0, ok.out + ok.err);
  assert.match(ok.out, /housekeeping job weekly-scan 2026-10-02 saved/);
  assert.match(x.git('log', '-1', '--format=%s').stdout, /^chore\(housekeeping\): weekly-scan 2026-10-02 \(github\)/);
  // a hook close after give-up attempts saves anyway (a cloud checkout is thrown away)
  const y = workspace();
  harold(y, ['housekeeping', 'start'], env);
  const hook = input => spawnSync(process.execPath, [path.join(y.ws, 'bin/harold'), 'close', '--via=claude'], { cwd: y.ws, encoding: 'utf8', input: JSON.stringify(input), env: { ...process.env, HOME: y.home, HAROLD_ENV_FILE: path.join(y.home, 'none'), ...env } });
  for (let i = 0; i < 2; i++) assert.match(hook({ session_id: 'hk', hook_event_name: 'Stop', stop_hook_active: i > 0 }).stdout, /"decision":"block"/);
  const last = hook({ session_id: 'hk', hook_event_name: 'Stop', stop_hook_active: true });
  assert.match(last.stdout, /systemMessage.*ended unfinished after 3 close checks/);
  assert.match(fs.readFileSync(path.join(y.ws, 'harold/briefs/housekeeping-notes.md'), 'utf8'), /weekly-scan: the unattended job ended unfinished/);
});

test('a scheduled job on a machine that is not a cloud runner: close runs in job mode while the job runs (review X-04)', () => {
  const env = { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-05T07:00:00', HAROLD_SESSION_ID: 'laptop-job' };  // a Monday, after 06:30
  // The morning brief, run by cron on a laptop or server: its marker shows it running.
  const x = workspace();
  assert.match(harold(x, ['brief', 'start'], env).out, /^START 2026-10-05 — runner: local/);
  const blocked = harold(x, ['close'], env);
  assert.strictEqual(blocked.code, 2, blocked.out + blocked.err);
  assert.match(blocked.err, /HAROLD CLOSE \(scheduled brief job 2026-10-05\): not finished/);
  assert.doesNotMatch(blocked.err, /knowledge file\(s\) changed|no session file/, 'job mode, not session filing');
  fs.writeFileSync(path.join(x.ws, 'harold/briefs/2026-10-05.md'), '---\ndate: 2026-10-05\n---\n\n# Brief\n\n' + 'A line of the brief.\n'.repeat(120));
  assert.match(harold(x, ['brief', 'finish'], env).out, /^FINISH ok/);
  const ok = harold(x, ['close'], env);
  assert.strictEqual(ok.code, 0, ok.out + ok.err);
  assert.match(ok.out, /brief job 2026-10-05 finished/, "the job agent's own last close, just after finishing");
  // Housekeeping the same way.
  const h = workspace();
  assert.match(harold(h, ['housekeeping', 'start', 'weekly-scan', '--force'], env).out, /^START weekly-scan/);
  const hb = harold(h, ['close'], env);
  assert.strictEqual(hb.code, 2, hb.out + hb.err);
  assert.match(hb.err, /HAROLD CLOSE \(housekeeping job weekly-scan 2026-10-05\): not finished/);
  // A not-due gate run did no work: there, a session's close stays a session's close, unless the scheduler says
  // it runs only jobs (HAROLD_JOB=1, as GitHub Actions and routines are taken to).
  const y = workspace();
  assert.match(harold(y, ['brief', 'start'], { ...env, HAROLD_NOW: '2026-10-05T06:10:00' }).out, /^NOT DUE/);
  const session = harold(y, ['close'], { ...env, HAROLD_NOW: '2026-10-05T06:12:00' });
  assert.strictEqual(session.code, 2);
  assert.match(session.err, /no session file found/, 'session filing applies');
  const job = harold(y, ['close'], { ...env, HAROLD_NOW: '2026-10-05T06:12:00', HAROLD_JOB: '1' });
  assert.strictEqual(job.code, 0, job.out + job.err);
  assert.match(job.out, /brief job 2026-10-05 not due/);
});

test('size budgets: a startup file over budget is a warning; housekeeping.json can override a budget', () => {
  const x = workspace();
  const env = { HAROLD_TZ: 'UTC', HAROLD_NOW: '2026-10-02T09:00:00' };
  assert.ok(!JSON.parse(harold(x, ['check', '--json'], env).out).warnings.some(m => /over its/.test(m)), 'the starter is under budget');
  fs.appendFileSync(path.join(x.ws, 'memory/CLAUDE.md'), '\n' + 'x'.repeat(12000) + '\n');
  assert.ok(JSON.parse(harold(x, ['check', '--json'], env).out).warnings.some(m => /memory\/CLAUDE\.md is \d+k chars, over its 10k budget/.test(m)));
  const cfg = path.join(x.ws, 'harold/housekeeping.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), size_budgets: { 'memory/CLAUDE.md': 20000 } }));
  assert.ok(!JSON.parse(harold(x, ['check', '--json'], env).out).warnings.some(m => /over its/.test(m)));
});
