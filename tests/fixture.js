/*
 * The repository the tests run against.
 *
 * In the starter, that is this repository. In a workspace made from the starter (harold/upstream.json records the
 * starter commit `bin/harold update` last applied), the tests were written for the starter's example content, not
 * for the operator's own notes, settings and history. There the fixture is that starter commit's content with this
 * workspace's own copy of every machinery file the starter ships laid over it (code, hooks, workflows, tests; the
 * paths harold/update-manifest.txt lists, except the playbooks, templates and prompts, which are content-shaped).
 * So the tests check this workspace's machinery, on the content they expect.
 *
 *   HAROLD_TEST_STARTER=<commit>  use that starter commit instead of the recorded one
 *   HAROLD_TEST_STARTER=self      test this repository as it is (the starter's own behaviour)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const CONTENT_SHAPED = ['playbook/', 'vault/templates/', 'harold/brief-prompt.md', 'harold/housekeeping-prompt.md', 'harold/briefs/'];

function recordedCommit() {
  try { return JSON.parse(fs.readFileSync(path.join(REPO, 'harold/upstream.json'), 'utf8')).commit || null; } catch (_) { return null; }
}
function git(cwd, args, opts = {}) { return spawnSync('git', args, { cwd, maxBuffer: 1 << 30, ...opts }); }
function matches(p, pat) {
  if (pat.endsWith('/')) return p.startsWith(pat);
  if (/[*?]/.test(pat)) return new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\0/g, '.*') + '$').test(p);
  return p === pat;
}

function build() {
  const want = process.env.HAROLD_TEST_STARTER;
  if (want === 'self') return REPO;
  const commit = want || recordedCommit();
  if (!commit) return REPO;
  if (git(REPO, ['cat-file', '-e', `${commit}^{commit}`]).status !== 0) {
    throw new Error(`The tests run on the starter's example content, from starter commit ${commit} (harold/upstream.json), which is not in this clone. Fetch it once with: bin/harold update --dry-run`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harold-test-fixture-'));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });
  const tar = git(REPO, ['archive', '--format=tar', commit]);
  if (tar.status !== 0) throw new Error(`git archive ${commit} failed: ${String(tar.stderr)}`);
  const x = spawnSync('tar', ['-x', '-C', dir], { input: tar.stdout, maxBuffer: 1 << 30 });
  if (x.status !== 0) throw new Error(`tar failed: ${String(x.stderr)}`);
  // This workspace's machinery over the starter's: every file the manifest owns that both have.
  const man = fs.readFileSync(path.join(dir, 'harold/update-manifest.txt'), 'utf8').split('\n').map(l => l.replace(/#.*$/, '').trim())
    .filter(l => l && !l.startsWith('!') && !/^seed\s/.test(l));
  const listed = String(git(REPO, ['ls-tree', '-r', '--name-only', '-z', commit]).stdout).split('\0').filter(Boolean);
  for (const p of listed) {
    if (!man.some(m => matches(p, m)) || CONTENT_SHAPED.some(c => matches(p, c))) continue;
    const src = path.join(REPO, p);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    fs.copyFileSync(src, path.join(dir, p));
    fs.chmodSync(path.join(dir, p), fs.statSync(src).mode & 0o777);
  }
  // Tests added since that commit, and this file itself.
  for (const f of fs.readdirSync(path.join(REPO, 'tests'))) {
    const src = path.join(REPO, 'tests', f);
    if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(dir, 'tests', f));
  }
  const g = (...a) => git(dir, a);
  g('init', '-q'); g('add', '-A'); g('-c', 'user.email=test@example.com', '-c', 'user.name=Test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  return dir;
}

module.exports = { SRC: build(), REPO };
