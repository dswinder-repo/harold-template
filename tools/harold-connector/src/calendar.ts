// The calendar read tools: calendar_list and calendar_events. The same env-gated pattern as the
// task manager (src/tasks.ts): without GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and
// GOOGLE_REFRESH_TOKEN the tools say so plainly and point at the alternatives.

import { open } from "./crypto.js";
import { tokenKey, tz } from "./config.js";
import { CALENDAR_API, GOOGLE_TOKEN_URL, type GoogleConfig } from "./google.js";
import type { FetchLike } from "./identity.js";

export interface CalendarResult { text: string; isError?: boolean }

export const NOT_CONFIGURED: CalendarResult = {
  text: "No calendar is configured on this connector (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN are not all set), so no calendar was read. "
    + "Use the calendar connector this chat has, if any; or read a calendar export file in the vault, if there is one, and state its timestamp.",
  isError: true,
};

/** Exchange the stored (sealed) refresh token for a short-lived access token. */
export async function accessToken(fetchImpl: FetchLike, cfg: GoogleConfig): Promise<string> {
  const p = open(tokenKey(), "google", cfg.sealedToken) as { rt?: string; email?: string } | null;
  if (!p || typeof p.rt !== "string" || !p.rt) {
    throw new Error("GOOGLE_REFRESH_TOKEN is not a token this connector issued (reconnect at /google/authorize and update the environment)");
  }
  const r = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: p.rt }).toString(),
  });
  const j = await r.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string };
  if (!r.ok || !j.access_token) {
    throw new Error(`Google refused the stored calendar grant (${j.error || `HTTP ${r.status}`}); reconnect at /google/authorize and update GOOGLE_REFRESH_TOKEN`);
  }
  return j.access_token;
}

export interface CalendarEntry { id: string; summary: string; primary?: boolean; accessRole?: string; timeZone?: string; hidden?: boolean }

export async function listCalendarEntries(fetchImpl: FetchLike, cfg: GoogleConfig): Promise<CalendarEntry[]> {
  const at = await accessToken(fetchImpl, cfg);
  const r = await fetchImpl(`${CALENDAR_API}/users/me/calendarList?maxResults=250&showHidden=false`, { headers: { authorization: `Bearer ${at}` } });
  const j = await r.json().catch(() => ({})) as { items?: CalendarEntry[]; error?: { message?: string } };
  if (!r.ok || !j.items) throw new Error(`Google Calendar answered HTTP ${r.status}${j.error?.message ? ` (${j.error.message})` : ""}`);
  return j.items;
}

/** The account email baked into the sealed token at connect time (offline; "" for older tokens without one). */
function accountEmail(cfg: GoogleConfig): string {
  const p = open(tokenKey(), "google", cfg.sealedToken) as { email?: string } | null;
  return (p && typeof p.email === "string" && p.email) || "(unknown account)";
}

/** A calendar as seen through one connected account; the account's config is kept for its access token. */
interface AccountCalendar { entry: CalendarEntry; cfg: GoogleConfig; email: string }

/** Calendars across every connected account; a calendar visible to several accounts is listed/queried once. */
async function allCalendars(fetchImpl: FetchLike, cfgs: GoogleConfig[]): Promise<{ cals: AccountCalendar[]; failures: string[] }> {
  const seen = new Set<string>();
  const cals: AccountCalendar[] = [];
  const failures: string[] = [];
  for (const cfg of cfgs) {
    const email = accountEmail(cfg);
    try {
      for (const entry of await listCalendarEntries(fetchImpl, cfg)) {
        const key = entry.id.toLowerCase();
        if (seen.has(key)) continue; // shared into more than one connected account: one listing, one query
        seen.add(key);
        cals.push({ entry, cfg, email });
      }
    } catch (e) {
      failures.push(`${email}: ${(e as Error).message}`);
    }
  }
  return { cals, failures };
}

