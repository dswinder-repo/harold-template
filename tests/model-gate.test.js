#!/usr/bin/env node
/*
 * The model gate: spawned sessions and helper agents must name their model; models on the workspace's costly
 * list (HAROLD_EXPENSIVE_MODELS) need a deliberate tag. Model-agnostic: the test models are made up.
 *   node --test tests/model-gate.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { SRC } = require('./fixture');

const GATE = path.join(__dirname, '..', 'bin', 'harold-model-gate');
const CS = 'mcp__claude-code-remote__create_session';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-mg-'));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
const hook = (tool_name, tool_input) => ({ hook_event_name: 'PreToolUse', session_id: 'mg-1', tool_name, tool_input });
const BASE = { HOME: home, HAROLD_ENV_FILE: path.join(home, 'none'), HAROLD_MODEL_GATE: '', HAROLD_ROOT: '', CLAUDE_PROJECT_DIR: '', HAROLD_EXPENSIVE_MODELS: '', HAROLD_EXPENSIVE_TAG: '', HAROLD_WORKER_MODEL: '' };
function standalone(input, env = {}) {
  const r = spawnSync(process.execPath, [GATE], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', cwd: home, env: { ...process.env, ...BASE, ...env } });
  return { code: r.status, err: r.stderr };
}
const COSTLY = { HAROLD_EXPENSIVE_MODELS: 'bigmodel, giant', HAROLD_WORKER_MODEL: 'small-model-1' };

test('a new session must name a model; with no costly list, any named model passes', () => {
  const none = standalone(hook(CS, { prompt: 'x' }));
  assert.strictEqual(none.code, 2); assert.match(none.err, /names no model/);
  assert.doesNotMatch(none.err, /opus|sonnet|haiku|claude-[a-z]/i, 'no vendor model names in the message');
  assert.strictEqual(standalone(hook(CS, { model: '  ' })).code, 2, 'blank counts as missing');
  assert.strictEqual(standalone(hook(CS, { model: 'vendor-bigmodel-9' })).code, 0, 'nothing is costly until the workspace says so');
});

test('models on HAROLD_EXPENSIVE_MODELS need the tag; the message suggests HAROLD_WORKER_MODEL', () => {
  const big = standalone(hook(CS, { model: 'vendor-BigModel-9', tags: ['x'] }), COSTLY);
  assert.strictEqual(big.code, 2); assert.match(big.err, /costly list/); assert.match(big.err, /small-model-1/); assert.match(big.err, /allow-expensive/);
  assert.strictEqual(standalone(hook(CS, { model: 'vendor-bigmodel-9', tags: ['allow-expensive'] }), COSTLY).code, 0);
  assert.strictEqual(standalone(hook(CS, { model: 'giant-2' }), COSTLY).code, 2, 'every entry on the list counts');
  assert.strictEqual(standalone(hook(CS, { model: 'small-model-1' }), COSTLY).code, 0);
  assert.strictEqual(standalone(hook(CS, { model: 'vendor-bigmodel-9', tags: ['judge'] }), { ...COSTLY, HAROLD_EXPENSIVE_TAG: 'judge' }).code, 0, 'the tag is configurable');
});

test('helpers: model required unless a fork; any named model allowed', () => {
  for (const t of ['Agent', 'Task']) {
    assert.strictEqual(standalone(hook(t, { prompt: 'x' }), COSTLY).code, 2, t);
    assert.strictEqual(standalone(hook(t, { prompt: 'x', model: 'small-model-1' }), COSTLY).code, 0);
    assert.strictEqual(standalone(hook(t, { prompt: 'x', model: 'vendor-bigmodel-9' }), COSTLY).code, 0, 'a costly helper is a named choice');
    assert.strictEqual(standalone(hook(t, { prompt: 'x', subagent_type: 'fork' })).code, 0);
  }
});

test('fails open on garbage and other tools; off switch; settings.env', () => {
  for (const g of ['', 'not json', '{"a":', '[]', 'null', JSON.stringify({ tool_name: CS, tool_input: '{{bad' })]) assert.strictEqual(standalone(g).code, 0, `garbage: ${g}`);
  assert.strictEqual(standalone(hook('Bash', { command: 'ls' })).code, 0);
  assert.strictEqual(standalone(hook('mcp__other__create_session', {})).code, 0);
  assert.strictEqual(standalone(hook(CS, {}), { HAROLD_MODEL_GATE: 'off' }).code, 0, 'env off');
  const root = fs.mkdtempSync(path.join(home, 'ws-')); fs.mkdirSync(path.join(root, 'harold'));
  fs.writeFileSync(path.join(root, 'harold/settings.env'), 'HAROLD_EXPENSIVE_MODELS="bigmodel"\n');
  assert.strictEqual(standalone(hook(CS, { model: 'bigmodel-1' }), { HAROLD_ROOT: root }).code, 2, 'costly list from settings.env');
  fs.writeFileSync(path.join(root, 'harold/settings.env'), 'HAROLD_MODEL_GATE="off"\n');
  assert.strictEqual(standalone(hook(CS, {}), { HAROLD_ROOT: root }).code, 0, 'settings.env off');
});

test('bin/harold gate runs it with the context gate closed and open', () => {
  const dir = fs.mkdtempSync(path.join(home, 'gate-')); const ws = path.join(dir, 'ws'); const h = path.join(dir, 'home'); fs.mkdirSync(h);
  fs.cpSync(SRC, ws, { recursive: true, filter: s => !['.git', 'node_modules', 'search.db', '.state', '.last-boot'].includes(path.basename(s)) && !/\/harold\/active-sessions\/[^/]+\.json$/.test(s) });
  fs.copyFileSync(GATE, path.join(ws, 'bin/harold-model-gate'));
  const g = (...a) => spawnSync('git', a, { cwd: ws, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 't@e.com'); g('config', 'user.name', 'T'); g('add', '-A'); g('commit', '-qm', 'init');
  const env = { ...process.env, ...BASE, HOME: h, HAROLD_ENV_FILE: path.join(h, 'none') };
  ['HAROLD_ROOT', 'HAROLD_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'HAROLD_NOW'].forEach(k => delete env[k]);
  const run = (args, input, e = {}) => spawnSync(process.execPath, [path.join(ws, 'bin/harold'), ...args], { cwd: ws, encoding: 'utf8', input: JSON.stringify(input), env: { ...env, ...e } });
  const ev = (tool_name, tool_input) => ({ hook_event_name: 'PreToolUse', session_id: 'mg-gate', tool_name, tool_input });
  assert.strictEqual(run(['gate', '--via=claude'], ev(CS, {})).status, 2, 'open context gate: blocked');
  assert.strictEqual(run(['gate', '--via=claude'], ev(CS, { model: 'small-model-1' })).status, 0);
  assert.strictEqual(run(['gate', '--via=claude'], ev(CS, { model: 'bigmodel-1' }), COSTLY).status, 2, 'costly list read by bin/harold too');
  assert.strictEqual(run(['gate', '--via=claude'], ev('Agent', { prompt: 'x' })).status, 2);
  assert.strictEqual(run(['gate', '--via=claude'], ev('Bash', { command: 'bin/harold boot' })).status, 0, 'never blocks bin/harold');
  assert.strictEqual(run(['gate', '--via=claude'], ev(CS, {}), { HAROLD_MODEL_GATE: 'off' }).status, 0, 'off switch');
  const small = { HAROLD_HOOK_BUDGET: '1500', HAROLD_CONTEXT_PART: '3000', HAROLD_SESSION_ID: 'mg-gate' };
  const b = run(['boot', '--via=claude'], { hook_event_name: 'SessionStart', session_id: 'mg-gate', source: 'startup' }, small);
  assert.match(b.stdout, /CONTEXT GATE/, 'precondition: parts unread');
  const closed = run(['gate', '--via=claude'], ev(CS, {}), small);
  assert.strictEqual(closed.status, 2); assert.match(closed.stderr, /model gate/, 'model message wins over the context message');
  assert.strictEqual(run(['gate', '--via=claude'], ev('Bash', { command: 'ls' }), small).status, 2, 'context gate still holds other tools');
});
