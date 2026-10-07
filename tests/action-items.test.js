#!/usr/bin/env node
/*
 * Tests for the action-items gate in bin/harold close: a meeting note added or changed this session
 * must carry a task reference on every top-level item under its "Action items" heading (a tracker ID
 * such as ABC-123, a URL, or "(no task: <reason>)"). Notes not touched this session are never checked.
 *
 *   node --test tests/action-items.test.js
 *
 * Each workspace is a throwaway copy of this repository (its own git repo, no remote), with HOME
 * pointed at an empty directory so no real ~/.harold/env, CRM or task-manager credentials are read.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { SRC } = require('./fixture'); // this repository, or in a workspace the starter's content with its machinery (tests/fixture.js)
const SKIP = new Set(['.git', 'node_modules', '.next', 'search.db', '.brief-job.json', '.brief-context.md', '.housekeeping-job.json', '.housekeeping-context.md', '.state', '.last-boot']);
const dirs = [];
test.after(() => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-actions-'));
  dirs.push(dir);
  const ws = path.join(dir, 'ws'), home = path.join(dir, 'home');
  fs.mkdirSync(home);
  fs.cpSync(SRC, ws, { recursive: true, filter: s => !SKIP.has(path.basename(s)) && !/\/harold\/active-sessions\/[^/]+\.json$/.test(s) && !/\/harold\/briefs\/\d{4}-\d{2}-\d{2}\.md$/.test(s) });
  const g = (...a) => spawnSync('git', a, { cwd: ws, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 'test@example.com'); g('config', 'user.name', 'Test');
  g('add', '-A'); g('commit', '-qm', 'init');
  const w = { dir, ws, home, g };
  // Record the scheduled work due today, so a clean close is clean on any date the tests run.
  const chk = JSON.parse(run(w, ['check', '--json']).out);
  for (const d of [...chk.triggers.due, ...chk.triggers.overdue]) run(w, ['file', 'trigger', d.id, 'ran', 'test']);
  w.today = chk.today.iso;
  return w;
}

const STRIP = ['HAROLD_ROOT', 'HAROLD_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'GITHUB_ACTIONS', 'CLAUDE_CODE_REMOTE', 'HAROLD_NOW', 'HAROLD_DETACHED', 'CURSOR_PROJECT_DIR', 'CURSOR_VERSION'];
function run(w, args, input, env = {}) {
  const clean = { ...process.env };
  STRIP.forEach(k => delete clean[k]);
  const r = spawnSync(process.execPath, [path.join(w.ws, 'bin/harold'), ...args], {
    cwd: w.ws, encoding: 'utf8', timeout: 120000, input: input === undefined ? '' : JSON.stringify(input),
    env: { ...clean, HOME: w.home, HAROLD_ENV_FILE: path.join(w.home, 'none'), ...env },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const json = r => { try { return JSON.parse(r.out); } catch (e) { throw new Error(`not JSON (exit ${r.code}): ${r.out.slice(0, 300)} ${r.err.slice(0, 300)}`); } };
const claude = (event, id, extra = {}) => ({ session_id: id, transcript_path: '/tmp/t.jsonl', cwd: '/tmp', hook_event_name: event, permission_mode: 'default', ...extra });

function daily(w) { fs.writeFileSync(path.join(w.ws, `vault/daily/${w.today}-actions-test.md`), `# ${w.today} actions test\n\nFiled a meeting note.\n`); }
const meeting = (items, heading = '## Action Items') => `---\ntags: [meeting]\ndate: 2026-10-06\n---\n# Pilot scoping call\n\n## Summary\n- Good call.\n\n${heading}\n${items}\n\n## Notes\n- Not an action item, no ID needed.\n`;

test('close blocks on a meeting note changed this session whose action items carry no task reference, and passes once they do', () => {
  const w = workspace();
  assert.strictEqual(run(w, ['boot', '--via=claude'], claude('SessionStart', 'ai-1', { source: 'startup' })).code, 0);
  const note = `vault/meetings/${w.today}-pilot-scoping.md`;
  fs.writeFileSync(path.join(w.ws, note), meeting([
    '- [ ] Send the revised deck to Jane Doe by Friday',
    '  - context: she asked for the pricing page too',
    '- Follow up: Jane Doe owes the signed NDA (ACME-42)',
    '1. Book the venue',
  ].join('\n')));
  daily(w);

  const blocked = json(run(w, ['close', '--via=claude'], claude('Stop', 'ai-1', { stop_hook_active: false })));
  assert.strictEqual(blocked.decision, 'block');
  assert.match(blocked.reason, /action items without a task in vault\/meetings\/[\d-]+-pilot-scoping\.md/);
  assert.match(blocked.reason, /pilot-scoping\.md:11: - \[ \] Send the revised deck to Jane Doe by Friday/);
  assert.match(blocked.reason, /pilot-scoping\.md:14: 1\. Book the venue/);
  assert.match(blocked.reason, /harold-linear create/);
  assert.match(blocked.reason, /\(no task: <reason>\)/);
  assert.doesNotMatch(blocked.reason, /signed NDA/, 'an item with an ID passes');
  assert.doesNotMatch(blocked.reason, /context: she asked/, 'a nested sub-item is detail, not an item');
  assert.doesNotMatch(blocked.reason, /Not an action item/, 'items under other headings are not checked');

  fs.writeFileSync(path.join(w.ws, note), meeting([
    '- [ ] Send the revised deck to Jane Doe by Friday (EX-101)',
    '  - context: she asked for the pricing page too',
    '- Follow up: Jane Doe owes the signed NDA (ACME-42)',
    '1. Book the venue https://tasks.example.com/item/77',
    '- Think about the logo (no task: just an idea, not a commitment)',
  ].join('\n')));
  assert.deepStrictEqual(json(run(w, ['close', '--via=claude'], claude('Stop', 'ai-1', { stop_hook_active: true }))), {});
});

test('the heading match is case-insensitive at any level, an empty "(no task:)" is not a reason, and lowercase ids do not count', () => {
  const w = workspace();
  run(w, ['boot', '--via=claude'], claude('SessionStart', 'ai-2', { source: 'startup' }));
  fs.writeFileSync(path.join(w.ws, `vault/meetings/${w.today}-board.md`), meeting(['* Draft the board memo (no task: )', '+ Call the bank abc-12'].join('\n'), '### ACTION ITEMS from the board'));
  daily(w);
  const r = json(run(w, ['close', '--via=claude'], claude('Stop', 'ai-2')));
  assert.strictEqual(r.decision, 'block');
  assert.match(r.reason, /board\.md:\d+: \* Draft the board memo/);
  assert.match(r.reason, /board\.md:\d+: \+ Call the bank abc-12/);
});

test('a meeting note not touched this session never blocks close', () => {
  const w = workspace();
  // An old note with untasked items, committed before the session boots.
  fs.writeFileSync(path.join(w.ws, 'vault/meetings/2026-01-05-old-call.md'), meeting('- Send the old deck'));
  w.g('add', '-A'); w.g('commit', '-qm', 'old meeting');
  run(w, ['boot', '--via=claude'], claude('SessionStart', 'ai-3', { source: 'startup' }));
  fs.appendFileSync(path.join(w.ws, 'harold/facts.md'), `\n- test fact ${Date.now()}\n`);
  daily(w);
  assert.deepStrictEqual(json(run(w, ['close', '--via=claude'], claude('Stop', 'ai-3', { stop_hook_active: true }))), {});
});

test('close without a hook prints the problem and exits 2', () => {
  const w = workspace();
  run(w, ['boot']);
  fs.writeFileSync(path.join(w.ws, `vault/meetings/${w.today}-plain.md`), meeting('- Send the case studies'));
  daily(w);
  const r = run(w, ['close']);
  assert.strictEqual(r.code, 2, r.out + r.err);
  assert.match(r.out + r.err, /action items without a task in vault\/meetings\/[\d-]+-plain\.md/);
});
