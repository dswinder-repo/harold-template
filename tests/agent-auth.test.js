#!/usr/bin/env node
/*
 * Tests for bin/harold-agent-auth: subscription sign-in files kept fresh across scheduled runs, and the
 * secrets a custom agent asks for.
 *
 *   node --test tests/agent-auth.test.js
 *
 * Fake credentials only, in throwaway directories. Nothing here contacts any model provider.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = path.resolve(__dirname, '..', 'bin', 'harold-agent-auth');
const aa = require(BIN);

const authJson = rt => JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: { id_token: 'fake-id', access_token: 'fake-access', refresh_token: rt, account_id: 'acct' }, last_refresh: '2026-10-01T00:00:00Z' });

function env(name = 'codex') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-agent-auth-'));
  const e = { dir, HOME: dir, RUNNER_TEMP: path.join(dir, 'tmp'), HAROLD_SIGNIN_NAME: name, HAROLD_SIGNIN_FILE: `~/.${name}/auth.json` };
  fs.mkdirSync(e.RUNNER_TEMP, { recursive: true });
  return e;
}
const signinFile = e => path.join(e.dir, `.${e.HAROLD_SIGNIN_NAME}`, 'auth.json');
const encFile = e => path.join(e.RUNNER_TEMP, `harold-signin-${e.HAROLD_SIGNIN_NAME}.enc`);

test('encrypt/decrypt round trip; another secret, another agent name or an altered file is rejected', () => {
  const secret = authJson('rt-one');
  const blob = aa.encrypt('hello', secret, 'codex');
  assert.strictEqual(aa.decrypt(blob, secret, 'codex'), 'hello');
  assert.strictEqual(aa.decrypt(blob, authJson('rt-two'), 'codex'), null);
  assert.strictEqual(aa.decrypt(blob, secret, 'grok'), null);
  const o = JSON.parse(blob); o.ct = Buffer.from('tampered').toString('base64');
  assert.strictEqual(aa.decrypt(JSON.stringify(o), secret, 'codex'), null);
  assert.strictEqual(aa.decrypt('not json', secret, 'codex'), null);
});

test('restore without a cache writes the secret to the sign-in file (~ expanded), mode 600', () => {
  const e = env(); e.HAROLD_SIGNIN_SECRET = authJson('rt-secret');
  const r = aa.restore(e);
  assert.ok(r.ok, r.msg);
  assert.strictEqual(fs.readFileSync(signinFile(e), 'utf8'), e.HAROLD_SIGNIN_SECRET);
  assert.strictEqual(fs.statSync(signinFile(e)).mode & 0o777, 0o600);
  assert.match(r.msg, /repository secret/);
});

test('a renewal is saved, and the next run restores the renewed copy instead of the stale secret', () => {
  const e = env(); e.HAROLD_SIGNIN_SECRET = authJson('rt-secret');
  aa.restore(e);
  let s = aa.save(e); assert.strictEqual(s.changed, false, s.msg);
  fs.writeFileSync(signinFile(e), authJson('rt-renewed'));          // the agent renews during the run
  s = aa.save(e); assert.strictEqual(s.changed, true, s.msg);
  assert.ok(!fs.readFileSync(encFile(e), 'utf8').includes('rt-renewed'), 'the cache file must not hold the token in clear');
  fs.rmSync(path.dirname(signinFile(e)), { recursive: true });      // next run: a fresh machine, the cache restored
  const r = aa.restore(e); assert.ok(r.ok);
  assert.match(fs.readFileSync(signinFile(e), 'utf8'), /rt-renewed/);
  assert.match(r.msg, /earlier run/);
});

test('a replaced secret (a new sign-in) wins over a cache made from the old one', () => {
  const e = env(); e.HAROLD_SIGNIN_SECRET = authJson('rt-old');
  fs.writeFileSync(encFile(e), aa.encrypt(authJson('rt-old-renewed'), e.HAROLD_SIGNIN_SECRET, 'codex'));
  e.HAROLD_SIGNIN_SECRET = authJson('rt-new-login');
  const r = aa.restore(e); assert.ok(r.ok);
  assert.match(fs.readFileSync(signinFile(e), 'utf8'), /rt-new-login/);
  assert.match(r.msg, /secret wins/);
});

test('restore refuses an empty or malformed secret, without echoing it', () => {
  const e = env();
  assert.strictEqual(aa.restore({ ...e, HAROLD_SIGNIN_SECRET: '' }).ok, false);
  const bad = aa.restore({ ...e, HAROLD_SIGNIN_SECRET: 'sk-not-a-signin-file-0123456789' });
  assert.strictEqual(bad.ok, false);
  assert.ok(!bad.msg.includes('sk-not'), 'the error must not print the secret');
});

test('the CLI writes changed=… to GITHUB_OUTPUT and never prints a credential', () => {
  const e = env('grok'); const out = path.join(e.dir, 'gh-output');
  const run = cmd => spawnSync(process.execPath, [BIN, cmd], { env: { ...process.env, ...e, HAROLD_SIGNIN_SECRET: authJson('rt-cli-secret'), GITHUB_OUTPUT: out }, encoding: 'utf8' });
  const a = run('restore'); assert.strictEqual(a.status, 0, a.stdout + a.stderr);
  fs.writeFileSync(signinFile(e), authJson('rt-cli-renewed'));
  const b = run('save'); assert.strictEqual(b.status, 0);
  assert.match(fs.readFileSync(out, 'utf8'), /changed=true/);
  for (const r of [a, b]) assert.ok(!/rt-cli|fake-access/.test(r.stdout + r.stderr), 'no credential in output');
});

test('custom agents: named secrets become exports or files; others are never touched; missing ones are named', () => {
  const e = env('custom');
  const all = JSON.stringify({ GEMINI_API_KEY: "k'ey-1", AGY_SIGNIN: '{"t":1}', UNRELATED_SECRET: 'nope', github_token: 'ghs_x' });
  const out = aa.customEnv({ ...e, HAROLD_ALL_SECRETS: all, HAROLD_AGENT_SECRETS: 'GEMINI_API_KEY, AGY_SIGNIN:~/.agy/creds.json' });
  assert.strictEqual(out, `export GEMINI_API_KEY='k'\\''ey-1'`);
  assert.ok(!out.includes('nope') && !out.includes('ghs_x'));
  const f = path.join(e.dir, '.agy', 'creds.json');
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '{"t":1}');
  assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
  // The quoted export round-trips through a shell exactly.
  const sh = spawnSync('bash', ['-c', `${out}; printf %s "$GEMINI_API_KEY"`], { encoding: 'utf8' });
  assert.strictEqual(sh.stdout, "k'ey-1");
  assert.throws(() => aa.customEnv({ ...e, HAROLD_ALL_SECRETS: all, HAROLD_AGENT_SECRETS: 'NOT_SET' }), /not set: NOT_SET/);
  assert.throws(() => aa.customEnv({ ...e, HAROLD_ALL_SECRETS: all, HAROLD_AGENT_SECRETS: 'bad name' }), /not a secret name/);
  assert.strictEqual(aa.customEnv({ ...e, HAROLD_ALL_SECRETS: all, HAROLD_AGENT_SECRETS: '' }), '');
});
