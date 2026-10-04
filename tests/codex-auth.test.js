#!/usr/bin/env node
/*
 * Tests for bin/harold-codex-auth, which keeps a Codex ChatGPT sign-in fresh across scheduled runs.
 *
 *   node --test tests/codex-auth.test.js
 *
 * Fake credentials only, in throwaway directories. Nothing here contacts OpenAI.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = path.resolve(__dirname, '..', 'bin', 'harold-codex-auth');
const ca = require(BIN);

const authJson = rt => JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: { id_token: 'fake-id', access_token: 'fake-access', refresh_token: rt, account_id: 'acct' }, last_refresh: '2026-10-01T00:00:00Z' });

function env() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-codex-auth-'));
  return { dir, CODEX_HOME: path.join(dir, 'codex'), RUNNER_TEMP: path.join(dir, 'tmp'), HOME: dir };
}
function mk(e) { fs.mkdirSync(e.RUNNER_TEMP, { recursive: true }); return e; }

test('encrypt/decrypt round trip; the wrong secret or a tampered file is rejected', () => {
  const secret = authJson('rt-one');
  const blob = ca.encrypt('hello', secret);
  assert.strictEqual(ca.decrypt(blob, secret), 'hello');
  assert.strictEqual(ca.decrypt(blob, authJson('rt-two')), null);
  const o = JSON.parse(blob); o.ct = Buffer.from('tampered').toString('base64');
  assert.strictEqual(ca.decrypt(JSON.stringify(o), secret), null);
  assert.strictEqual(ca.decrypt('not json', secret), null);
});

test('restore without a cache writes the secret to auth.json, mode 600', () => {
  const e = mk(env()); e.CODEX_AUTH_JSON = authJson('rt-secret');
  const r = ca.restore(e);
  assert.ok(r.ok, r.msg);
  const p = path.join(e.CODEX_HOME, 'auth.json');
  assert.strictEqual(fs.readFileSync(p, 'utf8'), e.CODEX_AUTH_JSON);
  assert.strictEqual(fs.statSync(p).mode & 0o777, 0o600);
  assert.match(r.msg, /secret/);
});

test('a renewal is saved, and the next run restores the renewed copy instead of the stale secret', () => {
  const e = mk(env()); e.CODEX_AUTH_JSON = authJson('rt-secret');
  ca.restore(e);
  // Unchanged run: nothing to save.
  let s = ca.save(e); assert.strictEqual(s.changed, false, s.msg);
  // Codex renews during the run: new refresh token on disk.
  fs.writeFileSync(path.join(e.CODEX_HOME, 'auth.json'), authJson('rt-renewed'));
  s = ca.save(e); assert.strictEqual(s.changed, true, s.msg);
  const enc = fs.readFileSync(path.join(e.RUNNER_TEMP, 'codex-auth.enc'), 'utf8');
  assert.ok(!enc.includes('rt-renewed'), 'the cache file must not hold the token in clear');
  // Next run: fresh home, the cache file restored by actions/cache.
  fs.rmSync(e.CODEX_HOME, { recursive: true });
  const r = ca.restore(e); assert.ok(r.ok);
  assert.match(fs.readFileSync(path.join(e.CODEX_HOME, 'auth.json'), 'utf8'), /rt-renewed/);
  assert.match(r.msg, /earlier run/);
});

test('a replaced secret (a new sign-in) wins over a cache made from the old one', () => {
  const e = mk(env()); e.CODEX_AUTH_JSON = authJson('rt-old');
  fs.writeFileSync(path.join(e.RUNNER_TEMP, 'codex-auth.enc'), ca.encrypt(authJson('rt-old-renewed'), e.CODEX_AUTH_JSON));
  e.CODEX_AUTH_JSON = authJson('rt-new-login');
  const r = ca.restore(e); assert.ok(r.ok);
  assert.match(fs.readFileSync(path.join(e.CODEX_HOME, 'auth.json'), 'utf8'), /rt-new-login/);
  assert.match(r.msg, /secret wins/);
});

test('restore refuses an empty or malformed secret, without echoing it', () => {
  const e = mk(env());
  assert.strictEqual(ca.restore({ ...e, CODEX_AUTH_JSON: '' }).ok, false);
  const bad = ca.restore({ ...e, CODEX_AUTH_JSON: 'sk-not-an-auth-json-0123456789' });
  assert.strictEqual(bad.ok, false);
  assert.ok(!bad.msg.includes('sk-not'), 'the error must not print the secret');
});

test('the CLI writes changed=… to GITHUB_OUTPUT and never prints a token', () => {
  const e = mk(env()); const out = path.join(e.dir, 'gh-output');
  const run = cmd => spawnSync(process.execPath, [BIN, cmd], { env: { ...process.env, ...e, CODEX_AUTH_JSON: authJson('rt-cli-secret'), GITHUB_OUTPUT: out }, encoding: 'utf8' });
  const a = run('restore'); assert.strictEqual(a.status, 0, a.stdout + a.stderr);
  fs.writeFileSync(path.join(e.CODEX_HOME, 'auth.json'), authJson('rt-cli-renewed'));
  const b = run('save'); assert.strictEqual(b.status, 0);
  assert.match(fs.readFileSync(out, 'utf8'), /changed=true/);
  for (const r of [a, b]) assert.ok(!/rt-cli|fake-access/.test(r.stdout + r.stderr), 'no token in output');
});
