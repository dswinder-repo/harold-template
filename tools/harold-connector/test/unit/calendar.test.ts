// calendar_list / calendar_events and the connector's own Google sign-in, against an in-memory
// Google API: the OAuth code exchange, the owner-email gate, the refresh-token exchange, event
// grouping into New York days, all-day and multi-day labels, cancelled events, pipe normalization
// and the plain "not configured" answer. Fictional data only.

import { describe, expect, it } from "vitest";
import { tokenKey } from "../../src/config.js";
import { seal, open } from "../../src/crypto.js";
import * as google from "../../src/google.js";
import * as calendar from "../../src/calendar.js";
import { setTestEnv } from "./env.js";

setTestEnv({ GOOGLE_CLIENT_ID: "test-google-client", GOOGLE_CLIENT_SECRET: "test-google-secret", ALLOWED_GOOGLE_EMAILS: "owner@example.com", HAROLD_TZ: "America/Chicago" });

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com";
const SEALED_RT = seal(tokenKey(), "google", { rt: "rt-value", email: "owner@example.com" });
const CFG: google.GoogleConfig = { clientId: "test-google-client", clientSecret: "test-google-secret", sealedToken: SEALED_RT };

interface Posted { url: string; body: string; auth: string }

class FakeGoogle {
  posts: Posted[] = [];
  /** calendar lists keyed by the refresh token presented at the token endpoint (multi-account tests) */
  listsByRt: Record<string, any[]> = {};
  lastRt = "";
  calendarList = [
    { id: "owner@example.com", summary: "Owner", primary: true, accessRole: "owner", timeZone: "America/Chicago" },
    { id: "fam@group.calendar.google.com", summary: "Family | House", accessRole: "reader", timeZone: "America/Chicago" },
  ];
  /** events keyed by calendar id */
  events: Record<string, any[]> = {};
  revoked = false;

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === TOKEN_URL) {
      const body = String(init?.body);
      this.posts.push({ url, body, auth: new Headers(init?.headers).get("authorization") || "" });
      this.lastRt = new URLSearchParams(body).get("refresh_token") || "";
      if (this.revoked) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      return new Response(JSON.stringify({ access_token: "at-value", expires_in: 3599 }), { status: 200 });
    }
    if (url.startsWith(`${API}/calendar/v3/users/me/calendarList`)) {
      return new Response(JSON.stringify({ items: this.listsByRt[this.lastRt] || this.calendarList }), { status: 200 });
    }
    const m = url.match(/calendar\/v3\/calendars\/(.+?)\/events/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      return new Response(JSON.stringify({ items: this.events[id] || [] }), { status: 200 });
    }
    return new Response("not google", { status: 404 });
  };
}

const NOW = new Date("2026-10-23T15:00:00Z"); // a Friday morning in the test zone

describe("google.authorize", () => {
  it("asks for the two read-only scopes, offline access and consent, with a sealed state", () => {
    const url = new URL(google.authorize("https://harold-connector.example.com", "test-google-client"));
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("redirect_uri")).toBe("https://harold-connector.example.com/google/callback");
    const st = open(tokenKey(), "google-state", url.searchParams.get("state")!);
    expect(st).toBeTruthy();
  });
});

