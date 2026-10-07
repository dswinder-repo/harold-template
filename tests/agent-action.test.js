#!/usr/bin/env node
/*
 * Tests for .github/actions/harold-agent: which credential each agent picks (subscription first), and what
 * each agent's process is given. The action's own shell steps run here against stub CLIs (claude, codex,
 * gemini, ... are tiny scripts that record their arguments, stdin and environment), with stub npm and curl,
 * so nothing is installed and no model provider is contacted. Fake credentials only.
 *
 *   node --test tests/agent-action.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ACTION = fs.readFileSync(path.join(ROOT, '.github/actions/harold-agent/action.yml'), 'utf8');

// The `run: |` block of the step with this name (no YAML library needed: block scalars are indentation).
function runBlock(name) {
  const lines = ACTION.split('\n');
  const i = lines.findIndex(l => l.trim() === `- name: ${name}`);
  assert.ok(i >= 0, `step "${name}" not found`);
  const j = lines.findIndex((l, k) => k > i && /^\s+run: \|\s*$/.test(l));
  const ind = lines[j].search(/\S/);
  const out = [];
  for (let k = j + 1; k < lines.length; k++) {
    const l = lines[k];
    if (l.trim() && l.search(/\S/) <= ind) break;
    out.push(l);
  }
  const strip = Math.min(...out.filter(l => l.trim()).map(l => l.search(/\S/)));
  return out.map(l => l.slice(strip)).join('\n');
}

const STUBS = ['claude', 'codex', 'agent', 'gemini', 'copilot', 'grok', 'kimi', 'qwen', 'mycli'];
const CREDS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL', 'CURSOR_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENAI_USE_GCA', 'COPILOT_GITHUB_TOKEN', 'XAI_API_KEY', 'KIMI_API_KEY', 'BAILIAN_CODING_PLAN_API_KEY', 'MY_TOKEN', 'OTHER_SECRET', 'HAROLD_ALL_SECRETS', 'HAROLD_PROMPT_FILE'];

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-agent-action-'));
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  const rec = path.join(dir, 'rec.json');
  const recorder = `#!/usr/bin/env node
const fs=require('fs');let stdin='';try{stdin=fs.readFileSync(0,'utf8')}catch(_){}
const env={};for(const k of ${JSON.stringify(CREDS)}.concat(Object.keys(process.env).filter(k=>k.startsWith('IN_'))))if(process.env[k]!==undefined)env[k]=process.env[k];
fs.writeFileSync(${JSON.stringify(rec)},JSON.stringify({cmd:require('path').basename(process.argv[1]),argv:process.argv.slice(2),stdin,env}));`;
  for (const s of STUBS) fs.writeFileSync(path.join(bin, s), recorder, { mode: 0o755 });
  for (const s of ['npm', 'curl', 'sudo']) fs.writeFileSync(path.join(bin, s), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sysctl'), '#!/bin/sh\ncase "$*" in *unprivileged_userns_clone*) echo 1;; *) echo 0;; esac\n', { mode: 0o755 });
  const prompt = path.join(dir, 'prompt.md'); fs.writeFileSync(prompt, 'PROMPT TEXT');
  return { dir, bin, rec, prompt, home: path.join(dir, 'home'), out: path.join(dir, 'gh-output'), log: path.join(dir, 'run.log') };
}

function step(sb, name, env) {
  fs.mkdirSync(sb.home, { recursive: true });
  const r = spawnSync('bash', ['-e', '-c', runBlock(name)], {
    cwd: ROOT, encoding: 'utf8',
    env: { PATH: `${sb.bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: sb.home, GITHUB_OUTPUT: sb.out, ...env },
  });
  const outputs = {};
  if (fs.existsSync(sb.out)) for (const l of fs.readFileSync(sb.out, 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0) outputs[l.slice(0, i)] = l.slice(i + 1); }
  return { ...r, outputs };
}
const creds = (sb, env) => step(sb, 'Pick the credential (subscription first)', env);
function run(sb, agent, auth, env) {
  const r = step(sb, 'Run the agent', { AGENT: agent, AUTH: auth, PROMPT_FILE: sb.prompt, LOG: sb.log, MAX_TURNS: '80', COMMANDS: 'bin/harold,cat,date', ...env });
  return { ...r, rec: fs.existsSync(sb.rec) ? JSON.parse(fs.readFileSync(sb.rec, 'utf8')) : null };
}

test('credential choice: the subscription wins over an API key, for every agent that has both', () => {
  for (const [agent, sub, key] of [['claude', 'CLAUDE_SUB', 'CLAUDE_KEY'], ['codex', 'CODEX_SUB', 'CODEX_KEY'], ['gemini', 'GEMINI_SUB', 'GEMINI_KEY'], ['grok', 'GROK_SUB', 'GROK_KEY']]) {
    const sb = sandbox();
    const both = creds(sb, { AGENT: agent, [sub]: '{"s":1}', [key]: 'k' });
    assert.strictEqual(both.status, 0, both.stdout + both.stderr);
    assert.strictEqual(both.outputs.auth, 'subscription', agent);
    const sb2 = sandbox();
    assert.strictEqual(creds(sb2, { AGENT: agent, [key]: 'k' }).outputs.auth, 'api-key', agent);
  }
});

test('credential choice: sign-in files are named for codex, gemini and grok on a subscription only', () => {
  let sb = sandbox(); let r = creds(sb, { AGENT: 'codex', CODEX_SUB: '{"s":1}' });
  assert.strictEqual(r.outputs.signin, 'codex'); assert.strictEqual(r.outputs['signin-file'], `${sb.home}/.codex/auth.json`);
  sb = sandbox(); r = creds(sb, { AGENT: 'gemini', GEMINI_SUB: '{"s":1}' });
  assert.strictEqual(r.outputs['signin-file'], `${sb.home}/.gemini/oauth_creds.json`);
  sb = sandbox(); r = creds(sb, { AGENT: 'codex', CODEX_KEY: 'k' });
  assert.strictEqual(r.outputs.signin, undefined);
});

test('credential choice: missing credentials fail with the subscription option named first', () => {
  const cases = { claude: /claude setup-token.*CLAUDE_CODE_OAUTH_TOKEN.*Without one: add ANTHROPIC_API_KEY/, codex: /ChatGPT subscription.*CODEX_AUTH_JSON.*Without one: add OPENAI_API_KEY/, gemini: /GEMINI_OAUTH_CREDS.*Without one: add GEMINI_API_KEY/, grok: /SuperGrok.*GROK_AUTH_JSON.*Without one: add XAI_API_KEY/, cursor: /CURSOR_API_KEY/, copilot: /COPILOT_GITHUB_TOKEN/, kimi: /KIMI_API_KEY/, qwen: /QWEN_CODING_PLAN_KEY/ };
  for (const [agent, re] of Object.entries(cases)) {
    const r = creds(sandbox(), { AGENT: agent });
    assert.notStrictEqual(r.status, 0, agent);
    assert.match(r.stdout, re, agent);
  }
  assert.match(creds(sandbox(), { AGENT: 'nope' }).stdout, /HAROLD_AGENT is 'nope'/);
  assert.match(creds(sandbox(), { AGENT: 'custom' }).stdout, /HAROLD_AGENT_CMD is empty/);
  assert.strictEqual(creds(sandbox(), { AGENT: 'custom', CUSTOM_CMD: 'mycli' }).outputs.auth, 'custom');
});

test('claude: another provider needs its token, and then wins over the subscription', () => {
  assert.match(creds(sandbox(), { AGENT: 'claude', PROVIDER_URL: 'https://example.invalid/anthropic', CLAUDE_SUB: 's' }).stdout, /ANTHROPIC_AUTH_TOKEN/);
  const r = creds(sandbox(), { AGENT: 'claude', PROVIDER_URL: 'https://example.invalid/anthropic', PROVIDER_TOKEN: 't', CLAUDE_SUB: 's' });
  assert.strictEqual(r.outputs.auth, 'provider');
});

test('claude on a subscription gets only the subscription token, never the API key', () => {
  const sb = sandbox();
  const r = run(sb, 'claude', 'subscription', { IN_CLAUDE_SUB: 'oauth-fake', IN_CLAUDE_KEY: 'key-fake', IN_CURSOR_KEY: 'cursor-fake', MODEL: 'm1' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(r.rec.cmd, 'claude');
  assert.deepStrictEqual(r.rec.env, { CLAUDE_CODE_OAUTH_TOKEN: 'oauth-fake' });
  const tools = r.rec.argv[r.rec.argv.indexOf('--allowedTools') + 1];
  assert.match(tools, /Bash\(bin\/harold \*\)/); assert.match(tools, /Bash\(date \*\)/);
  assert.ok(r.rec.argv.includes('--model') && r.rec.argv.includes('m1'));
  assert.strictEqual(r.rec.argv[r.rec.argv.indexOf('-p') + 1], 'PROMPT TEXT');
});

test('claude with an API key only, and with another provider', () => {
  let r = run(sandbox(), 'claude', 'api-key', { IN_CLAUDE_KEY: 'key-fake' });
  assert.deepStrictEqual(r.rec.env, { ANTHROPIC_API_KEY: 'key-fake' });
  r = run(sandbox(), 'claude', 'provider', { IN_PROVIDER_URL: 'https://example.invalid/anthropic', IN_PROVIDER_TOKEN: 'tok', IN_PROVIDER_MODEL: 'glm-x', IN_CLAUDE_SUB: 'oauth-fake' });
  assert.deepStrictEqual(r.rec.env, { ANTHROPIC_BASE_URL: 'https://example.invalid/anthropic', ANTHROPIC_AUTH_TOKEN: 'tok', ANTHROPIC_MODEL: 'glm-x' });
});

test('codex on a subscription runs codex exec with the prompt on stdin and no credential in its environment', () => {
  const r = run(sandbox(), 'codex', 'subscription', { IN_CLAUDE_SUB: 'oauth-fake' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(r.rec.cmd, 'codex');
  assert.deepStrictEqual(r.rec.argv.slice(0, 4), ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write']);
  assert.strictEqual(r.rec.argv.at(-1), '-'); assert.strictEqual(r.rec.stdin, 'PROMPT TEXT');
  assert.deepStrictEqual(r.rec.env, {});
});

test('codex with an API key leaves the run to openai/codex-action', () => {
  const sb = sandbox(); const r = run(sb, 'codex', 'api-key', {});
  assert.strictEqual(r.status, 0); assert.strictEqual(r.rec, null);
});

test('gemini, copilot, grok, cursor: each gets its own credential and its own command allowlist', () => {
  let r = run(sandbox(), 'gemini', 'subscription', { IN_GEMINI_KEY: 'gk' });
  assert.deepStrictEqual(r.rec.env, { GOOGLE_GENAI_USE_GCA: 'true' });
  assert.match(r.rec.argv[r.rec.argv.indexOf('--allowed-tools') + 1], /run_shell_command\(bin\/harold\)/);
  r = run(sandbox(), 'gemini', 'api-key', { IN_GEMINI_KEY: 'gk' });
  assert.deepStrictEqual(r.rec.env, { GEMINI_API_KEY: 'gk' });
  r = run(sandbox(), 'copilot', 'subscription', { IN_COPILOT_SUB: 'pat-fake', IN_CLAUDE_KEY: 'x' });
  assert.deepStrictEqual(r.rec.env, { COPILOT_GITHUB_TOKEN: 'pat-fake' });
  assert.ok(r.rec.argv.includes('shell(bin/harold:*)'), r.rec.argv.join(' '));
  r = run(sandbox(), 'grok', 'subscription', { IN_GROK_KEY: 'xk' });
  assert.deepStrictEqual(r.rec.env, {});
  assert.ok(r.rec.argv.includes('Bash(bin/harold *)'));
  r = run(sandbox(), 'grok', 'api-key', { IN_GROK_KEY: 'xk' });
  assert.deepStrictEqual(r.rec.env, { XAI_API_KEY: 'xk' });
  r = run(sandbox(), 'cursor', 'subscription', { IN_CURSOR_KEY: 'ck' });
  assert.deepStrictEqual(r.rec.env, { CURSOR_API_KEY: 'ck' });
});

test('kimi and qwen: provider config written as their docs show; the key only in the environment', () => {
  let sb = sandbox();
  let r = run(sb, 'kimi', 'subscription', { IN_KIMI_KEY: 'kk' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.deepStrictEqual(r.rec.env, { KIMI_API_KEY: 'kk' });
  assert.strictEqual(r.rec.stdin, 'PROMPT TEXT');
  const toml = fs.readFileSync(path.join(sb.home, '.kimi/config.toml'), 'utf8');
  assert.match(toml, /^default_model = "harold"$/m); assert.match(toml, /^base_url = "https:\/\/api\.kimi\.com\/coding\/v1"$/m);
  assert.match(toml, /^model = "kimi-for-coding"$/m); assert.ok(!toml.includes('kk'));
  sb = sandbox();
  r = run(sb, 'qwen', 'subscription', { IN_QWEN_SUB: 'sk-sp-fake', BASE_URL: 'https://coding.dashscope.aliyuncs.com/v1' });
  assert.deepStrictEqual(r.rec.env, { BAILIAN_CODING_PLAN_API_KEY: 'sk-sp-fake' });
  const qs = JSON.parse(fs.readFileSync(path.join(sb.home, '.qwen/settings.json'), 'utf8'));
  assert.strictEqual(qs.modelProviders.openai[0].baseUrl, 'https://coding.dashscope.aliyuncs.com/v1');
  assert.strictEqual(qs.modelProviders.openai[0].envKey, 'BAILIAN_CODING_PLAN_API_KEY');
  assert.strictEqual(qs.security.auth.selectedType, 'openai');
  assert.ok(!JSON.stringify(qs).includes('sk-sp-fake'));
});

test('custom: the prompt on stdin, only the named secrets, never the full secrets JSON', () => {
  const sb = sandbox();
  const all = JSON.stringify({ MY_TOKEN: 'mine', OTHER_SECRET: 'not-yours', MY_FILE: '{"f":1}' });
  const r = run(sb, 'custom', 'custom', { IN_CUSTOM_CMD: 'mycli --flag', HAROLD_AGENT_SECRETS: 'MY_TOKEN,MY_FILE:~/.mycli/creds.json', HAROLD_ALL_SECRETS: all, IN_CLAUDE_SUB: 'oauth-fake' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(r.rec.cmd, 'mycli'); assert.deepStrictEqual(r.rec.argv, ['--flag']);
  assert.strictEqual(r.rec.stdin, 'PROMPT TEXT');
  assert.deepStrictEqual(r.rec.env, { MY_TOKEN: 'mine', HAROLD_PROMPT_FILE: sb.prompt });
  assert.strictEqual(fs.readFileSync(path.join(sb.home, '.mycli/creds.json'), 'utf8'), '{"f":1}');
  const bad = run(sandbox(), 'custom', 'custom', { IN_CUSTOM_CMD: 'mycli', HAROLD_AGENT_SECRETS: 'MISSING', HAROLD_ALL_SECRETS: all });
  assert.notStrictEqual(bad.status, 0); assert.match(bad.stdout + bad.stderr, /not set: MISSING/);
});

test('a failing agent fails the step and shows the end of its log', () => {
  const sb = sandbox();
  fs.writeFileSync(path.join(sb.bin, 'claude'), '#!/bin/sh\necho "model said no"\nexit 3\n', { mode: 0o755 });
  const r = run(sb, 'claude', 'subscription', { IN_CLAUDE_SUB: 'o' });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout, /model said no/); assert.match(r.stdout, /the claude run failed/);
});

test('credential choice: if-no-credential=skip ends green with a notice and auth=none (a job not set up yet)', () => {
  for (const agent of ['claude', 'codex', 'cursor', 'gemini', 'copilot', 'grok', 'kimi', 'qwen']) {
    const r = creds(sandbox(), { AGENT: agent, ON_MISSING: 'skip' });
    assert.strictEqual(r.status, 0, agent + r.stdout);
    assert.strictEqual(r.outputs.auth, 'none', agent);
    assert.match(r.stdout, /::notice::No model credential for .* not set up and was skipped/, agent);
  }
  assert.strictEqual(creds(sandbox(), { AGENT: 'claude', ON_MISSING: 'skip', CLAUDE_SUB: 's' }).outputs.auth, 'subscription', 'a credential still runs');
  assert.notStrictEqual(creds(sandbox(), { AGENT: 'nope', ON_MISSING: 'skip' }).status, 0, 'a wrong HAROLD_AGENT still fails');
  const action = fs.readFileSync(path.join(ROOT, '.github/actions/harold-agent/action.yml'), 'utf8');
  assert.match(action, /- name: Run the agent\n\s+id: run\n\s+if: \$\{\{ steps\.creds\.outputs\.auth != 'none' \}\}/);
  const brief = fs.readFileSync(path.join(ROOT, '.github/workflows/morning-brief.yml'), 'utf8');
  assert.match(brief, /if-no-credential: skip/);
  assert.match(brief, /steps\.agent\.outputs\.skipped != 'true'/);
  const hk = fs.readFileSync(path.join(ROOT, '.github/workflows/housekeeping.yml'), 'utf8');
  assert.doesNotMatch(hk, /if-no-credential: skip/, 'housekeeping, once switched on, fails loudly without a credential');
});

test('brief-notify.yml: off without NTFY_TOPIC, notices only for drafts a push added, default branch only', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github/workflows/brief-notify.yml'), 'utf8');
  assert.match(y, /paths: \['harold\/briefs\/20\*\.md'\]/);
  assert.match(y, /github\.ref_name == github\.event\.repository\.default_branch/);
  assert.strictEqual((y.match(/if: \$\{\{ env\.NTFY_TOPIC != '' \}\}/g) || []).length, 2);
  assert.match(y, /--diff-filter=A/);
  assert.match(y, /bin\/harold brief notify --date=/);
});
