#!/usr/bin/env node
/*
 * Tests for `harold update` (bringing Harold's own files up to the starter) and for harold/settings.env (the
 * committed, non-secret settings file).
 *
 *   node --test tests/update.test.js
 *
 * The "starter" is a throwaway copy of this repository committed into a local bare repository; the workspace is
 * another copy with its own unrelated history, the way "Use this template" creates one. HOME points at an empty
 * directory so no real ~/.harold/env is read.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { SRC } = require('./fixture'); // this repository, or in a workspace the starter's content with its machinery (tests/fixture.js)
const SKIP = new Set(['.git', 'node_modules', '.next', 'search.db', '.brief-job.json', '.brief-context.md', '.housekeeping-job.json', '.housekeeping-context.md', '.state', '.last-boot', 'harold-connector', 'harold-crm', '__pycache__']);
const copyFilter = s => !SKIP.has(path.basename(s)) && !/\/harold\/active-sessions\/[^/]+\.json$/.test(s) && !/\/harold\/briefs\/\d{4}-\d{2}-\d{2}\.md$/.test(s) && !/\.upstream$/.test(s);
const dirs = [];
test.after(() => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

const STRIP = ['HAROLD_ROOT', 'HAROLD_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'GITHUB_ACTIONS', 'CLAUDE_CODE_REMOTE', 'HAROLD_NOW', 'HAROLD_DETACHED', 'HAROLD_NO_LOG_TYPES', 'HAROLD_TZ', 'HAROLD_JOB', 'HAROLD_BRIEF_TIME', 'HAROLD_UPDATE_CHECK', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
function gitIn(cwd) { return (...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '').trim(), err: r.stderr || '' }; }; }
function harold(ws, home, args, env = {}, input = '') {
  const clean = { ...process.env };
  STRIP.forEach(k => delete clean[k]);
  const r = spawnSync(process.execPath, [path.join(ws, 'bin/harold'), ...args], { cwd: ws, encoding: 'utf8', timeout: 120000, input, env: { ...clean, HOME: home, HAROLD_ENV_FILE: path.join(home, 'none'), ...env } });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const read = p => fs.readFileSync(p, 'utf8');
const write = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };

// A starter (working copy + bare remote) and a workspace made from it with unrelated history.
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-update-'));
  dirs.push(dir);
  const up = path.join(dir, 'starter'), bare = path.join(dir, 'starter.git'), ws = path.join(dir, 'ws'), home = path.join(dir, 'home');
  fs.mkdirSync(home);
  fs.cpSync(SRC, up, { recursive: true, filter: copyFilter });
  const u = gitIn(up);
  u('init', '-q', '-b', 'main'); u('config', 'user.email', 't@example.com'); u('config', 'user.name', 'T');
  u('add', '-A'); u('commit', '-qm', 'v1');
  spawnSync('git', ['clone', '-q', '--bare', up, bare]);
  u('remote', 'add', 'origin', bare);
  fs.cpSync(up, ws, { recursive: true, filter: s => path.basename(s) !== '.git' });
  const g = gitIn(ws);
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  g('add', '-A'); g('commit', '-qm', 'my workspace');
  const commitUp = msg => { u('add', '-A'); u('commit', '-qm', msg); u('push', '-q', 'origin', 'main'); return u('rev-parse', 'HEAD').out; };
  return { dir, up, bare, ws, home, u, g, commitUp };
}

test('update: unedited machinery is updated, new files added, removed ones removed; content, edits and AGENTS.md are safe', () => {
  const s = setup();
  const P = r => path.join(s.ws, r), U = r => path.join(s.up, r);
  // The starter moves on.
  write(U('bin/harold-linear'), read(U('bin/harold-linear')) + '\n// v2\n');
  write(U('tools/harness-hooks/new-harness.json'), '{"v":2}\n');
  fs.rmSync(U('tools/visualizer'), { recursive: true });
  const pb = 'playbook/core/' + fs.readdirSync(U('playbook/core')).filter(f => f.endsWith('.md') && f !== 'README.md')[0];
  write(U(pb), read(U(pb)) + '\nStarter v2 step.\n');
  write(U('AGENTS.md'), read(U('AGENTS.md')) + '\nStarter v2 rule.\n');
  write(U('memory/CLAUDE.md'), 'starter content that must never reach a workspace\n');
  write(U('harold/learnings.jsonl'), '');
  write(U('bin/harold-index'), read(U('bin/harold-index')));
  const v2 = s.commitUp('v2');
  // The operator's own edits and content.
  write(P(pb), read(P(pb)) + '\nMy own step.\n');
  write(P('AGENTS.md'), read(P('AGENTS.md')).replace('[YOUR NAME]', 'Pat Doe'));
  const memBefore = read(P('memory/CLAUDE.md')), learnBefore = read(P('harold/learnings.jsonl'));
  s.g('commit', '-qam', 'my edits');

  const dry = harold(s.ws, s.home, ['update', '--dry-run', '--from', s.bare]);
  assert.strictEqual(dry.code, 0, dry.err);
  assert.match(dry.out, /--dry-run \(nothing changed\)/);
  assert.match(dry.out, /would be updated \(\d+\):[\s\S]*bin\/harold-linear/);
  assert.match(dry.out, /NEEDS MERGE[\s\S]*would be written to/);
  assert.strictEqual(s.g('status', '--porcelain').out, '', 'a dry run changes nothing');

  const r = harold(s.ws, s.home, ['update', '--from', s.bare]);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(read(P('bin/harold-linear')), read(U('bin/harold-linear')), 'unedited machinery is updated');
  assert.ok(fs.statSync(P('bin/harold-linear')).mode & 0o100, 'executable bit kept');
  assert.strictEqual(read(P('tools/harness-hooks/new-harness.json')), '{"v":2}\n', 'new machinery is added');
  assert.ok(!fs.existsSync(P('tools/visualizer')) || !fs.readdirSync(P('tools/visualizer')).length, 'machinery the starter removed is removed');
  assert.match(r.out, /removed \(the starter removed them; unedited here\)/);
  // Edited here and changed upstream: never overwritten; the starter's copy lands beside it.
  assert.match(read(P(pb)), /My own step\./);
  assert.ok(!/Starter v2 step/.test(read(P(pb))));
  assert.match(read(P(pb + '.upstream')), /Starter v2 step\./);
  assert.match(r.out, new RegExp(`NEEDS MERGE[\\s\\S]*${pb.replace(/[.]/g, '\\.')}`));
  // AGENTS.md is the operator's: never overwritten, the starter's copy beside it.
  assert.match(read(P('AGENTS.md')), /Pat Doe/);
  assert.match(read(P('AGENTS.md.upstream')), /Starter v2 rule\./);
  assert.match(r.out, /AGENTS\.md is yours and never overwritten/);
  // Content is never touched, whatever the starter did to its own copy.
  assert.strictEqual(read(P('memory/CLAUDE.md')), memBefore);
  assert.strictEqual(read(P('harold/learnings.jsonl')), learnBefore);
  // The record: the starter commit applied; url and ref stay as configured (--from is a one-off).
  const rec = JSON.parse(read(P('harold/upstream.json')));
  assert.strictEqual(rec.commit, v2);
  assert.strictEqual(rec.url, 'https://github.com/dswinder-repo/harold-template.git');
  assert.strictEqual(rec.ref, 'main');
  // check lists what waits for a hand merge.
  const c = harold(s.ws, s.home, ['check']);
  assert.match(c.out, /WARN  2 file\(s\) from bin\/harold update wait for a hand merge: .*AGENTS\.md\.upstream/);
  // Nothing was committed by update itself, and the starter's refs are not branches.
  assert.notStrictEqual(s.g('status', '--porcelain').out, '');
  assert.ok(!/upstream/.test(s.g('branch', '-a').out));
});

test('update with a recorded base: local edits to files the starter did not change are kept quietly; merged copies are cleaned up', () => {
  const s = setup();
  const P = r => path.join(s.ws, r), U = r => path.join(s.up, r);
  assert.strictEqual(harold(s.ws, s.home, ['update', '--from', s.bare]).code, 0);
  assert.strictEqual(JSON.parse(read(P('harold/upstream.json'))).commit, s.u('rev-parse', 'HEAD').out);
  s.g('add', '-A'); s.g('commit', '-qm', 'recorded');
  // Edited here; the starter changes something else.
  write(P('bin/harold-setup-crm'), read(P('bin/harold-setup-crm')) + '\n# mine\n');
  write(U('bin/harold-mcp'), read(U('bin/harold-mcp')) + '\n# v3\n');
  write(U('vault/templates/daily.md'), read(U('vault/templates/daily.md')) + '\nv3 line\n');
  const v3 = s.commitUp('v3');
  const r = harold(s.ws, s.home, ['update', '--from', s.bare]);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /kept: your edits, unchanged in the starter \(1\):\n  bin\/harold-setup-crm/);
  assert.match(read(P('bin/harold-setup-crm')), /# mine/);
  assert.ok(!fs.existsSync(P('bin/harold-setup-crm.upstream')));
  assert.match(read(P('bin/harold-mcp')), /# v3/);
  assert.match(read(P('vault/templates/daily.md')), /v3 line/);
  assert.ok(!fs.existsSync(P('AGENTS.md.upstream')), 'AGENTS.md unchanged in the starter: no copy');
  assert.strictEqual(JSON.parse(read(P('harold/upstream.json'))).commit, v3);
  // An edited file the starter then changes gets a .upstream copy; once merged to match, the next update removes it.
  write(U('bin/harold-setup-crm'), read(U('bin/harold-setup-crm')) + '\n# v4\n');
  s.commitUp('v4');
  harold(s.ws, s.home, ['update', '--from', s.bare]);
  assert.ok(fs.existsSync(P('bin/harold-setup-crm.upstream')));
  fs.copyFileSync(P('bin/harold-setup-crm.upstream'), P('bin/harold-setup-crm'));
  const again = harold(s.ws, s.home, ['update', '--from', s.bare]);
  assert.match(again.out, /stale \.upstream copies/);
  assert.ok(!fs.existsSync(P('bin/harold-setup-crm.upstream')));
  assert.match(again.out, /Everything Harold owns already matches the starter|deleted/);
});

test('update: seeds are created only when missing; "skip" in upstream.json keeps a path out; settings.env is never overwritten', () => {
  const s = setup();
  const P = r => path.join(s.ws, r), U = r => path.join(s.up, r);
  fs.rmSync(P('harold/housekeeping.json'));
  write(P('harold/settings.env'), 'HAROLD_TZ="Europe/Lisbon"\n');
  const rec = JSON.parse(read(P('harold/upstream.json'))); rec.skip = ['tools/harness-hooks/']; write(P('harold/upstream.json'), JSON.stringify(rec));
  s.g('add', '-A'); s.g('commit', '-qm', 'local');
  write(U('tools/harness-hooks/added.json'), '{}\n');
  write(U('harold/settings.env'), 'HAROLD_TZ="America/Chicago"\n');
  s.commitUp('v2');
  const r = harold(s.ws, s.home, ['update', '--from', s.bare]);
  assert.strictEqual(r.code, 0, r.err);
  assert.ok(fs.existsSync(P('harold/housekeeping.json')), 'a missing seed is created');
  assert.match(r.out, /added \(seed: yours from now on\) \(1\):\n  harold\/housekeeping\.json/);
  assert.strictEqual(read(P('harold/settings.env')), 'HAROLD_TZ="Europe/Lisbon"\n');
  assert.ok(!fs.existsSync(P('tools/harness-hooks/added.json')), 'skipped path untouched');
  assert.deepStrictEqual(JSON.parse(read(P('harold/upstream.json'))).skip, ['tools/harness-hooks/'], 'skip survives the record');
});

test('update fails cleanly when the starter cannot be fetched or has no manifest', () => {
  const s = setup();
  const bad = harold(s.ws, s.home, ['update', '--from', path.join(s.dir, 'nope.git')]);
  assert.strictEqual(bad.code, 2);
  assert.match(bad.err, /could not fetch/);
  fs.rmSync(path.join(s.up, 'harold/update-manifest.txt')); s.commitUp('no manifest');
  const r = harold(s.ws, s.home, ['update', '--from', s.bare]);
  assert.strictEqual(r.code, 2);
  assert.match(r.err, /has no harold\/update-manifest\.txt/);
  assert.strictEqual(s.g('status', '--porcelain').out, '');
});

test('boot says, in one line, when the starter has moved past the recorded update (never in jobs)', () => {
  const s = setup();
  const P = r => path.join(s.ws, r);
  const v1 = s.u('rev-parse', 'HEAD').out;
  write(P('harold/upstream.json'), JSON.stringify({ url: s.bare, ref: 'main', commit: v1, date: '2026-10-01' }));
  const start = id => JSON.stringify({ session_id: id, transcript_path: '/tmp/t.jsonl', cwd: '/tmp', hook_event_name: 'SessionStart', source: 'startup' });
  let b = harold(s.ws, s.home, ['boot', '--via=claude'], {}, start('u1'));
  assert.ok(!/Harold update available/.test(b.out), 'current: no line');
  write(path.join(s.up, 'bin/harold-mcp'), read(path.join(s.up, 'bin/harold-mcp')) + '\n# v2\n');
  const v2 = s.commitUp('v2');
  fs.rmSync(P('harold/active-sessions/.state/upstream-check.json'), { force: true });
  b = harold(s.ws, s.home, ['boot', '--via=claude'], {}, start('u2'));
  assert.match(b.out, new RegExp(`Harold update available: the starter's main is at ${v2.slice(0, 7)}; this workspace last updated from ${v1.slice(0, 7)} on 2026-10-01`));
  // Cached: no second look at the remote within the window (the cache is what is read).
  const cache = JSON.parse(read(P('harold/active-sessions/.state/upstream-check.json')));
  assert.strictEqual(cache.sha, v2);
  fs.rmSync(P('harold/active-sessions/.state/upstream-check.json'), { force: true });
  const job = harold(s.ws, s.home, ['boot', '--via=claude'], { HAROLD_JOB: '1' }, start('u3'));
  assert.ok(!/Harold update available/.test(job.out), 'scheduled jobs never check');
  assert.ok(!fs.existsSync(P('harold/active-sessions/.state/upstream-check.json')));
  // An unreachable starter: boot goes on, says nothing.
  write(P('harold/upstream.json'), JSON.stringify({ url: path.join(s.dir, 'gone.git'), ref: 'main', commit: v1 }));
  b = harold(s.ws, s.home, ['boot', '--via=claude'], {}, start('u4'));
  assert.strictEqual(b.code, 0);
  assert.ok(!/Harold update available/.test(b.out));
});

// ───────────── harold/settings.env ─────────────
function plainWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-settings-'));
  dirs.push(dir);
  const ws = path.join(dir, 'ws'), home = path.join(dir, 'home');
  fs.mkdirSync(home);
  fs.cpSync(SRC, ws, { recursive: true, filter: copyFilter });
  const g = gitIn(ws);
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T'); g('add', '-A'); g('commit', '-qm', 'init');
  return { dir, ws, home, g };
}
const teamCard = (ws, name, fm) => write(path.join(ws, 'vault/people', `${name}.md`), `---\ntags: [person]\n${fm}\ncompany: Example Co\nstatus: active\n---\n\n# ${name}\n`);
const logRow = name => ['file', 'crm', JSON.stringify({ contact: name, action: 'log_interaction', payload: { type: 'meeting', subject: 'Weekly sync' } })];

test('settings.env: committed, and read for HAROLD_* settings; the environment and ~/.harold/env override it', () => {
  const w = plainWorkspace();
  assert.notStrictEqual(w.g('check-ignore', '-q', 'harold/settings.env').code, 0, 'harold/settings.env must not be gitignored (it is a *.env file)');
  write(path.join(w.ws, 'harold/settings.env'), '# mine\nHAROLD_TZ="Asia/Tokyo"\nexport HAROLD_NO_LOG_TYPES="team"\n');
  teamCard(w.ws, 'Sam Lee', 'type: team\nlabels: []');
  assert.match(harold(w.ws, w.home, ['check']).out, /^harold check — .* Asia\/Tokyo$/m);
  assert.match(harold(w.ws, w.home, ['check'], { HAROLD_TZ: 'Europe/London' }).out, /Europe\/London$/m, 'the environment wins');
  const refused = harold(w.ws, w.home, logRow('Sam Lee'));
  assert.strictEqual(refused.code, 3, 'HAROLD_NO_LOG_TYPES from settings.env is enforced with nothing set on the machine');
  assert.match(refused.err, /REFUSED: Sam Lee is type: team/);
  assert.strictEqual(harold(w.ws, w.home, logRow('Sam Lee'), { HAROLD_NO_LOG_TYPES: 'investor' }).code, 0, 'environment overrides');
  write(path.join(w.home, 'env'), 'export HAROLD_NO_LOG_TYPES="partner"\n');
  assert.strictEqual(harold(w.ws, w.home, logRow('Sam Lee'), { HAROLD_ENV_FILE: path.join(w.home, 'env') }).code, 0, '~/.harold/env overrides');
});

test('settings.env: a label counts like a type; credential-like names are never read, and a key there is refused at commit', () => {
  const w = plainWorkspace();
  write(path.join(w.ws, 'harold/settings.env'), 'HAROLD_NO_LOG_TYPES="team"\nSUPABASE_URL="https://x.supabase.co"\nHAROLD_API_KEY="x"\n');
  teamCard(w.ws, 'Jo Park', 'type: partner\nlabels: [ecosystem, team]');
  teamCard(w.ws, 'Al Diaz', 'type: partner\nlabels:\n  - team');
  teamCard(w.ws, 'Ana Ruiz', 'type: partner\nlabels: [ecosystem]');
  const jo = harold(w.ws, w.home, logRow('Jo Park'));
  assert.strictEqual(jo.code, 3); assert.match(jo.err, /REFUSED: Jo Park is labelled: team/);
  assert.strictEqual(harold(w.ws, w.home, logRow('Al Diaz')).code, 3, 'a YAML block list counts');
  assert.strictEqual(harold(w.ws, w.home, logRow('Ana Ruiz')).code, 0);
  const c = harold(w.ws, w.home, ['check']);
  assert.match(c.out, /settings\.env is committed, so only non-secret HAROLD_\* settings are read from it; ignored: SUPABASE_URL, HAROLD_API_KEY/);
  write(path.join(w.ws, 'harold/settings.env'), 'HAROLD_TZ="UTC"\nSUPABASE_SERVICE_ROLE_KEY="sb_secret_abcdefghijklmnopqrstuvwxyz"\n');
  assert.match(harold(w.ws, w.home, ['check']).out, /looks like it holds a credential/);
  const close = harold(w.ws, w.home, ['close', '--final']);
  assert.match(close.out + close.err, /refusing to commit: possible secrets in harold\/settings\.env/);
  assert.match(w.g('status', '--porcelain').out, /settings\.env/, 'not committed');
});

test('HAROLD_CHECKS: a workspace script that exits non-zero becomes one warning; one outside the workspace is refused', () => {
  const w = plainWorkspace();
  write(path.join(w.ws, 'bin/my-check'), '#!/bin/sh\necho "checked 3 pages"\necho "2 finding(s), 1 high severity."\nexit 1\n');
  fs.chmodSync(path.join(w.ws, 'bin/my-check'), 0o755);
  write(path.join(w.ws, 'bin/ok-check'), '#!/bin/sh\necho fine\n');
  fs.chmodSync(path.join(w.ws, 'bin/ok-check'), 0o755);
  write(path.join(w.ws, 'harold/settings.env'), 'HAROLD_CHECKS="bin/my-check --quiet, bin/ok-check, /bin/true"\n');
  const c = harold(w.ws, w.home, ['check']);
  assert.match(c.out, /WARN  bin\/my-check: 2 finding\(s\), 1 high severity\./);
  assert.ok(!/ok-check/.test(c.out));
  assert.match(c.out, /HAROLD_CHECKS: \/bin\/true is not a script inside the workspace/);
  assert.match(c.out, /RESULT: PASS/);
});

test('the manifest never claims the operator\'s content, and every path it names exists in the starter', () => {
  const man = read(path.join(SRC, 'harold/update-manifest.txt')).split('\n').map(l => l.replace(/#.*$/, '').trim()).filter(Boolean);
  const own = man.filter(l => !l.startsWith('!') && !l.startsWith('seed '));
  for (const p of own) {
    assert.ok(!/^(vault\/(?!templates\/)|memory\/|dashboard\/|raw\/|AGENTS\.md$|harold\/(learnings|blockers|alerts|events|facts|projects|crm-queue|trigger-log|settings|upstream)\b)/.test(p), `manifest claims content: ${p}`);
    assert.ok(fs.existsSync(path.join(SRC, p.replace(/\*.*$/, ''))), `manifest names a path the starter does not have: ${p}`);
  }
  const rec = JSON.parse(read(path.join(SRC, 'harold/upstream.json')));
  assert.strictEqual(rec.ref, 'main');
  assert.strictEqual(rec.commit, null, 'the starter ships with no recorded update');
});
