// harold_person_create: the third record of contact filing. The vault/people card is built from the
// person template shape, dedupe refuses a second card for the same person, warmth is never invented
// (blank = not rated), and the contact type is free text from the owner's own list. Fictional data only.

import { describe, expect, it } from "vitest";
import { HaroldRepo } from "../../src/github.js";
import * as kb from "../../src/kb.js";
import { FakeGithub } from "./fakes.js";
import { OWNER, REPO, setTestEnv } from "./env.js";

setTestEnv();
const NOW = new Date("2026-10-23T15:00:00Z");

function setup() {
  const gh = new FakeGithub();
  gh.users.set("tok", OWNER);
  return { gh, repo: new HaroldRepo("tok", REPO, "main", gh.fetch) };
}

describe("createPersonCard", () => {
  it("creates the card from the person template shape, with last_updated today", async () => {
    const { gh, repo } = setup();
    const r = await kb.createPersonCard(repo, {
      name: "Jane Doe", type: "partner", labels: ["advisor"], company: "Acme Corp", role: "Director",
      context: "Met at the trade summit 2026-10-20; she cares about regional manufacturing.",
      timeline: "Oct 20: introduced at the trade summit.",
      related: ["Acme Corp", "Example Owner"],
    }, NOW);
    expect(r.text).toContain("Created vault/people/Jane Doe.md");
    const card = gh.files.get("vault/people/Jane Doe.md")!;
    expect(card).toContain("tags: [person]");
    expect(card).toContain("type: partner");
    expect(card).toContain("labels: [advisor]");
    expect(card).toContain("company: Acme Corp");
    expect(card).toContain("role: Director");
    expect(card).toContain("warmth: \n");      // unset: blank, never invented
    expect(card).toContain("status: pending"); // the default
    expect(card).toContain("crm: \n");         // blank = in the CRM
    expect(card).toContain("last_updated: 2026-10-23");
    expect(card).toContain("# Jane Doe");
    expect(card).toContain("**Company:** [[Acme Corp]]");
    expect(card).toContain("Met at the trade summit");
    expect(card).toContain("- [[Acme Corp]]\n- [[Example Owner]]");
    expect(card).not.toContain("## Pipeline");
  });

  it("accepts a type from the owner's own list, not just the template's examples", async () => {
    const { gh, repo } = setup();
    const r = await kb.createPersonCard(repo, { name: "Custom Type", type: "mentor" }, NOW);
    expect(r.isError).toBeUndefined();
    expect(gh.files.get("vault/people/Custom Type.md")).toContain("type: mentor");
  });

  it("refuses when a card for this person already exists, pointing at harold_update", async () => {
    const { repo } = setup();
    await kb.createPersonCard(repo, { name: "Jane Doe", type: "partner" }, NOW);
    const again = await kb.createPersonCard(repo, { name: "Jane Doe", type: "investor" }, NOW);
    expect(again.isError).toBe(true);
    expect(again.text).toContain("already exists");
    expect(again.text).toContain("harold_update");
  });

  it("creates but names similar existing cards, so nobody is filed twice by accident", async () => {
    const { repo } = setup();
    await kb.createPersonCard(repo, { name: "Jane Doe", type: "partner" }, NOW);
    const r = await kb.createPersonCard(repo, { name: "Jane Doering", type: "other" }, NOW);
    expect(r.isError).toBeUndefined();
    expect(r.text).toContain("Similar names already in vault/people: Jane Doe");
  });

  it("validates warmth, status, crm and labels against the template values", async () => {
    const { repo } = setup();
    expect((await kb.createPersonCard(repo, { name: "A B", type: "other", warmth: "Cool" }, NOW)).text).toContain("not rated");
    expect((await kb.createPersonCard(repo, { name: "A B", type: "other", status: "sleeping" }, NOW)).text).toContain("status must be one of");
    expect((await kb.createPersonCard(repo, { name: "A B", type: "other", crm: "yes" }, NOW)).text).toContain('"none"');
    expect((await kb.createPersonCard(repo, { name: "A B", type: "other", labels: ["other"] }, NOW)).text).toContain("never repeat the type");
    expect((await kb.createPersonCard(repo, { name: "A B", type: "  " }, NOW)).text).toContain("Need a type");
  });

  it("keeps an owner-given warmth and an explicit status and crm: none", async () => {
    const { gh, repo } = setup();
    await kb.createPersonCard(repo, { name: "Rated Person", type: "investor", warmth: "Warm", status: "active", crm: "none" }, NOW);
    const card = gh.files.get("vault/people/Rated Person.md")!;
    expect(card).toContain("warmth: Warm");
    expect(card).toContain("status: active");
    expect(card).toContain("crm: none");
  });

  it("sanitizes the file name the way company cards do", async () => {
    const { gh, repo } = setup();
    const r = await kb.createPersonCard(repo, { name: "Wian/Kola: Test?", type: "other" }, NOW);
    expect(r.text).toContain("Created vault/people/Wian Kola Test.md");
    expect(gh.files.has("vault/people/Wian Kola Test.md")).toBe(true);
  });

  it("refuses secrets in the free-text fields (the commit layer scans)", async () => {
    const { repo } = setup();
    const r = await kb.createPersonCard(repo, { name: "Leaky Person", type: "other", context: "password: hunter2hunter2" }, NOW);
    expect(r.isError).toBe(true);
    expect(r.text).toContain("secret");
  });
});
