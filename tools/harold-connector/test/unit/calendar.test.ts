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
      if (this.revoked) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      return new Response(JSON.stringify({ access_token: "at-value", expires_in: 3599 }), { status: 200 });
    }
    if (url.startsWith(`${API}/calendar/v3/users/me/calendarList`)) {
      return new Response(JSON.stringify({ items: this.calendarList }), { status: 200 });
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
      if (url === google.GOOGLE_USERINFO_URL) {
        return new Response(JSON.stringify({ email: grant.email }), { status: 200 });
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
    expect(await calendar.listCalendars(new FakeGoogle().fetch, null)).toEqual(calendar.NOT_CONFIGURED);
  });
  it("lists each calendar with its name, id, role and time zone", async () => {
    const out = await calendar.listCalendars(new FakeGoogle().fetch, CFG);
    expect(out.text).toContain("- Owner (primary) - id owner@example.com, owner, America/Chicago");
    expect(out.text).toContain("- Family | House - id fam@group.calendar.google.com, reader, America/Chicago");
  });
});

describe("calendar.listEvents", () => {
  it("says not configured, plainly", async () => {
    expect(await calendar.listEvents(new FakeGoogle().fetch, null, {}, NOW)).toEqual(calendar.NOT_CONFIGURED);
  });

  it("defaults to today through the next 7 days and groups events by New York day", async () => {
    const g = new FakeGoogle();
    g.events["owner@example.com"] = [
      { id: "1", status: "confirmed", summary: "Partner sync", location: "Zoom | https://zoom.us/j/1", start: { dateTime: "2026-10-24T13:30:00Z", timeZone: "UTC" }, end: { dateTime: "2026-10-24T14:00:00Z" }, attendees: [{ email: "p@acme.com", displayName: "Pri | Team" }] },
      { id: "2", status: "cancelled", summary: "Old hold", start: { dateTime: "2026-10-24T16:00:00Z" }, end: { dateTime: "2026-10-24T17:00:00Z" } },
    ];
    const out = await calendar.listEvents(g.fetch, CFG, {}, NOW);
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
    const out = await calendar.listEvents(g.fetch, CFG, { from: "2026-10-25", to: "2026-10-28" }, NOW);
    expect(out.text).toContain("| all day | Birthday |");
    expect(out.text).toContain("| all day (through 2026-10-29) | Offsite |");
  });

  it("narrows to one calendar by name or id", async () => {
    const g = new FakeGoogle();
    g.events["fam@group.calendar.google.com"] = [
      { id: "1", status: "confirmed", summary: "Soccer", start: { dateTime: "2026-10-24T18:00:00Z" }, end: { dateTime: "2026-10-24T19:00:00Z" } },
    ];
    const byName = await calendar.listEvents(g.fetch, CFG, { from: "2026-10-24", to: "2026-10-24", calendar: "family" }, NOW);
    expect(byName.text).toContain("(Family / House)");
    expect(byName.text).toContain("| Soccer |");
    const byId = await calendar.listEvents(g.fetch, CFG, { from: "2026-10-24", to: "2026-10-24", calendar: "fam@group.calendar.google.com" }, NOW);
    expect(byId.text).toContain("(Family / House)");
  });

  it("rejects a bad date, a range over a month, and an unknown calendar", async () => {
    const g = new FakeGoogle();
    expect((await calendar.listEvents(g.fetch, CFG, { from: "10/24/2026" }, NOW)).text).toContain("YYYY-MM-DD");
    expect((await calendar.listEvents(g.fetch, CFG, { from: "2026-10-01", to: "2026-12-01" }, NOW)).text).toContain("31 days");
    expect((await calendar.listEvents(g.fetch, CFG, { calendar: "nonexistent" }, NOW)).text).toContain("No calendar matches");
  });

  it("points at the connect route when the Google grant was revoked", async () => {
    const g = new FakeGoogle();
    g.revoked = true;
    await expect(calendar.listEvents(g.fetch, CFG, {}, NOW)).rejects.toThrow(/refused the stored calendar grant.*\/google\/authorize/s);
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