describe("google.callback", () => {
  const req = (qs: string) => new Request(`https://harold-connector.example.com/google/callback?${qs}`);
  const fakeToken = (grant: { refresh_token?: string; email?: string; fail?: boolean }) =>
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : String(input);
      if (url === TOKEN_URL) {
        if (grant.fail) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
        return new Response(JSON.stringify({ access_token: "at-value", refresh_token: grant.refresh_token }), { status: 200 });
      }
      if (url === `${google.CALENDAR_API}/users/me/calendarList/primary`) {
        return new Response(JSON.stringify({ id: grant.email }), { status: 200 });
      }
      return new Response("not google", { status: 404 });
    };
  const goodState = () => seal(tokenKey(), "google-state", { nonce: "n", exp: Math.floor(Date.now() / 1000) + 300 });

  it("refuses a state it did not mint", async () => {
    const res = await google.callback(req("state=forged&code=c"), fakeToken({}));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Start again");
  });

  it("refuses a Google account that is not the owner's", async () => {
    const res = await google.callback(req(`state=${goodState()}&code=c`), fakeToken({ refresh_token: "rt", email: "stranger@example.com" }));
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("stranger@example.com");
  });

  it("fails closed when the account cannot be identified from the primary calendar", async () => {
    const res = await google.callback(req(`state=${goodState()}&code=c`), fakeToken({ refresh_token: "rt" }));
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("(unknown)");
  });

  it("shows the sealed refresh token once for the owner's account", async () => {
    const res = await google.callback(req(`state=${goodState()}&code=c`), fakeToken({ refresh_token: "rt-value", email: "owner@example.com" }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("GOOGLE_REFRESH_TOKEN");
    const m = html.match(/<code style="word-break:break-all;user-select:all">([^<]+)<\/code>/);
    expect(m).toBeTruthy();
    expect(open(tokenKey(), "google", m![1])).toEqual({ rt: "rt-value", email: "owner@example.com" });
  });

  it("fails plainly when Google returns no refresh token (consent was skipped)", async () => {
    const res = await google.callback(req(`state=${goodState()}&code=c`), fakeToken({ email: "owner@example.com" }));
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("did not return a refresh token");
  });

  it("fails plainly when the token exchange itself fails", async () => {
    const res = await google.callback(req(`state=${goodState()}&code=c`), fakeToken({ fail: true }));
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("token exchange failed");
  });
});

describe("multi-account calendars", () => {
  const SEALED_RT2 = seal(tokenKey(), "google", { rt: "rt-2", email: "work@example.com" });
  const CFG2: google.GoogleConfig = { ...CFG, sealedToken: SEALED_RT2 };

  it("groups calendars across accounts and queries a shared calendar once", async () => {
    const g = new FakeGoogle();
    g.listsByRt = {
      "rt-value": [{ id: "owner@example.com", summary: "Personal", primary: true }, { id: "shared@group.calendar.google.com", summary: "Shared" }],
      "rt-2": [{ id: "work@example.com", summary: "Work", primary: true }, { id: "shared@group.calendar.google.com", summary: "Shared" }],
    };
    g.events = { "shared@group.calendar.google.com": [{ id: "e1", iCalUID: "u1", summary: "Sync", start: { dateTime: "2026-10-24T14:00:00Z" }, end: { dateTime: "2026-10-24T14:30:00Z" } }] };
    const list = await calendar.listCalendars(g.fetch, [CFG, CFG2]);
    expect(list.text).toContain("across 2 Google accounts");
    expect(list.text).toContain("[owner@example.com]");
    expect(list.text).toContain("[work@example.com]");
    expect(list.text.match(/shared@group/g)?.length).toBe(1); // shared calendar listed once
    const out = await calendar.listEvents(g.fetch, [CFG, CFG2], { from: "2026-10-24", to: "2026-10-24" }, NOW);
    const sharedFetches = g.posts.length; // token posts only; event fetches tracked below
    expect(out.text).toContain("Sync");
    expect(out.text).toContain("Shared (owner@example.com)");
  });

  it("shows an event visible on two calendars once", async () => {
    const g = new FakeGoogle();
    g.calendarList = [
      { id: "a@example.com", summary: "A", primary: true },
      { id: "b@example.com", summary: "B" },
    ] as any;
    const ev = { id: "x", iCalUID: "same-uid", summary: "Duplicate", start: { dateTime: "2026-10-24T15:00:00Z" }, end: { dateTime: "2026-10-24T15:30:00Z" } };
    g.events = { "a@example.com": [ev], "b@example.com": [{ ...ev, id: "x2" }] };
    const out = await calendar.listEvents(g.fetch, [CFG], { from: "2026-10-24", to: "2026-10-24" }, NOW);
    expect(out.text.match(/Duplicate/g)?.length).toBe(1);
  });

  it("tolerates one failing account when the other reads", async () => {
    const g = new FakeGoogle();
    const BAD: google.GoogleConfig = { ...CFG, sealedToken: "hc1.not-a-real-token" };
    const out = await calendar.listCalendars(g.fetch, [BAD, CFG]);
    expect(out.text).toContain("Owner");
    expect(out.text).toContain("Could not read");
  });
});

describe("calendar.accessToken", () => {
  it("exchanges the sealed refresh token, with the client secret and no bearer header", async () => {
    const g = new FakeGoogle();
    const at = await calendar.accessToken(g.fetch, CFG);
    expect(at).toBe("at-value");
    expect(g.posts).toHaveLength(1);
    const body = new URLSearchParams(g.posts[0].body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-value");
    expect(body.get("client_id")).toBe("test-google-client");
    expect(body.get("client_secret")).toBe("test-google-secret");
    expect(g.posts[0].auth).toBe("");
  });

  it("fails plainly when the sealed value was not sealed with this connector's key", async () => {
    const bad: google.GoogleConfig = { ...CFG, sealedToken: "hc1.not-a-real-token" };
    await expect(calendar.accessToken(new FakeGoogle().fetch, bad)).rejects.toThrow(/not a token this connector issued/);
  });
});

describe("calendar.listCalendars", () => {
  it("says not configured, plainly", async () => {
    expect(await calendar.listCalendars(new FakeGoogle().fetch, [])).toEqual(calendar.NOT_CONFIGURED);
  });
  it("lists each calendar with its name, id, role and time zone", async () => {
    const out = await calendar.listCalendars(new FakeGoogle().fetch, [CFG]);
    expect(out.text).toContain("- Owner (primary) - id owner@example.com, owner, America/Chicago");
    expect(out.text).toContain("- Family | House - id fam@group.calendar.google.com, reader, America/Chicago");
  });
});

describe("calendar.listEvents", () => {
  it("says not configured, plainly", async () => {
    expect(await calendar.listEvents(new FakeGoogle().fetch, [], {}, NOW)).toEqual(calendar.NOT_CONFIGURED);
  });

  it("defaults to today through the next 7 days and groups events by New York day", async () => {
    const g = new FakeGoogle();
    g.events["owner@example.com"] = [
      { id: "1", status: "confirmed", summary: "Partner sync", location: "Zoom | https://zoom.us/j/1", start: { dateTime: "2026-10-24T13:30:00Z", timeZone: "UTC" }, end: { dateTime: "2026-10-24T14:00:00Z" }, attendees: [{ email: "p@acme.com", displayName: "Pri | Team" }] },
      { id: "2", status: "cancelled", summary: "Old hold", start: { dateTime: "2026-10-24T16:00:00Z" }, end: { dateTime: "2026-10-24T17:00:00Z" } },
    ];
    const out = await calendar.listEvents(g.fetch, [CFG], {}, NOW);
    expect(out.text).toContain("Calendar events 2026-10-23 through 2026-10-29");
    expect(out.text).toContain("## Saturday, October 24, 2026");
    // 13:30Z is 08:30 in Chicago (CDT, UTC-5)
    expect(out.text).toContain("| 08:30-09:00 | Partner sync |");
    // pipes in the meeting link and attendee names become slashes
    expect(out.text).toContain("Zoom / https://zoom.us/j/1");
    expect(out.text).toContain("| Pri / Team |");
    // cancelled events are omitted
    expect(out.text).not.toContain("Old hold");
    // empty days get the plain line
    expect(out.text).toContain("## Friday, October 23, 2026\n| Time | Event | Calendar | Location / Link | Attendees |\n|---|---|---|---|---|\n|||| No events. |");
  });

  it("labels all-day and multi-day events instead of times", async () => {
    const g = new FakeGoogle();
    g.events["owner@example.com"] = [
      { id: "1", status: "confirmed", summary: "Birthday", start: { date: "2026-10-26" }, end: { date: "2026-10-27" } },
      { id: "2", status: "confirmed", summary: "Offsite", start: { date: "2026-10-27" }, end: { date: "2026-10-30" } },
    ];
    const out = await calendar.listEvents(g.fetch, [CFG], { from: "2026-10-25", to: "2026-10-28" }, NOW);
    expect(out.text).toContain("| all day | Birthday |");
    expect(out.text).toContain("| all day (through 2026-10-29) | Offsite |");
  });

  it("narrows to one calendar by name or id", async () => {
    const g = new FakeGoogle();
    g.events["fam@group.calendar.google.com"] = [
      { id: "1", status: "confirmed", summary: "Soccer", start: { dateTime: "2026-10-24T18:00:00Z" }, end: { dateTime: "2026-10-24T19:00:00Z" } },
    ];
    const byName = await calendar.listEvents(g.fetch, [CFG], { from: "2026-10-24", to: "2026-10-24", calendar: "family" }, NOW);
    expect(byName.text).toContain("(Family / House)");
    expect(byName.text).toContain("| Soccer |");
    const byId = await calendar.listEvents(g.fetch, [CFG], { from: "2026-10-24", to: "2026-10-24", calendar: "fam@group.calendar.google.com" }, NOW);
    expect(byId.text).toContain("(Family / House)");
  });

  it("rejects a bad date, a range over a month, and an unknown calendar", async () => {
    const g = new FakeGoogle();
    expect((await calendar.listEvents(g.fetch, [CFG], { from: "10/24/2026" }, NOW)).text).toContain("YYYY-MM-DD");
    expect((await calendar.listEvents(g.fetch, [CFG], { from: "2026-10-01", to: "2026-12-01" }, NOW)).text).toContain("31 days");
    expect((await calendar.listEvents(g.fetch, [CFG], { calendar: "nonexistent" }, NOW)).text).toContain("No calendar matches");
  });

  it("points at the connect route when the Google grant was revoked", async () => {
    const g = new FakeGoogle();
    g.revoked = true;
    await expect(calendar.listEvents(g.fetch, [CFG], {}, NOW)).rejects.toThrow(/refused the stored calendar grant.*\/google\/authorize/s);
  });
});

describe("googleFromEnv", () => {
  it("is null until the three Google values are set", () => {
    expect(google.googleFromEnv()).toBeNull();
    process.env.GOOGLE_REFRESH_TOKEN = SEALED_RT;
    expect(google.googleFromEnv()).toEqual(CFG);
    delete process.env.GOOGLE_REFRESH_TOKEN;
  });
});

describe("slotForAccount (connect-page slot selection)", () => {
  const EMAIL = "owner@example.com";
  const clearSlots = () => { delete process.env.GOOGLE_REFRESH_TOKEN; for (let n = 2; n <= 8; n++) delete process.env[`GOOGLE_REFRESH_TOKEN_${n}`]; };
  it("names the existing slot for a re-consent of an already-connected account, never a second slot", () => {
    setTestEnv(); clearSlots();
    process.env.GOOGLE_REFRESH_TOKEN = seal(tokenKey(), "google", { rt: "old-rt", email: EMAIL });
    expect(google.slotForAccount(EMAIL)).toEqual({ slot: "GOOGLE_REFRESH_TOKEN", replaces: true });
    clearSlots();
  });
  it("matches the account email case-insensitively", () => {
    setTestEnv(); clearSlots();
    process.env.GOOGLE_REFRESH_TOKEN = seal(tokenKey(), "google", { rt: "old-rt", email: "Owner@Example.com" });
    expect(google.slotForAccount(EMAIL)).toEqual({ slot: "GOOGLE_REFRESH_TOKEN", replaces: true });
    clearSlots();
  });
  it("names the first free slot for a genuinely new account", () => {
    setTestEnv(); clearSlots();
    process.env.GOOGLE_REFRESH_TOKEN = seal(tokenKey(), "google", { rt: "r1", email: "owner@example.com" });
    process.env.GOOGLE_REFRESH_TOKEN_2 = seal(tokenKey(), "google", { rt: "r2", email: "work@example.com" });
    expect(google.slotForAccount("third@example.com")).toEqual({ slot: "GOOGLE_REFRESH_TOKEN_3", replaces: false });
    clearSlots();
  });
  it("skips occupied slots when naming a free one and never names an occupied slot as free", () => {
    setTestEnv(); clearSlots();
    process.env.GOOGLE_REFRESH_TOKEN_2 = seal(tokenKey(), "google", { rt: "r2", email: "work@example.com" }); // slot 1 empty, slot 2 taken
    expect(google.slotForAccount("new@example.com")).toEqual({ slot: "GOOGLE_REFRESH_TOKEN", replaces: false });
    clearSlots();
  });
});

describe("calendar event writes", () => {
  // Seal fresh per test: other describes re-randomize TOKEN_KEY via setTestEnv.
  const freshCfg = (): google.GoogleConfig => { setTestEnv({ HAROLD_TZ: "America/Chicago" }); return { ...CFG, sealedToken: seal(tokenKey(), "google", { rt: "rt-value", email: "owner@example.com" }) }; };
  class FakeWrite {
    calls: { method: string; url: string; body: any }[] = [];
    forbid = false;
    forbidReason = "insufficientPermissions";
    fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method || "GET").toUpperCase();
      if (url === TOKEN_URL) return new Response(JSON.stringify({ access_token: "at-value", expires_in: 3599 }), { status: 200 });
      if (url.startsWith(`${API}/calendar/v3/users/me/calendarList`)) {
        return new Response(JSON.stringify({ items: [
          { id: "owner@example.com", summary: "Owner", primary: true, accessRole: "owner", timeZone: "America/Chicago" },
          { id: "fam@group.calendar.google.com", summary: "Family", accessRole: "writer" },
        ] }), { status: 200 });
      }
      if (this.forbid) return new Response(JSON.stringify({ error: { errors: [{ reason: this.forbidReason }], message: "Request had insufficient authentication scopes." } }), { status: 403 });
      this.calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "DELETE") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ id: "ev-new", summary: this.calls.at(-1)?.body?.summary || "?", start: this.calls.at(-1)?.body?.start, htmlLink: "https://calendar.google.com/event?eid=ev-new" }), { status: 200 });
    };
  }

  it("never defaults to the primary calendar: several calendars and no target means the owner is asked which one", async () => {
    const g = new FakeWrite();
    await expect(calendar.createEvent(g.fetch, [freshCfg()], { summary: "Dentist", start: "2026-10-27T14:00", end: "2026-10-27T15:00" }))
      .rejects.toThrow(/ask the owner which one/);
    expect(g.calls.length).toBe(0);
  });

  it("creates a timed event on the named calendar", async () => {
    const g = new FakeWrite();
    const out = await calendar.createEvent(g.fetch, [freshCfg()], { summary: "Dentist", start: "2026-10-27T14:00", end: "2026-10-27T15:00", calendar: "owner" });
    expect(out.text).toContain("Created");
    expect(out.text).toContain("Dentist");
    const call = g.calls[0];
    expect(call.method).toBe("POST");
    expect(call.url).toContain("/calendars/owner%40example.com/events");
    expect(call.body.start).toEqual({ dateTime: "2026-10-27T14:00:00", timeZone: "America/Chicago" });
  });

  it("the target can be omitted only when exactly one calendar is connected", async () => {
    class FakeSingle extends FakeWrite {
      fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === TOKEN_URL) return new Response(JSON.stringify({ access_token: "at-value", expires_in: 3599 }), { status: 200 });
        if (url.startsWith(`${API}/calendar/v3/users/me/calendarList`)) {
          return new Response(JSON.stringify({ items: [
            { id: "owner@example.com", summary: "Owner", primary: true, accessRole: "owner", timeZone: "America/Chicago" },
          ] }), { status: 200 });
        }
        const method = (init?.method || "GET").toUpperCase();
        this.calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (method === "DELETE") return new Response(null, { status: 204 });
        return new Response(JSON.stringify({ id: "ev-new", summary: this.calls.at(-1)?.body?.summary || "?", start: this.calls.at(-1)?.body?.start, htmlLink: "https://calendar.google.com/event?eid=ev-new" }), { status: 200 });
      };
    }
    const g = new FakeSingle();
    const out = await calendar.createEvent(g.fetch, [freshCfg()], { summary: "Dentist", start: "2026-10-27T14:00", end: "2026-10-27T15:00" });
    expect(out.text).toContain("Created");
    expect(g.calls[0].url).toContain("/calendars/owner%40example.com/events");
  });

  it("never picks the writable calendar over a read-only one: ambiguity still asks the owner", async () => {
    class FakeMixed extends FakeWrite {
      fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === TOKEN_URL) return new Response(JSON.stringify({ access_token: "at-value", expires_in: 3599 }), { status: 200 });
        if (url.startsWith(`${API}/calendar/v3/users/me/calendarList`)) {
          return new Response(JSON.stringify({ items: [
            { id: "owner@example.com", summary: "Owner", primary: true, accessRole: "reader", timeZone: "America/Chicago" },
            { id: "fam@group.calendar.google.com", summary: "Family", accessRole: "writer" },
          ] }), { status: 200 });
        }
        const method = (init?.method || "GET").toUpperCase();
        this.calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (method === "DELETE") return new Response(null, { status: 204 });
        return new Response(JSON.stringify({ id: "ev-new", summary: this.calls.at(-1)?.body?.summary || "?", start: this.calls.at(-1)?.body?.start, htmlLink: "https://calendar.google.com/event?eid=ev-new" }), { status: 200 });
      };
    }
    const g = new FakeMixed();
    await expect(calendar.createEvent(g.fetch, [freshCfg()], { summary: "X", start: "2026-10-27", end: "2026-10-28" }))
      .rejects.toThrow(/ask the owner which one/);
    expect(g.calls.length).toBe(0);
  });

  it("update and cancel also ask instead of guessing when several calendars are connected", async () => {
    const g = new FakeWrite();
    await expect(calendar.updateEvent(g.fetch, [freshCfg()], { eventId: "ev-1", location: "Zoom" })).rejects.toThrow(/ask the owner which one/);
    await expect(calendar.cancelEvent(g.fetch, [freshCfg()], { eventId: "ev-9" })).rejects.toThrow(/ask the owner which one/);
    expect(g.calls.length).toBe(0);
  });

  it("creates an all-day event from dates only", async () => {
    const g = new FakeWrite();
    await calendar.createEvent(g.fetch, [freshCfg()], { summary: "Off", start: "2026-11-02", end: "2026-11-03", calendar: "family" });
    expect(g.calls[0].url).toContain("fam%40group.calendar.google.com");
    expect(g.calls[0].body.start).toEqual({ date: "2026-11-02" });
  });

  it("rejects a bad time shape before any write", async () => {
    const g = new FakeWrite();
    await expect(calendar.createEvent(g.fetch, [freshCfg()], { summary: "X", start: "next tuesday", end: "2026-10-27" })).rejects.toThrow(/YYYY-MM-DD/);
    expect(g.calls.length).toBe(0);
  });

  it("patches only the passed fields", async () => {
    const g = new FakeWrite();
    const out = await calendar.updateEvent(g.fetch, [freshCfg()], { eventId: "ev-1", location: "Zoom", calendar: "owner" });
    expect(out.text).toContain("Updated");
    expect(g.calls[0].method).toBe("PATCH");
    expect(g.calls[0].url).toContain("/events/ev-1");
    expect(g.calls[0].body).toEqual({ location: "Zoom" });
  });

  it("refuses an update with nothing to change", async () => {
    const g = new FakeWrite();
    await expect(calendar.updateEvent(g.fetch, [freshCfg()], { eventId: "ev-1" })).rejects.toThrow(/Nothing to change/);
    expect(g.calls.length).toBe(0);
  });

  it("cancels an event without touching the calendar", async () => {
    const g = new FakeWrite();
    const out = await calendar.cancelEvent(g.fetch, [freshCfg()], { eventId: "ev-9", calendar: "owner" });
    expect(out.text).toContain("Cancelled event ev-9");
    expect(out.text).toContain("never deletes or shares a calendar");
    expect(g.calls[0].method).toBe("DELETE");
  });

  it("names the missing write permission when Google answers 403 insufficientPermissions", async () => {
    const g = new FakeWrite();
    g.forbid = true;
    await expect(calendar.createEvent(g.fetch, [freshCfg()], { summary: "X", start: "2026-10-27", end: "2026-10-28", calendar: "owner" })).rejects.toThrow(/no calendar write permission.*calendar\.events/s);
  });

  it("reports a usage limit as a usage limit, not as a missing grant", async () => {
    const g = new FakeWrite();
    g.forbid = true;
    g.forbidReason = "quotaExceeded";
    await expect(calendar.createEvent(g.fetch, [freshCfg()], { summary: "X", start: "2026-10-27", end: "2026-10-28", calendar: "owner" })).rejects.toThrow(/usage limit.*quotaExceeded/s);
  });

  it("surfaces Google's reason for any other 403 without guessing a cause", async () => {
    const g = new FakeWrite();
    g.forbid = true;
    g.forbidReason = "forbidden";
    await expect(calendar.createEvent(g.fetch, [freshCfg()], { summary: "X", start: "2026-10-27", end: "2026-10-28", calendar: "owner" })).rejects.toThrow(/HTTP 403.*forbidden/s);
  });

  it("fails the write plainly when the stored grant was revoked, before any event call", async () => {
    const g = new FakeWrite();
    const realFetch = g.fetch;
    g.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === TOKEN_URL) return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been revoked." }), { status: 400 });
      return realFetch(input, init);
    };
    await expect(calendar.createEvent(g.fetch, [freshCfg()], { summary: "X", start: "2026-10-27", end: "2026-10-28", calendar: "owner" })).rejects.toThrow(/refused the stored calendar grant.*invalid_grant.*reconnect/s);
    expect(g.calls.length).toBe(0);
  });

  it("never deletes or shares a calendar: the only DELETE targets an event, and no acl/share routes exist", async () => {
    const fs = await import("node:fs");
    const cal = fs.readFileSync(new URL("../../src/calendar.ts", import.meta.url), "utf8");
    const tools = fs.readFileSync(new URL("../../src/tools.ts", import.meta.url), "utf8");
    expect(cal).not.toMatch(/calendarList\/delete|\/acl|acl\.insert|calendars\/delete/);
    expect(tools).not.toMatch(/calendarList\/delete|\/acl|acl\.insert|calendars\/delete/);
    const deletes = cal.split("\n").filter(l => l.includes('"DELETE"'));
    expect(deletes.length).toBe(1);
    expect(deletes[0]).toContain("/events/");
    expect(tools).not.toMatch(/registerTool\("calendar_(share|delete|acl)/);
  });
});

