// An in-memory Notion API (version 2026-03-11) behind a fetch mock, enough of it for the Notion provider and its setup
// tool: /search (data sources, paginated), /data_sources/{id}, /databases/{id}, /data_sources/{id}/query (timestamp and
// title filters, ascending sorts, start_cursor pagination), and /pages (GET, POST, PATCH). last_edited_time is rounded
// down to the minute, as Notion does. Objects follow the documented shapes in fixtures/notion/.

import { readFileSync } from "node:fs";
import type { DataSource, NotionPage, PropertyValue, RichText } from "../../src/sync/notion.js";
import type { Clock } from "./sync-fakes.js";

export const nfixture = <T = unknown>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/notion/${name}`, import.meta.url), "utf8")) as T;
export const DS = nfixture<DataSource>("data-source.json");
export const DS_ID = DS.id;
export const DB_ID = DS.parent!.database_id!;

export const NOTION_PROJECTS_MD = `# Projects

## Acme Pilot
- folder: acme-pilot/
- status: active

## Orchard
- folder: orchard/
- status: active
- notion_project: Orchard Labs

## Harold
- folder: harold/
- status: active
`;

const minute = (t: number) => new Date(Math.floor(t / 60_000) * 60_000).toISOString();
const rt = (s: string): RichText[] => (s ? [{ type: "text", text: { content: s, link: null } as never, plain_text: s }] : []);

export class FakeNotion {
  pages = new Map<string, NotionPage>();
  dataSources: DataSource[] = [structuredClone(DS)];
  databases = new Map<string, { object: "database"; id: string; data_sources: { id: string; name: string }[] }>([[DB_ID, { object: "database", id: DB_ID, data_sources: [{ id: DS_ID, name: "Tasks" }] }]]);
  calls: { method: string; path: string; body: Record<string, unknown> | null; version: string | null }[] = [];
  pageSize = 2;
  failNext: { status: number; code: string; message: string } | null = null;
  private n = 0;
  constructor(private clock: Clock) {}

  newId() { const h = (++this.n).toString(16).padStart(12, "0"); return `153104cd-477e-80${h.slice(0, 2)}-8dc4-${h}`; }

  /** A page as the owner would make or edit it in Notion. */
  put(o: { title: string; status?: string | null; due?: string | null; priority?: string | null; notes?: string; project?: string | null; dataSource?: string }, id = this.newId()): NotionPage {
    const prev = this.pages.get(id);
    const t = this.clock.now();
    const props: Record<string, PropertyValue> = {
      Title: { id: "title", type: "title", title: rt(o.title) },
      Status: { id: "Z%3ClH", type: "status", status: o.status === null ? null : { name: o.status ?? "Not started" } },
      "Due date": { id: "M%3BBw", type: "date", date: o.due ? { start: o.due, end: null, time_zone: null } : null },
      Priority: { id: "prio", type: "select", select: o.priority ? { name: o.priority } : null },
      Notes: { id: "note", type: "rich_text", rich_text: rt(o.notes ?? "") },
      Project: { id: "proj", type: "select", select: o.project ? { name: o.project } : null },
    };
    const page: NotionPage = {
      object: "page", id, created_time: prev?.created_time ?? minute(t), last_edited_time: minute(t), in_trash: false,
      url: `https://app.notion.com/p/${id.replace(/-/g, "")}`,
      parent: { type: "data_source_id", data_source_id: o.dataSource ?? DS_ID, database_id: DB_ID }, properties: props,
    };
    this.pages.set(id, page);
    return page;
  }
  edit(id: string, f: (p: NotionPage) => void) { const p = this.pages.get(id)!; f(p); p.last_edited_time = minute(this.clock.now()); return p; }
  setStatus(id: string, name: string) { return this.edit(id, p => { p.properties.Status = { type: "status", status: { name } }; }); }
  trash(id: string) { return this.edit(id, p => { p.in_trash = true; }); }
  title(id: string) { return (this.pages.get(id)!.properties.Title.title || []).map(r => r.plain_text).join(""); }

  private applyProps(p: NotionPage, props: Record<string, Record<string, unknown>>) {
    for (const [name, v] of Object.entries(props)) {
      const schema = this.dataSources[0].properties[name];
      if (!schema) throw { status: 400, code: "validation_error", message: `${name} is not a property that exists.` };
      const text = (a: RichText[]) => a.map(r => ({ type: "text", text: r.text, plain_text: r.text?.content ?? "" }));
      if (schema.type === "title") p.properties[name] = { type: "title", title: text(v.title as RichText[]) };
      else if (schema.type === "rich_text") p.properties[name] = { type: "rich_text", rich_text: text(v.rich_text as RichText[]) };
      else if (schema.type === "status") {
        const s = v.status as { name: string } | null;
        if (s && !schema.status!.options.some(o => o.name === s.name)) throw { status: 400, code: "validation_error", message: `Invalid status option. Status option "${s.name}" does not exist."` };
        p.properties[name] = { type: "status", status: s };
      } else if (schema.type === "select") {
        const s = v.select as { name: string } | null;
        if (s && !schema.select!.options.some(o => o.name === s.name)) schema.select!.options.push({ name: s.name, color: "default" });
        p.properties[name] = { type: "select", select: s };
      } else if (schema.type === "date") p.properties[name] = { type: "date", date: v.date as PropertyValue["date"] };
    }
  }

  private match(p: NotionPage, f: Record<string, unknown> | undefined): boolean {
    if (!f) return true;
    if (Array.isArray(f.and)) return (f.and as Record<string, unknown>[]).every(x => this.match(p, x));
    if (f.timestamp) {
      const k = f.timestamp as "last_edited_time" | "created_time";
      const c = f[k] as { on_or_after?: string; after?: string };
      const v = Date.parse(p[k]);
      if (c.on_or_after) return v >= Date.parse(c.on_or_after);
      if (c.after) return v > Date.parse(c.after);
      return true;
    }
    if (f.property && f.title) {
      const want = (f.title as { equals: string }).equals;
      return (p.properties[f.property as string]?.title || []).map(r => r.plain_text).join("") === want;
    }
    throw new Error(`fake: unsupported filter ${JSON.stringify(f)}`);
  }

  private paginate<T>(all: T[], body: Record<string, unknown>) {
    const size = Math.min(Number(body.page_size) || 100, this.pageSize);
    const start = body.start_cursor ? Number(String(body.start_cursor).replace("cur-", "")) : 0;
    const results = all.slice(start, start + size);
    const more = start + size < all.length;
    return { object: "list", results, has_more: more, next_cursor: more ? `cur-${start + size}` : null, type: "page_or_data_source", request_status: { type: "complete" } };
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method || "GET";
    const path = url.pathname.replace(/^\/v1/, "");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    const headers = new Headers(init?.headers);
    this.calls.push({ method, path, body, version: headers.get("notion-version") });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    const err = (status: number, code: string, message: string) => json(status, { object: "error", status, code, message });
    if (this.failNext) { const f = this.failNext; this.failNext = null; return err(f.status, f.code, f.message); }
    try {
      if (method === "POST" && path === "/search") return json(200, this.paginate(this.dataSources, body || {}));
      let m = path.match(/^\/data_sources\/([^/]+)$/);
      if (m && method === "GET") { const d = this.dataSources.find(x => x.id === m![1]); return d ? json(200, d) : err(404, "object_not_found", "Could not find data_source"); }
      m = path.match(/^\/databases\/([^/]+)$/);
      if (m && method === "GET") { const d = this.databases.get(m[1]); return d ? json(200, d) : err(404, "object_not_found", "Could not find database"); }
      m = path.match(/^\/data_sources\/([^/]+)\/query$/);
      if (m && method === "POST") {
        const ds = m[1];
        if (!this.dataSources.some(x => x.id === ds)) return err(404, "object_not_found", "Could not find data_source");
        const b = body || {};
        let list = [...this.pages.values()].filter(p => p.parent.data_source_id === ds && !p.in_trash && !p.is_archived && this.match(p, b.filter as Record<string, unknown>));
        const sort = (b.sorts as { timestamp: "last_edited_time" | "created_time"; direction: string }[] | undefined)?.[0];
        if (sort) list = list.sort((x, y) => Date.parse(x[sort.timestamp]) - Date.parse(y[sort.timestamp]) || x.id.localeCompare(y.id));
        if (sort?.direction === "descending") list.reverse();
        return json(200, this.paginate(list, b));
      }
      m = path.match(/^\/pages\/([^/]+)$/);
      if (m && method === "GET") { const p = this.pages.get(m[1]); return p ? json(200, p) : err(404, "object_not_found", `Could not find page with ID: ${m[1]}.`); }
      if (m && method === "PATCH") {
        const p = this.pages.get(m[1]);
        if (!p) return err(404, "object_not_found", `Could not find page with ID: ${m[1]}.`);
        this.applyProps(p, (body!.properties || {}) as Record<string, Record<string, unknown>>);
        p.last_edited_time = minute(this.clock.now());
        return json(200, p);
      }
      if (method === "POST" && path === "/pages") {
        const parent = body!.parent as { type: string; data_source_id: string };
        if (parent.type !== "data_source_id" || !this.dataSources.some(x => x.id === parent.data_source_id)) return err(400, "validation_error", "bad parent");
        const id = this.newId();
        const p: NotionPage = {
          object: "page", id, created_time: minute(this.clock.now()), last_edited_time: minute(this.clock.now()), in_trash: false,
          url: `https://app.notion.com/p/${id.replace(/-/g, "")}`, parent: { type: "data_source_id", data_source_id: parent.data_source_id, database_id: DB_ID },
          properties: { Title: { type: "title", title: [] }, Status: { type: "status", status: { name: "Not started" } }, "Due date": { type: "date", date: null }, Priority: { type: "select", select: null }, Notes: { type: "rich_text", rich_text: [] }, Project: { type: "select", select: null } },
        };
        this.applyProps(p, (body!.properties || {}) as Record<string, Record<string, unknown>>);
        this.pages.set(id, p);
        return json(200, p);
      }
    } catch (e) {
      const x = e as { status?: number; code?: string; message?: string };
      if (x.status) return err(x.status, x.code || "validation_error", x.message || "");
      throw e;
    }
    return err(400, "invalid_request_url", `fake: no route for ${method} ${path}`);
  };
}
