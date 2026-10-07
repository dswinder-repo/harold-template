#!/usr/bin/env node
/*
 * Tests for the morning-brief gate in bin/harold (`brief start` / `brief status`).
 *
 *   node --test tests/brief-gate.test.js
 *
 * Each test runs bin/harold against a throwaway copy of this workspace, with HOME pointed at an empty
 * directory (so no real ~/.harold/env, CRM or Linear credentials are read) and HAROLD_NOW fixing the
 * clock. HAROLD_NOW without Z/offset is wall-clock time in HAROLD_TZ; with Z it is an absolute instant,
 * which is how the same moment is checked against different zones.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { SRC } = require('./fixture'); // this repository, or in a workspace the starter's content with its machinery (tests/fixture.js)
const SKIP = new Set(['.git', 'node_modules', 'search.db', '.brief-job.json', '.brief-context.md', '.housekeeping-job.json', '.housekeeping-context.md', '.last-boot']);

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-brief-gate-'));
  const ws = path.join(dir, 'ws'), home = path.join(dir, 'home');
  fs.mkdirSync(home);
  fs.cpSync(SRC, ws, { recursive: true, filter: s => !SKIP.has(path.basename(s)) && !/\/harold\/briefs\/\d{4}-\d{2}-\d{2}\.md$/.test(s) });
  spawnSync('git', ['init', '-q'], { cwd: ws });
  return { dir, ws, home };
}

function harold(w, args, env = {}) {
  const out = path.join(w.dir, `gh-output-${Math.random().toString(36).slice(2)}`);
  const clean = { ...process.env };
  for (const k of ['HAROLD_TZ', 'HAROLD_BRIEF_TIME', 'HAROLD_BRIEF_WINDOW_HOURS', 'HAROLD_NOW', 'GITHUB_ACTIONS', 'CLAUDE_CODE_REMOTE', 'GITHUB_OUTPUT', 'HAROLD_ROOT', 'CLAUDE_PROJECT_DIR']) delete clean[k];
  const r = spawnSync(process.execPath, [path.join(w.ws, 'bin/harold'), ...args], {
    cwd: w.ws, encoding: 'utf8', timeout: 120000,
    env: { ...clean, HOME: w.home, HAROLD_ENV_FILE: path.join(w.home, 'none'), GITHUB_OUTPUT: out, ...env },
  });
  let gh = ''; try { gh = fs.readFileSync(out, 'utf8'); } catch (_) {}
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', gh };
}
const status = (w, env) => harold(w, ['brief', 'status'], env);
const isDue = r => /Scheduled brief: DUE now/.test(r.out);
const notDue = r => /Scheduled brief: not due/.test(r.out);

const w = workspace();
test.after(() => fs.rmSync(w.dir, { recursive: true, force: true }));

test('before the brief time on a weekday: not due, exit 0, one quiet line', () => {
  const r = harold(w, ['brief', 'start'], { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-05T06:10:00' });
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /^NOT DUE: it is 06:10 in America\/Chicago; the brief is due at 06:30\./);
  assert.strictEqual(r.out.trim().split('\n').length, 1);
  assert.match(r.gh, /due=false/);
  assert.ok(!fs.existsSync(path.join(w.ws, 'harold/.brief-context.md')), 'nothing expensive ran');
});

test('at or after the brief time on a weekday with no draft: due', () => {
  assert.ok(isDue(status(w, { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-05T06:30:00' })));
  assert.ok(isDue(status(w, { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-05T09:15:00' })));
});

test('due: brief start writes the context and reports due=true', () => {
  const r = harold(w, ['brief', 'start'], { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-05T06:45:00' });
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /^START 2026-10-05/);
  assert.match(r.gh, /due=true/);
  assert.ok(fs.statSync(path.join(w.ws, 'harold/.brief-context.md')).size > 1000);
  // a second start in the same run (workflow step, then the prompt) keeps the first
  const again = harold(w, ['brief', 'start', '--ignore-time'], { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-05T06:50:00' });
  assert.match(again.out, /^START \(already started/);
  fs.rmSync(path.join(w.ws, 'harold/.brief-job.json'));
  fs.rmSync(path.join(w.ws, 'harold/.brief-context.md'));
});

test('--target=HH:MM (routines written for earlier versions) counts as --ignore-time', () => {
  const early = harold(w, ['brief', 'start', '--target=06:30'], { HAROLD_TZ: 'America/Chicago', HAROLD_BRIEF_TIME: '07:00', HAROLD_NOW: '2026-10-05T06:29:00' });
  assert.strictEqual(early.code, 0, early.out + early.err);
  assert.match(early.out, /^START 2026-10-05/);
  fs.rmSync(path.join(w.ws, 'harold/.brief-job.json'));
  fs.rmSync(path.join(w.ws, 'harold/.brief-context.md'));
});

test('weekend: not due, even after the brief time', () => {
  const sat = harold(w, ['brief', 'start'], { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-03T09:00:00' });
  assert.strictEqual(sat.code, 0);
  assert.match(sat.out, /^NOT DUE: it is Saturday in America\/Chicago/);
  assert.ok(notDue(status(w, { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-04T09:00:00' })));
});

test('--force overrides the weekend and the clock', () => {
  assert.ok(isDue(harold(w, ['brief', 'status'], { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-03T03:00:00' })) === false);
  const r = harold(w, ['brief', 'start', '--force'], { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-03T03:00:00' });
  assert.match(r.out, /^START 2026-10-03/);
  fs.rmSync(path.join(w.ws, 'harold/.brief-job.json'));
  fs.rmSync(path.join(w.ws, 'harold/.brief-context.md'));
});

test("today's draft already exists: not due", () => {
  const p = path.join(w.ws, 'harold/briefs/2026-10-05.md');
  fs.writeFileSync(p, '---\ndate: 2026-10-05\n---\n\nbrief\n');
  try {
    const r = harold(w, ['brief', 'start'], { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-05T07:00:00' });
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /^NOT DUE: today's brief \(harold\/briefs\/2026-10-05\.md\) already exists/);
    // the draft is keyed on the LOCAL date: the next local day in Tokyo is still due
    assert.ok(isDue(status(w, { HAROLD_TZ: 'Asia/Tokyo', HAROLD_BRIEF_TIME: '05:00', HAROLD_NOW: '2026-10-05T20:30:00Z' })));
  } finally { fs.rmSync(p); }
});

test('the same instant is judged in each HAROLD_TZ', () => {
  const at = { HAROLD_NOW: '2026-10-05T11:40:00Z' }; // Monday 11:40 UTC
  assert.ok(isDue(status(w, { ...at, HAROLD_TZ: 'America/Chicago' })), 'Chicago 06:40 → due');
  assert.ok(notDue(status(w, { ...at, HAROLD_TZ: 'America/Los_Angeles' })), 'Los Angeles 04:40 → before time');
  assert.ok(notDue(status(w, { ...at, HAROLD_TZ: 'Asia/Tokyo' })), 'Tokyo 20:40 → long past the window');
  assert.ok(isDue(status(w, { ...at, HAROLD_TZ: 'Asia/Tokyo', HAROLD_BRIEF_WINDOW_HOURS: '0' })), 'no window → due');
  const nz = status(w, { ...at, HAROLD_TZ: 'Pacific/Auckland' }); // Tuesday 00:40 local
  assert.ok(notDue(nz)); assert.match(nz.out, /2026-10-06/);
  // Sunday evening in UTC is Monday morning in Sydney
  assert.ok(isDue(status(w, { HAROLD_NOW: '2026-10-04T20:00:00Z', HAROLD_TZ: 'Australia/Sydney' })), 'Sydney Monday 07:00 → due');
  assert.ok(notDue(status(w, { HAROLD_NOW: '2026-10-04T20:00:00Z', HAROLD_TZ: 'UTC' })), 'UTC Sunday → weekend');
});

test('HAROLD_BRIEF_TIME moves the gate', () => {
  const env = { HAROLD_TZ: 'Europe/London', HAROLD_BRIEF_TIME: '08:00' };
  assert.ok(notDue(status(w, { ...env, HAROLD_NOW: '2026-10-05T07:59:00' })));
  assert.ok(isDue(status(w, { ...env, HAROLD_NOW: '2026-10-05T08:00:00' })));
  const bad = status(w, { ...env, HAROLD_BRIEF_TIME: '8am', HAROLD_NOW: '2026-10-05T06:31:00' });
  assert.ok(isDue(bad), 'an unreadable time falls back to 06:30');
});

test('settings are read from ~/.harold/env when not in the environment', () => {
  const envFile = path.join(w.home, 'harold-env');
  fs.writeFileSync(envFile, 'export HAROLD_TZ="Asia/Kolkata"\nHAROLD_BRIEF_TIME=09:00\n');
  const r = status(w, { HAROLD_ENV_FILE: envFile, HAROLD_NOW: '2026-10-05T09:05:00' });
  assert.ok(isDue(r)); assert.match(r.out, /HAROLD_TZ=Asia\/Kolkata \(set\), HAROLD_BRIEF_TIME=09:00/);
});

test('check warns when HAROLD_TZ is unset, on every machine (review X-02)', () => {
  const unset = JSON.parse(harold(w, ['check', '--json']).out);
  assert.ok(unset.warnings.some(x => /HAROLD_TZ is not set, so dates and the brief time follow this machine's zone/.test(x)), JSON.stringify(unset.warnings));
  const set = JSON.parse(harold(w, ['check', '--json'], { HAROLD_TZ: 'America/Chicago' }).out);
  assert.ok(!set.warnings.some(x => /HAROLD_TZ/.test(x)), JSON.stringify(set.warnings));
});

test('in GitHub Actions without HAROLD_TZ, say so clearly', () => {
  const r = status(w, { GITHUB_ACTIONS: 'true', TZ: 'UTC', HAROLD_NOW: '2026-10-05T11:00:00Z' });
  assert.match(r.out, /::warning::HAROLD_TZ is not set/);
  const bad = status(w, { HAROLD_TZ: 'Mars/Olympus', TZ: 'UTC', HAROLD_NOW: '2026-10-05T11:00:00Z' });
  assert.match(bad.err, /HAROLD_TZ "Mars\/Olympus" is not an IANA time zone name/);
});