export async function listCalendars(fetchImpl: FetchLike, cfgs: GoogleConfig[]): Promise<CalendarResult> {
  if (!cfgs.length) return NOT_CONFIGURED;
  const { cals, failures } = await allCalendars(fetchImpl, cfgs);
  if (!cals.length && failures.length) throw new Error(failures[0]); // every account failed: surface the reason (e.g. reconnect guidance)
  if (!cals.length) return { text: "The connected Google accounts can see no calendars." };
  const multi = cfgs.length > 1;
  const lines = cals.map(c => `- ${c.entry.summary}${c.entry.primary ? " (primary)" : ""}${multi ? ` [${c.email}]` : ""} - id ${c.entry.id}${c.entry.accessRole ? `, ${c.entry.accessRole}` : ""}${c.entry.timeZone ? `, ${c.entry.timeZone}` : ""}`);
  const failNote = failures.length ? `\n\nCould not read: ${failures.join("; ")}.` : "";
  return { text: `${cals.length} calendar${cals.length === 1 ? "" : "s"} the connector can read${multi ? ` across ${cfgs.length} Google accounts` : ""}:\n${lines.join("\n")}${failNote}` };
}

// ───────────── events ─────────────

interface GEvent {
  status?: string; summary?: string; location?: string; hangoutLink?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string }; end?: { date?: string; dateTime?: string; timeZone?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean; responseStatus?: string }[];
  recurringEventId?: string;
  id?: string; iCalUID?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Events are grouped into days in the owner's time zone (HAROLD_TZ, UTC when unset) - the zone is