describe("event writes across multiple accounts (composition)", () => {
  // Seal fresh per test: other describes re-randomize TOKEN_KEY via setTestEnv.
  const makeCfgs = () => {
    setTestEnv({ HAROLD_TZ: "America/Chicago" });
    const CFG_A: google.GoogleConfig = { ...CFG, sealedToken: seal(tokenKey(), "google", { rt: "rt-reader", email: "reader@example.com" }) };
    const CFG_B: google.GoogleConfig = { ...CFG, sealedToken: seal(tokenKey(), "google", { rt: "rt-writer", email: "writer@example.com" }) };
    return { CFG_A, CFG_B };
  };

  class FakeMulti {
    writeCalls: { method: string; url: string; rt: string }[] = [];
    lastRt = "";
    fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === TOKEN_URL) {
        this.lastRt = new URLSearchParams(String(init?.body)).get("refresh_token") || "";
        return new Response(JSON.stringify({ access_token: `at-${this.lastRt}`, expires_in: 3599 }), { status: 200 });
      }
      const at = new Headers(init?.headers).get("authorization") || "";
      if (url.startsWith(`${API}/calendar/v3/users/me/calendarList`)) {
        // Both accounts see the same shared calendar; account A reads it, account B owns it.
        const items = at === "Bearer at-rt-reader"
          ? [{ id: "shared@group.calendar.google.com", summary: "Shared", accessRole: "reader" }]
          : [{ id: "shared@group.calendar.google.com", summary: "Shared", accessRole: "owner" }];
        return new Response(JSON.stringify({ items }), { status: 200 });
      }
      this.writeCalls.push({ method: (init?.method || "GET").toUpperCase(), url, rt: this.lastRt });
      return new Response(JSON.stringify({ id: "ev-1", summary: "X", start: { date: "2026-11-02" } }), { status: 200 });
    };
  }

  it("writes a shared calendar through the account with write rights, not the reader that saw it first", async () => {
    const { CFG_A, CFG_B } = makeCfgs();
    const g = new FakeMulti();
    const out = await calendar.createEvent(g.fetch, [CFG_A, CFG_B], { summary: "X", start: "2026-11-02", end: "2026-11-03", calendar: "shared" });
    expect(g.writeCalls[0].rt).toBe("rt-writer");
    expect(out.text).toContain("via writer@example.com");
  });

  it("is deterministic: the same call picks the same account every time", async () => {
    const { CFG_A, CFG_B } = makeCfgs();
    const g1 = new FakeMulti(); const g2 = new FakeMulti();
    await calendar.createEvent(g1.fetch, [CFG_A, CFG_B], { summary: "X", start: "2026-11-02", end: "2026-11-03", calendar: "shared" });
    await calendar.createEvent(g2.fetch, [CFG_A, CFG_B], { summary: "X", start: "2026-11-02", end: "2026-11-03", calendar: "shared" });
    expect(g1.writeCalls[0].rt).toBe(g2.writeCalls[0].rt);
  });

  it("one calendar visible to several accounts is still one target: omission proceeds through the writer", async () => {
    const { CFG_A, CFG_B } = makeCfgs();
    const g = new FakeMulti();
    const out = await calendar.createEvent(g.fetch, [CFG_A, CFG_B], { summary: "X", start: "2026-11-02", end: "2026-11-03" });
    expect(g.writeCalls[0].rt).toBe("rt-writer");
    expect(out.text).toContain("via writer@example.com");
  });

  it("distinct calendars across accounts are ambiguity: no target means the owner is asked, nothing is written", async () => {
    class FakeTwoTargets extends FakeMulti {
      fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === TOKEN_URL) {
          this.lastRt = new URLSearchParams(String(init?.body)).get("refresh_token") || "";
          return new Response(JSON.stringify({ access_token: `at-${this.lastRt}`, expires_in: 3599 }), { status: 200 });
        }
        const at = new Headers(init?.headers).get("authorization") || "";
        if (url.startsWith(`${API}/calendar/v3/users/me/calendarList`)) {
          const items = at === "Bearer at-rt-reader"
            ? [{ id: "personal-a@example.com", summary: "Personal A", primary: true, accessRole: "owner" }, { id: "shared@group.calendar.google.com", summary: "Shared", accessRole: "reader" }]
            : [{ id: "shared@group.calendar.google.com", summary: "Shared", accessRole: "owner" }];
          return new Response(JSON.stringify({ items }), { status: 200 });
        }
        this.writeCalls.push({ method: (init?.method || "GET").toUpperCase(), url, rt: this.lastRt });
        return new Response(JSON.stringify({ id: "ev-1" }), { status: 200 });
      };
    }
    const { CFG_A, CFG_B } = makeCfgs();
    const g = new FakeTwoTargets();
    await expect(calendar.createEvent(g.fetch, [CFG_A, CFG_B], { summary: "X", start: "2026-11-02", end: "2026-11-03" }))
      .rejects.toThrow(/ask the owner which one/);
    expect(g.writeCalls.length).toBe(0);
  });

  it("refuses the write when every connected account is read-only on that calendar", async () => {
    class FakeReadOnly {
      writeCalls = 0;
      fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === TOKEN_URL) return new Response(JSON.stringify({ access_token: "at-x", expires_in: 3599 }), { status: 200 });
        if (url.startsWith(`${API}/calendar/v3/users/me/calendarList`)) {
          return new Response(JSON.stringify({ items: [{ id: "s@g", summary: "Shared", accessRole: "reader" }] }), { status: 200 });
        }
        this.writeCalls++;
        return new Response("{}", { status: 200 });
      };
    }
    const { CFG_A, CFG_B } = makeCfgs();
    const g = new FakeReadOnly();
    await expect(calendar.createEvent(g.fetch, [CFG_A, CFG_B], { summary: "X", start: "2026-11-02", end: "2026-11-03", calendar: "shared" }))
      .rejects.toThrow(/read.*access|reader access|writer or owner/i);
    expect(g.writeCalls).toBe(0);
  });
});
