// Write tools against a THROWAWAY BRANCH of your Harold repository, never main. Runs only when
// HAROLD_E2E_WRITE=1 is set (it creates and deletes a branch), plus HAROLD_REPO and a token (see common.ts).
// It creates connector-test-<timestamp> from HAROLD_BRANCH, points the connector at it, exercises the
// write tools through a real local HTTP server + MCP client, verifies the commits and content on that
// branch, confirms the base branch did not move, then deletes the throwaway branch.
import { HaroldRepo } from "../../src/github.js";
import { frontmatter, localParts } from "../../src/text.js";
import { nextLearningId, parseJsonl } from "../../src/learnings.js";
import { commitAuthor } from "../../src/config.js";
import { check, connect, done, e2eSetup, isErr, mintAccessToken, oneLine, skip, startLocal, textOf } from "./common.js";

if (process.env.HAROLD_E2E_WRITE !== "1") skip("set HAROLD_E2E_WRITE=1 (plus HAROLD_REPO and GITHUB_TOKEN) to run the write checks on a throwaway branch");
const env = await e2eSetup();
const REPO = env.repo;
const BASE_BRANCH = env.branch;
const gh = env.token;
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const branch = `connector-test-${stamp}`;
if (!/^connector-test-\d{14}$/.test(branch)) throw new Error("bad test branch name");

const onMain = new HaroldRepo(gh, REPO, BASE_BRANCH);
const onBranch = new HaroldRepo(gh, REPO, branch);
const mainBefore = await onMain.branchSha(BASE_BRANCH);
const since = new Date(Date.now() - 60_000).toISOString();
await onMain.createBranch(branch, mainBefore);
console.log(`created throwaway branch ${branch} at ${BASE_BRANCH} ${mainBefore.slice(0, 7)}`);

let srv: Awaited<ReturnType<typeof startLocal>> | null = null;
try {
  srv = await startLocal(REPO, branch, env.user);
  check("HAROLD_BRANCH points at the throwaway branch", process.env.HAROLD_BRANCH === branch && branch !== "main", process.env.HAROLD_BRANCH);
  const c = await connect(srv.base, await mintAccessToken(gh), "v2");
  const iso = localParts().iso;
  const learningsBefore = (await onBranch.getText("harold/learnings.jsonl").catch(() => null))?.text ?? "";
  const expectedId = nextLearningId(learningsBefore);

  // harold_capture
  const cap = await c.call("harold_capture", { text: `Connector write test ${stamp}: capture works.`, topic: "connector-test" });
  check("harold_capture", !isErr(cap), oneLine(textOf(cap)));
  const daily = await onBranch.getText(`vault/daily/${iso}-chat.md`);
  check("  capture landed in today's chat log on the branch", !!daily && daily.text.includes(`[connector-test] Connector write test ${stamp}: capture works.`) && frontmatter(daily.text).session === "chat");

  // harold_note (+ refuse overwrite)
  const title = `Connector write test ${stamp}`;
  const note = await c.call("harold_note", { kind: "intel", title, body: "This note was written by the connector's write test on a throwaway branch." });
  check("harold_note (intel)", !isErr(note), oneLine(textOf(note)));
  const notePath = `vault/intel/connector-write-test-${stamp}.md`;
  const nf = await onBranch.getText(notePath);
  check("  note exists with frontmatter", !!nf && frontmatter(nf.text).last_updated === iso && nf.text.includes(`# ${title}`), notePath);
  const again = await c.call("harold_note", { kind: "intel", title, body: "second" });
  check("  harold_note refuses to overwrite", isErr(again) && /harold_update/.test(textOf(again)), oneLine(textOf(again), 90));

  // harold_update
  const upd = await c.call("harold_update", { path: notePath, append_text: "- appended by harold_update", heading: "Updates", frontmatter_updates: { status: "test" } });
  check("harold_update", !isErr(upd), oneLine(textOf(upd)));
  const nf2 = (await onBranch.getText(notePath))!.text;
  check("  update applied (heading + frontmatter)", nf2.includes("## Updates\n\n- appended by harold_update") && frontmatter(nf2).status === "test");
  const refused = await c.call("harold_update", { path: "AGENTS.md", append_text: "x" });
  check("  harold_update refuses AGENTS.md", isErr(refused), oneLine(textOf(refused), 90));

  // harold_learning
  const learn = await c.call("harold_learning", { lesson: `Connector write test ${stamp}: learnings append with the next free id.`, severity: "info", category: "tools", project: "global" });
  check("harold_learning", !isErr(learn), oneLine(textOf(learn), 100));
  const rows = parseJsonl((await onBranch.getText("harold/learnings.jsonl"))!.text);
  const last = rows[rows.length - 1] as Record<string, string>;
  check(`  learning appended as ${expectedId} with source connector`, last.id === expectedId && last.source === "connector" && last.severity === "info" && last.date === iso, JSON.stringify({ id: last.id, source: last.source }));

  // two learnings at once: the conflict retry must give them distinct, consecutive ids
  const [p1, p2] = await Promise.all([
    c.call("harold_learning", { lesson: `Connector write test ${stamp}: parallel A.`, severity: "info", category: "tools", project: "global" }),
    c.call("harold_learning", { lesson: `Connector write test ${stamp}: parallel B.`, severity: "info", category: "tools", project: "global" }),
  ]);
  const rows2 = parseJsonl((await onBranch.getText("harold/learnings.jsonl"))!.text) as Record<string, string>[];
  const ids = rows2.slice(-2).map(r => r.id);
  const n = Number(expectedId.slice(1));
  check("  parallel learnings got distinct consecutive ids (conflict retry)", !isErr(p1) && !isErr(p2) && ids.sort().join(",") === [`L${n + 1}`, `L${n + 2}`].join(",") && new Set(rows2.map(r => r.id)).size === rows2.length, `${ids.join(", ")} | ${oneLine(textOf(p1), 40)} / ${oneLine(textOf(p2), 40)}`);

  // secret refusal: nothing committed
  const before = (await onBranch.commits(branch)).length;
  const sec = await c.call("harold_capture", { text: "the example tool password: NotARealOne2026" });
  check("harold_capture refuses a password", isErr(sec) && /secret/.test(textOf(sec)), oneLine(textOf(sec), 80));
  check("  and made no commit", (await onBranch.commits(branch)).length === before);

  // commits on the branch
  const commits = (await onBranch.commits(branch, since)).filter(x => x.message.startsWith("chore(connector):"));
  const author = commitAuthor();
  check("commits landed on the branch with the connector author", commits.length === 6 && commits.every(x => x.author === author.name && x.email === author.email),
    `${commits.length} commits: ${commits.map(x => x.message.replace("chore(connector): ", "")).reverse().join(" | ")}`);
  await c.close();

  const mainAfter = await onMain.branchSha(BASE_BRANCH);
  check(`${BASE_BRANCH} did not move`, mainAfter === mainBefore || !(await onMain.commits(BASE_BRANCH, since)).some(x => x.message.startsWith("chore(connector):")), `${mainBefore.slice(0, 7)} → ${mainAfter.slice(0, 7)}`);
} finally {
  if (srv) await srv.close();
  await onMain.deleteBranch(branch);
  let gone = false;
  try { await onMain.branchSha(branch); } catch { gone = true; }
  check(`throwaway branch ${branch} deleted`, gone);
}
done();