// resolved per call from the environment, like every other setting here.
const dayOf = (iso: string, zone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const hmOf = (iso: string, zone: string): string => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
};
/** The instant a wall-clock day:HH:MM happens in the zone, DST-safe (no hardcoded offset). */
function zonedInstant(day: string, hm: string, zone: string): Date {
  const guess = Date.parse(`${day}T${hm}:00Z`);
  const got = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(guess).map(x => [x.type, x.value]));
  const gotMs = Date.parse(`${got.year}-${got.month}-${got.day}T${got.hour === "24" ? "00" : got.hour}:${got.minute}:00Z`);
  return new Date(guess + (guess - gotMs));
}
const headingOf = (day: string, zone: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${day}T12:00:00Z`));
/** Table cells cannot contain pipes; Google fields can. */
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

export interface EventsArgs { from?: string; to?: string; calendar?: string }

export async function listEvents(fetchImpl: FetchLike, cfgs: GoogleConfig[], args: EventsArgs, now = new Date()): Promise<CalendarResult> {
  if (!cfgs.length) return NOT_CONFIGURED;
  const zone = tz();
  const from = args.from || dayOf(now.toISOString(), zone);
  if (!DATE_RE.test(from) || (args.to && !DATE_RE.test(args.to))) return { text: "Dates must be YYYY-MM-DD.", isError: true };
  const to = args.to || new Date(Date.parse(`${from}T12:00:00Z`) + 6 * 86400_000).toISOString().slice(0, 10);
  if (to < from) return { text: `to (${to}) is before from (${from})`, isError: true };
  if ((Date.parse(to) - Date.parse(from)) / 86400_000 > 31) return { text: "Range too wide: keep it to 31 days (the brief needs 7).", isError: true };

  const { cals: all, failures: acctFailures } = await allCalendars(fetchImpl, cfgs);
  if (!all.length && acctFailures.length) throw new Error(acctFailures[0]); // every account failed: surface the reason (e.g. reconnect guidance)
  const multi = cfgs.length > 1;
  let cals = all;
  if (args.calendar) {
    const q = args.calendar.toLowerCase();
    cals = all.filter(c => c.entry.id.toLowerCase() === q || c.entry.summary.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
    if (!cals.length) return { text: `No calendar matches "${args.calendar}". The connector can read: ${all.map(c => c.entry.summary).join(", ")}.`, isError: true };
  }

  const atByCfg = new Map<GoogleConfig, string>();
  const atFor = async (cfg: GoogleConfig) => {
    let at = atByCfg.get(cfg);
    if (!at) { at = await accessToken(fetchImpl, cfg); atByCfg.set(cfg, at); }
    return at;
  };
  // timeMin/timeMax are instants; span whole days in the owner's zone, grouped into day rows below.
  const timeMin = zonedInstant(from, "00:00", zone).toISOString();
  const timeMax = zonedInstant(to, "23:59", zone).toISOString();
  interface Row { day: string; time: string; title: string; cal: string; loc: string; attendees: string; sort: string }
  const rows: Row[] = [];
  const failures: string[] = [];
  const seenEvents = new Set<string>();
  for (const { entry: cal, cfg, email } of cals) {
    let at: string;
    try { at = await atFor(cfg); } catch (e) { failures.push(`${cal.summary} (${email}): ${(e as Error).message}`); continue; }
    const calLabel = multi ? `${cal.summary} (${email})` : cal.summary;
    const u = `${CALENDAR_API}/calendars/${encodeURIComponent(cal.id)}/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&timeZone=${encodeURIComponent(zone)}`;
    const r = await fetchImpl(u, { headers: { authorization: `Bearer ${at}` } });
    const j = await r.json().catch(() => ({})) as { items?: GEvent[]; error?: { message?: string } };
    if (!r.ok) { failures.push(`${cal.summary}: HTTP ${r.status}${j.error?.message ? ` (${j.error.message})` : ""}`); continue; }
    for (const ev of j.items || []) {
      if (ev.status === "cancelled") continue;
      const evKey = ev.iCalUID || ev.id || "";
      if (evKey) {
        if (seenEvents.has(evKey)) continue; // the same event visible on two calendars is shown once
        seenEvents.add(evKey);
      } // with singleEvents=true Google expands series; cancelled instances are dropped here
      const title = cell(ev.summary || "(no title)");
      const loc = cell(ev.hangoutLink ? "Google Meet" : (ev.location || ""));
      const attendees = (ev.attendees || []).filter(a => !a.self).map(a => cell(a.displayName || a.email || "")).filter(Boolean).join(", ");
      if (ev.start?.date) {
        // All-day: Google ends the day AFTER, so a multi-day event spans start.date .. end.date-1.
        const endDay = ev.end?.date ? dayOf(new Date(new Date(`${ev.end.date}T12:00:00Z`).getTime() - 86400_000).toISOString(), zone) : ev.start.date;
        const label = endDay > ev.start.date ? `all day (through ${endDay})` : "all day";
        rows.push({ day: ev.start.date, time: label, title, cal: cell(calLabel), loc, attendees, sort: `${ev.start.date} 00:00` });
      } else if (ev.start?.dateTime && ev.end?.dateTime) {
        rows.push({ day: dayOf(ev.start.dateTime, zone), time: `${hmOf(ev.start.dateTime, zone)}-${hmOf(ev.end.dateTime, zone)}`, title, cal: cell(calLabel), loc, attendees, sort: `${dayOf(ev.start.dateTime, zone)} ${hmOf(ev.start.dateTime, zone)}` });
      }
    }
  }
  rows.sort((a, b) => a.sort.localeCompare(b.sort) || a.cal.localeCompare(b.cal));
  // Every day in the range gets a section, so "nothing on Tuesday" is visible.
  const days: string[] = [];
  for (let d = from; d <= to; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10)) days.push(d);
  const sections = days.map(day => {
    const body = rows.filter(r => r.day === day).map(r => `| ${r.time} | ${r.title} | ${r.cal} | ${r.loc} | ${r.attendees} |`).join("\n");
    return `## ${headingOf(day, zone)}\n| Time | Event | Calendar | Location / Link | Attendees |\n|---|---|---|---|---|\n${body || "|||| No events. |"}`;
  });
  const header = `Calendar events ${from} through ${to} (${zone}), from the connector's own Google Calendar access (${cals.map(c => cell(multi ? `${c.entry.summary} (${c.email})` : c.entry.summary)).join(", ")}). Recurring events are expanded per day; cancelled events are omitted.`;
  const allFailures = [...acctFailures, ...failures];
  const failNote = allFailures.length ? `\n\nCould not read: ${allFailures.join("; ")}.` : "";
  return { text: header + failNote + `\n\n${sections.join("\n\n")}` };
}
