#!/usr/bin/env node
/*
 * Tests for a workspace that has not been set up yet, and for the rule that Harold never pushes to the public
 * starter.
 *
 *   node --test tests/setup.test.js
 *
 * Boot names an unset workspace (placeholders left, HAROLD_TZ unset, origin still the public starter) in one
 * short block that points at playbook/core/setup.md. Close, brief finish and housekeeping finish refuse to push
 * while origin is the public starter (https, ssh, a trailing .git or slash, or the URL in harold/upstream.json):
 * the work is committed locally, the command exits 1, and no push is attempted. To prove that last part, each
 * workspace rewrites pushes to the starter URL into a local bare repository (url.<bare>.pushInsteadOf), so an
 * attempted push would land there, and GIT_ALLOW_PROTOCOL=file keeps every fetch off the network.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { SRC } = require('./fixture');
const SKIP = new Set(['.git', 'node_modules', '.next', 'search.db', '.brief-job.json', '.brief-context.md', '.housekeeping-job.json', '.housekeeping-context.md', '.state', '.last-boot', 'harold-connector', 'harold-crm']);
// The public starter, as harold/upstream.json names it (https://<host>/<owner>/<repo>.git), and its other spellings.
const STARTER = JSON.parse(fs.readFileSync(path.join(SRC, 'harold/upstream.json'), 'utf8')).url;
const [, HOST, OWNER_REPO] = STARTER.match(/^https:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/);
const dirs = [];
test.after(() => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

const STRIP = ['HAROLD_JOB', 'HAROLD_TZ', 'HAROLD_NOW', 'HAROLD_ROOT', 'HAROLD_SESSION_ID', 'HAROLD_HOUSEKEEPING_JOB', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'GITHUB_ACTIONS', 'CLAUDE_CODE_REMOTE', 'GITHUB_OUTPUT', 'HAROLD_DETACHED', 'CURSOR_PROJECT_DIR', 'CURSOR_VERSION'];
function harold(w, args, env = {}) {
  const clean = { ...process.env };
  STRIP.forEach(k => delete clean[k]);
  const r = spawnSync(process.execPath, [path.join(w.ws, 'bin/harold'), ...args], {
    cwd: w.ws, encoding: 'utf8', timeout: 120000, input: '',
    env: { ...clean, HOME: w.home, HAROLD_ENV_FILE: path.join(w.home, 'none'), GIT_ALLOW_PROTOCOL: 'file', GITHUB_OUTPUT: path.join(w.dir, 'gh-output'), ...env },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// origin: the URL origin points at. pushTrap: the URL whose pushes are rewritten into the local bare repository.
function workspace({ origin = STARTER, pushTrap = origin, cloud = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-setup-'));
  dirs.push(dir);
  const ws = path.join(dir, 'ws'), home = path.join(dir, 'home'), bare = path.join(dir, 'trap.git');
  fs.mkdirSync(home);
  fs.cpSync(SRC, ws, { recursive: true, filter: s => !SKIP.has(path.basename(s)) && !/\/harold\/active-sessions\/[^/]+\.json$/.test(s) && !/\/harold\/briefs\/\d{4}-\d{2}-\d{2}\.md$/.test(s) && !/\/harold\/briefs\/housekeeping-notes\.md$/.test(s) });
  const cfg = path.join(ws, 'harold/housekeeping.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), cloud }, null, 2));
  fs.writeFileSync(path.join(ws, 'harold/trigger-log.jsonl'), JSON.stringify({ id: 'harold-start', status: 'ran', reason: 'test', date: '2026-01-01' }) + '\n');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  const g = (...a) => spawnSync('git', a, { cwd: ws, encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'test@example.com'); g('config', 'user.name', 'Test');
  g('add', '-A'); g('commit', '-qm', 'init');
  g('remote', 'add', 'origin', origin);
  g('config', `url.${bare}.pushInsteadOf`, pushTrap);
  return { dir, ws, home, bare, g, head: () => g('rev-parse', 'HEAD').stdout.trim() };
}
const trapRefs = w => spawnSync('git', ['--git-dir', w.bare, 'for-each-ref'], { encoding: 'utf8' }).stdout.trim();
function closeAfterWork(w, env) {
  harold(w, ['boot'], env);
  const chk = JSON.parse(harold(w, ['check', '--json'], env).out);
  for (const d of [...chk.triggers.due, ...chk.triggers.overdue]) harold(w, ['file', 'trigger', d.id, 'ran', 'test'], env);
  fs.writeFileSync(path.join(w.ws, `vault/daily/${chk.today.iso}-setup-test.md`), `# ${chk.today.iso} setup test\n\nChanged something worth saving.\n`);
  const before = w.head();
  const r = harold(w, ['close'], env);
  return { r, before };
}
const REFUSAL = /NOT PUSHED: origin is the public Harold starter \([^)]+\), so nothing was pushed; your work is committed locally only\. Make your own private copy[\s\S]*playbook\/core\/setup\.md/;

test('boot names an unset workspace at the top and points at the setup playbook', () => {
  const w = workspace();
  const r = harold(w, ['boot']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /^# HAROLD BOOTED/);
  const top = r.out.split('\n').slice(0, 8).join('\n');
  assert.match(top, /⚠ NOT SET UP YET: /);
  assert.match(top, /\[YOUR \.\.\.\] placeholder\(s\) left in \d+ file\(s\) \(AGENTS\.md/);
  assert.match(top, /HAROLD_TZ is not set/);
  assert.match(top, /origin is still the public starter/);
  assert.match(top, /playbook\/core\/setup\.md/);
});

test('the notice names only what is left, and disappears once the workspace is set up', () => {
  const w = workspace({ origin: path.join(os.tmpdir(), 'someone', 'my-harold.git') });
  fs.appendFileSync(path.join(w.ws, 'harold/settings.env'), '\nHAROLD_TZ="Europe/London"\n');
  let r = harold(w, ['boot']);
  assert.match(r.out, /⚠ NOT SET UP YET: [^\n]*placeholder/);
  assert.doesNotMatch(r.out, /HAROLD_TZ is not set|origin is still the public starter/);
  const re = /\[(?:LIST )?YOUR [^\]\n]*\]/g;
  for (const d of ['AGENTS.md', 'memory', 'dashboard', 'playbook', 'harold']) {
    const p = path.join(w.ws, d);
    const files = fs.statSync(p).isDirectory() ? fs.readdirSync(p, { recursive: true }).map(f => path.join(p, f)).filter(f => f.endsWith('.md') && fs.statSync(f).isFile()) : [p];
    for (const f of files) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(re, 'Filled'));
  }
  r = harold(w, ['boot']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.out, /NOT SET UP YET/);
});

for (const [name, origin] of [['https', STARTER], ['https without .git, with a trailing slash', `https://${HOST}/${OWNER_REPO}/`], ['ssh', `git@${HOST}:${OWNER_REPO}.git`]]) {
  test(`close never pushes to the public starter (${name}): commits locally, exits 1, says how to fix it`, () => {
    const w = workspace({ origin });
    const env = { HAROLD_TZ: 'America/Chicago' };
    const { r, before } = closeAfterWork(w, env);
    assert.strictEqual(r.code, 1, r.out + r.err);
    assert.match(r.out, REFUSAL);
    assert.notStrictEqual(w.head(), before, 'the work is committed locally');
    assert.strictEqual(trapRefs(w), '', 'no push was attempted');
  });
}

test('close refuses the starter named in harold/upstream.json too, and a cloud runner refuses the same way', () => {
  const mirror = 'https://git.example.org/team/harold-starter.git';
  const w = workspace({ origin: mirror });
  const up = path.join(w.ws, 'harold/upstream.json');
  fs.writeFileSync(up, JSON.stringify({ ...JSON.parse(fs.readFileSync(up, 'utf8')), url: mirror }, null, 2));
  w.g('commit', '-qam', 'own starter');
  const { r } = closeAfterWork(w, { HAROLD_TZ: 'America/Chicago' });
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, REFUSAL);
  assert.strictEqual(trapRefs(w), '');
  const c = workspace();
  const cloud = closeAfterWork(c, { HAROLD_TZ: 'America/Chicago', CLAUDE_CODE_REMOTE: 'true' });
  assert.strictEqual(cloud.r.code, 1, cloud.r.out + cloud.r.err);
  assert.match(cloud.r.out, REFUSAL);
  assert.strictEqual(trapRefs(c), '');
});

test('a private origin still pushes normally', () => {
  const w = workspace({ origin: path.join(os.tmpdir(), 'unused') });
  w.g('remote', 'set-url', 'origin', w.bare);
  const { r } = closeAfterWork(w, { HAROLD_TZ: 'America/Chicago' });
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /pushed main to origin/);
});

test('brief finish commits locally and refuses to push to the public starter', () => {
  const w = workspace();
  const env = { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-05T07:00:00', HAROLD_SESSION_ID: 'brief-job' };
  assert.match(harold(w, ['brief', 'start'], env).out, /^START 2026-10-05/);
  fs.writeFileSync(path.join(w.ws, 'harold/briefs/2026-10-05.md'), '---\ndate: 2026-10-05\n---\n\n# Brief\n\n' + 'A line of the brief.\n'.repeat(120));
  const before = w.head();
  const r = harold(w, ['brief', 'finish'], env);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /committed locally/);
  assert.match(r.out, REFUSAL);
  assert.notStrictEqual(w.head(), before);
  assert.strictEqual(trapRefs(w), '');
});

test('housekeeping finish commits locally and refuses to push to the public starter', () => {
  const w = workspace({ cloud: true });
  const env = { HAROLD_TZ: 'America/Chicago', HAROLD_NOW: '2026-10-02T02:00:00' };
  assert.match(harold(w, ['housekeeping', 'start'], env).out, /^START weekly-scan/);
  fs.writeFileSync(path.join(w.ws, 'harold/weekly-summary.md'), '# Weekly summary\n\nAll quiet.\n');
  harold(w, ['file', 'daily', 'weekly-scan', 'Checked alerts, events, names.'], env);
  harold(w, ['file', 'trigger', 'weekly-scan', 'ran', 'clean'], env);
  const before = w.head();
  const r = harold(w, ['housekeeping', 'finish'], env);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /committed locally/);
  assert.match(r.out, REFUSAL);
  assert.notStrictEqual(w.head(), before);
  assert.strictEqual(trapRefs(w), '');
});

test('an existing workspace that still has memory/CLAUDE.md keeps working under the old name', () => {
  const w = workspace({ origin: path.join(os.tmpdir(), 'unused') });
  fs.renameSync(path.join(w.ws, 'memory/working-memory.md'), path.join(w.ws, 'memory/CLAUDE.md'));
  const r = harold(w, ['boot'], { HAROLD_TZ: 'America/Chicago' });
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /Read memory\/CLAUDE\.md, dashboard\/index\.md/);
  assert.match(harold(w, ['check'], { HAROLD_TZ: 'America/Chicago' }).out, /RESULT: PASS/);
});
