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

export async function listCalendars(fetchImpl: FetchLike, cfg: GoogleConfig | null): Promise<CalendarResult> {
  if (!cfg) return NOT_CONFIGURED;
  const items = await listCalendarEntries(fetchImpl, cfg);
  if (!items.length) return { text: "The connected Google account can see no calendars." };
  const lines = items.map(c => `- ${c.summary}${c.primary ? " (primary)" : ""} - id ${c.id}${c.accessRole ? `, ${c.accessRole}` : ""}${c.timeZone ? `, ${c.timeZone}` : ""}`);
  return { text: `${items.length} calendar${items.length === 1 ? "" : "s"} the connector can read:\n${lines.join("\n")}` };
}

// ───────────── events ─────────────

interface GEvent {
  status?: string; summary?: string; location?: string; hangoutLink?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string }; end?: { date?: string; dateTime?: string; timeZone?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean; responseStatus?: string }[];
  recurringEventId?: string;
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

export async function listEvents(fetchImpl: FetchLike, cfg: GoogleConfig | null, args: EventsArgs, now = new Date()): Promise<CalendarResult> {
  if (!cfg) return NOT_CONFIGURED;
  const zone = tz();
  const from = args.from || dayOf(now.toISOString(), zone);
  if (!DATE_RE.test(from) || (args.to && !DATE_RE.test(args.to))) return { text: "Dates must be YYYY-MM-DD.", isError: true };
  const to = args.to || new Date(Date.parse(`${from}T12:00:00Z`) + 6 * 86400_000).toISOString().slice(0, 10);
  if (to < from) return { text: `to (${to}) is before from (${from})`, isError: true };
  if ((Date.parse(to) - Date.parse(from)) / 86400_000 > 31) return { text: "Range too wide: keep it to 31 days (the brief needs 7).", isError: true };

  const all = await listCalendarEntries(fetchImpl, cfg);
  let cals = all;
  if (args.calendar) {
    const q = args.calendar.toLowerCase();
    cals = all.filter(c => c.id.toLowerCase() === q || c.summary.toLowerCase().includes(q));
    if (!cals.length) return { text: `No calendar matches "${args.calendar}". The connector can read: ${all.map(c => c.summary).join(", ")}.`, isError: true };
  }

  const at = await accessToken(fetchImpl, cfg);
  // timeMin/timeMax are instants; span whole days in the owner's zone, grouped into day rows below.
  const timeMin = zonedInstant(from, "00:00", zone).toISOString();
  const timeMax = zonedInstant(to, "23:59", zone).toISOString();
  interface Row { day: string; time: string; title: string; cal: string; loc: string; attendees: string; sort: string }
  const rows: Row[] = [];
  const failures: string[] = [];
  for (const cal of cals) {
    const u = `${CALENDAR_API}/calendars/${encodeURIComponent(cal.id)}/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&timeZone=${encodeURIComponent(zone)}`;
    const r = await fetchImpl(u, { headers: { authorization: `Bearer ${at}` } });
    const j = await r.json().catch(() => ({})) as { items?: GEvent[]; error?: { message?: string } };
    if (!r.ok) { failures.push(`${cal.summary}: HTTP ${r.status}${j.error?.message ? ` (${j.error.message})` : ""}`); continue; }
    for (const ev of j.items || []) {
      if (ev.status === "cancelled") continue; // with singleEvents=true Google expands series; cancelled instances are dropped here
      const title = cell(ev.summary || "(no title)");
      const loc = cell(ev.hangoutLink ? "Google Meet" : (ev.location || ""));
      const attendees = (ev.attendees || []).filter(a => !a.self).map(a => cell(a.displayName || a.email || "")).filter(Boolean).join(", ");
      if (ev.start?.date) {
        // All-day: Google ends the day AFTER, so a multi-day event spans start.date .. end.date-1.
        const endDay = ev.end?.date ? dayOf(new Date(new Date(`${ev.end.date}T12:00:00Z`).getTime() - 86400_000).toISOString(), zone) : ev.start.date;
        const label = endDay > ev.start.date ? `all day (through ${endDay})` : "all day";
        rows.push({ day: ev.start.date, time: label, title, cal: cal.summary, loc, attendees, sort: `${ev.start.date} 00:00` });
      } else if (ev.start?.dateTime && ev.end?.dateTime) {
        rows.push({ day: dayOf(ev.start.dateTime, zone), time: `${hmOf(ev.start.dateTime, zone)}-${hmOf(ev.end.dateTime, zone)}`, title, cal: cal.summary, loc, attendees, sort: `${dayOf(ev.start.dateTime, zone)} ${hmOf(ev.start.dateTime, zone)}` });
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
  const header = `Calendar events ${from} through ${to} (${zone}), from the connector's own Google Calendar access (${cals.map(c => cell(c.summary)).join(", ")}). Recurring events are expanded per day; cancelled events are omitted.`;
  const failNote = failures.length ? `\n\nCould not read: ${failures.join("; ")}.` : "";
  return { text: header + failNote + `\n\n${sections.join("\n\n")}` };
}

// ───────────── event writes (create / edit / cancel) ─────────────
// These call the Calendar write endpoints. They need the calendar.events scope, which the
// connector's OAuth client does not request yet; until that grant exists Google answers 403
// and the error text says so. Sharing calendars and deleting calendars are out of scope by design.

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export interface EventWriteArgs {
  calendar?: string;            // calendar id or name substring; default: the primary calendar
  summary?: string;             // event title
  start?: string;               // YYYY-MM-DD (all-day) or YYYY-MM-DDTHH:MM (owner's zone)
  end?: string;                 // same shape as start
  location?: string;
  description?: string;
  attendees?: string[];         // email addresses
  eventId?: string;             // for update/cancel
}

interface EventBody {
  summary?: string; location?: string; description?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  attendees?: { email: string }[];
}

/** A start/end string becomes an all-day date or a zoned dateTime, never a naive instant. */
function whenParam(v: string, zone: string): { date?: string; dateTime?: string; timeZone?: string } {
  if (DATE_RE.test(v)) return { date: v };
  if (DATETIME_RE.test(v)) return { dateTime: v.length === 16 ? `${v}:00` : v, timeZone: zone };
  throw new Error(`Time "${v}" must be YYYY-MM-DD (all-day) or YYYY-MM-DDTHH:MM (24h, owner's zone).`);
}

/** Resolve the target calendar: the one named, else the primary. */
async function writeCalendar(fetchImpl: FetchLike, cfg: GoogleConfig, name?: string): Promise<CalendarEntry> {
  const items = await listCalendarEntries(fetchImpl, cfg);
  if (!items.length) throw new Error("The connected Google account can see no calendars.");
  if (!name) {
    const primary = items.find(c => c.primary);
    if (!primary) throw new Error("No primary calendar found; pass calendar to pick one by name or id.");
    return primary;
  }
  const q = name.toLowerCase();
  const hits = items.filter(c => c.id.toLowerCase() === q || c.summary.toLowerCase().includes(q));
  if (!hits.length) throw new Error(`No calendar matches "${name}". The connector can read: ${items.map(c => c.summary).join(", ")}.`);
  if (hits.length > 1 && !hits.some(c => c.id.toLowerCase() === q)) throw new Error(`"${name}" matches several calendars (${hits.map(c => c.summary).join(", ")}); use the exact id from calendar_list.`);
  return hits.find(c => c.id.toLowerCase() === q) || hits[0];
}

function writeBody(args: EventWriteArgs, zone: string, partial: boolean): EventBody {
  const body: EventBody = {};
  if (args.summary !== undefined) body.summary = args.summary;
  if (args.location !== undefined) body.location = args.location;
  if (args.description !== undefined) body.description = args.description;
  if (args.attendees !== undefined) body.attendees = args.attendees.map(email => ({ email }));
  if (args.start !== undefined) body.start = whenParam(args.start, zone);
  if (args.end !== undefined) body.end = whenParam(args.end, zone);
  if (!partial) {
    if (!body.summary) throw new Error("summary is required (the event title).");
    if (!body.start || !body.end) throw new Error("start and end are required (YYYY-MM-DD or YYYY-MM-DDTHH:MM).");
  }
  return body;
}

async function writeCall(fetchImpl: FetchLike, cfg: GoogleConfig, method: string, url: string, body?: EventBody): Promise<Response> {
  const at = await accessToken(fetchImpl, cfg);
  const r = await fetchImpl(url, {
    method,
    headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 403) throw new Error("Google refused the write (HTTP 403): the connector's grant is read-only. Widening it needs the calendar.events scope, which is not approved yet.");
  return r;
}

function eventLine(j: { id?: string; summary?: string; start?: { date?: string; dateTime?: string }; htmlLink?: string }): string {
  const when = j.start?.date || j.start?.dateTime || "?";
  return `"${j.summary || "(no title)"}" (${when})${j.htmlLink ? ` - ${j.htmlLink}` : ""}`;
}

export async function createEvent(fetchImpl: FetchLike, cfg: GoogleConfig | null, args: EventWriteArgs): Promise<CalendarResult> {
  if (!cfg) return NOT_CONFIGURED;
  const zone = tz();
  const cal = await writeCalendar(fetchImpl, cfg, args.calendar);
  const body = writeBody(args, zone, false);
  const r = await writeCall(fetchImpl, cfg, "POST", `${CALENDAR_API}/calendars/${encodeURIComponent(cal.id)}/events`, body);
  const j = await r.json().catch(() => ({})) as { id?: string; summary?: string; start?: { date?: string; dateTime?: string }; htmlLink?: string; error?: { message?: string } };
  if (!r.ok) throw new Error(`Google Calendar answered HTTP ${r.status}${j.error?.message ? ` (${j.error.message})` : ""}`);
  return { text: `Created ${eventLine(j)} on ${cal.summary}. Times are ${zone}; all-day when given dates only. No invitation emails are sent by the connector (Google's default for API creates).` };
}

export async function updateEvent(fetchImpl: FetchLike, cfg: GoogleConfig | null, args: EventWriteArgs): Promise<CalendarResult> {
  if (!cfg) return NOT_CONFIGURED;
  if (!args.eventId) throw new Error("eventId is required (from calendar_events or the event's link).");
  const zone = tz();
  const cal = await writeCalendar(fetchImpl, cfg, args.calendar);
  const body = writeBody(args, zone, true);
  if (!Object.keys(body).length) throw new Error("Nothing to change: pass at least one of summary, start, end, location, description, attendees.");
  const r = await writeCall(fetchImpl, cfg, "PATCH", `${CALENDAR_API}/calendars/${encodeURIComponent(cal.id)}/events/${encodeURIComponent(args.eventId)}`, body);
  const j = await r.json().catch(() => ({})) as { id?: string; summary?: string; start?: { date?: string; dateTime?: string }; htmlLink?: string; error?: { message?: string } };
  if (!r.ok) throw new Error(`Google Calendar answered HTTP ${r.status}${j.error?.message ? ` (${j.error.message})` : ""}`);
  return { text: `Updated ${eventLine(j)} on ${cal.summary}. Only the passed fields changed; recurring series edits apply to the single instance unless the series id was passed.` };
}

export async function cancelEvent(fetchImpl: FetchLike, cfg: GoogleConfig | null, args: EventWriteArgs): Promise<CalendarResult> {
  if (!cfg) return NOT_CONFIGURED;
  if (!args.eventId) throw new Error("eventId is required (from calendar_events or the event's link).");
  const cal = await writeCalendar(fetchImpl, cfg, args.calendar);
  const r = await writeCall(fetchImpl, cfg, "DELETE", `${CALENDAR_API}/calendars/${encodeURIComponent(cal.id)}/events/${encodeURIComponent(args.eventId)}`);
  if (r.status === 404 || r.status === 410) return { text: `Event ${args.eventId} is already gone from ${cal.summary}.` };
  if (!r.ok) {
    const j = await r.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(`Google Calendar answered HTTP ${r.status}${j.error?.message ? ` (${j.error.message})` : ""}`);
  }
  return { text: `Cancelled event ${args.eventId} on ${cal.summary}: it no longer appears in calendar_events. The calendar itself is untouched; cancelling an event never deletes or shares a calendar.` };
}
