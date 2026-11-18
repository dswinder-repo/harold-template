#!/usr/bin/env node
/*
 * A small stand-in for the Supabase REST endpoint (PostgREST), for tests/tasks.test.js only.
 *
 *   node tests/mock-rest.js [--legacy] [--no-links] [--no-sync-log]
 *
 * Prints "PORT <n>" when it is listening. It must run in its own process: the tests call bin/harold through a
 * blocking spawn, which would freeze a server living in the test process.
 *
 * It implements just what bin/harold's task code uses: GET with select, column=eq./neq./in.()/ilike./is.null filters,
 * order and limit; POST; PATCH. Tables: tasks, contacts, task_links, sync_log. Everything is in memory.
 *   --legacy        the database before the task-list migration: the tasks table has no ref or project column
 *                   (a request that names one gets HTTP 400 "column tasks.ref does not exist"); no task_links, no sync_log
 *   --no-links      no task_links table
 *   --no-sync-log   no sync_log table
 * Test hooks: GET /__log (every request as JSON), POST /__seed/<table> (rows to add), POST /__fail?mode=down|ok
 * (down: answer every request with HTTP 503).
 */
'use strict';
const http = require('http');
const crypto = require('crypto');

const legacy = process.argv.includes('--legacy');
const T = { tasks: [], contacts: [], task_links: [], sync_log: [] };
const absent = new Set([...(legacy ? ['task_links', 'sync_log'] : []), ...(process.argv.includes('--no-links') ? ['task_links'] : []), ...(process.argv.includes('--no-sync-log') ? ['sync_log'] : [])]);
const NEW_TASK_COLS = ['ref', 'project', 'source', 'changed_by'];
const log = [];
let down = false, seq = 0;

const uuid = () => crypto.randomUUID();
function likeRe(pat) { // PostgREST ilike: * is the wildcard; a backslash escapes the next character
  let out = '';
  for (let i = 0; i < pat.length; i++) { const c = pat[i]; if (c === '\\') out += pat[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); else if (c === '*' || c === '%') out += '.*'; else out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  return new RegExp(`^${out}$`, 'i');
}
function matcher(col, expr) {
  const m = expr.match(/^(not\.)?([a-z]+)\.(.*)$/s); if (!m) return null;
  const neg = !!m[1], op = m[2], v = m[3];
  const test = row => {
    const x = row[col];
    if (op === 'eq') return String(x) === v;
    if (op === 'neq') return String(x) !== v;
    if (op === 'in') return v.replace(/^\(|\)$/g, '').split(',').includes(String(x));
    if (op === 'ilike') return x !== null && x !== undefined && likeRe(v).test(String(x));
    if (op === 'is') return v === 'null' ? x === null || x === undefined : String(x) === v;
    if (op === 'gte') return String(x) >= v;
    if (op === 'lte') return String(x) <= v;
    return true;
  };
  return row => (neg ? !test(row) : test(row));
}
function unknownColumns(table, cols) {
  if (!(legacy && table === 'tasks')) return null;
  return cols.find(c => NEW_TASK_COLS.includes(c)) || null;
}
const send = (res, status, body, extra = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...extra }); res.end(body === undefined ? '' : JSON.stringify(body)); };
const pgErr = (res, status, message, code) => send(res, status, { code: code || 'PGRST000', message, details: null, hint: null });
const project = (row, sel) => { if (!sel || sel === '*') return row; const o = {}; sel.split(',').forEach(c => { c = c.trim(); if (c && c in row) o[c] = row[c]; else if (c && !(c in row)) o[c] = null; }); return o; };

http.createServer((req, res) => {
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__log') return send(res, 200, log);
    if (u.pathname === '/__fail') { down = u.searchParams.get('mode') === 'down'; return send(res, 200, { down }); }
    const seed = u.pathname.match(/^\/__seed\/(\w+)$/);
    if (seed) { JSON.parse(body).forEach(r => { r.id = r.id || uuid(); if (seed[1] === 'tasks') seq = Math.max(seq, parseInt(String(r.ref || '').replace(/\D/g, ''), 10) || 0); T[seed[1]].push(r); }); return send(res, 200, { ok: true }); }
    const m = u.pathname.match(/^\/rest\/v1\/(\w+)$/);
    log.push({ method: req.method, path: u.pathname.replace('/rest/v1/', ''), query: u.search, body: body ? JSON.parse(body) : undefined });
    if (down) return pgErr(res, 503, 'service unavailable');
    if (!m) return pgErr(res, 404, 'not found');
    const table = m[1];
    if (!T[table] || absent.has(table)) return pgErr(res, 404, `Could not find the table 'public.${table}' in the schema cache`, 'PGRST205');
    const rows = T[table];
    const filters = [], sel = u.searchParams.get('select'); let order = null, limit = null;
    for (const [k, v] of u.searchParams) {
      if (k === 'select') continue;
      if (k === 'order') { order = v; continue; }
      if (k === 'limit') { limit = +v; continue; }
      if (k === 'on_conflict') continue;
      const f = matcher(k, v); if (f) filters.push({ col: k, f });
    }
    const bad = unknownColumns(table, [...(sel ? sel.split(',') : []), ...filters.map(f => f.col)]);
    if (bad) return pgErr(res, 400, `column tasks.${bad} does not exist`, '42703');
    const pick = () => rows.filter(r => filters.every(x => x.f(r)));
    const prefer = req.headers['prefer'] || '';
    if (req.method === 'GET') {
      let out = pick();
      if (order) { const [col, dir, nulls] = order.split('.'); out = out.slice().sort((a, b) => { const x = a[col], y = b[col]; if (x == null && y == null) return 0; if (x == null) return nulls === 'nullsfirst' ? -1 : 1; if (y == null) return nulls === 'nullsfirst' ? 1 : -1; return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1); }); }
      if (limit !== null) out = out.slice(0, limit);
      return send(res, 200, out.map(r => project(r, sel)));
    }
    if (req.method === 'POST') {
      const list = [].concat(JSON.parse(body || '[]'));
      const bad2 = unknownColumns(table, list.flatMap(r => Object.keys(r)));
      if (bad2) return pgErr(res, 400, `Could not find the '${bad2}' column of 'tasks' in the schema cache`, 'PGRST204');
      const made = list.map(r => {
        const row = { id: uuid(), ...r };
        if (table === 'tasks') {
          if (r.title === undefined || r.title === null) return null;
          Object.assign(row, { description: '', status: 'pending', priority: 'medium', due_date: null, contact_id: null, completed_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r, id: row.id });
          if (!legacy) { row.ref = `H-${++seq}`; row.project = r.project || null; row.source = r.source || 'harold'; row.changed_by = 'harold'; }
          if (row.due_date && /^\d{4}-\d{2}-\d{2}$/.test(row.due_date)) row.due_date = `${row.due_date}T00:00:00+00:00`;
        }
        return row;
      });
      if (made.includes(null)) return pgErr(res, 400, 'null value in column "title" violates not-null constraint', '23502');
      made.forEach(r => rows.push(r));
      return prefer.includes('return=minimal') ? send(res, 201) : send(res, 201, made.map(r => project(r, sel)));
    }
    if (req.method === 'PATCH') {
      const patch = JSON.parse(body || '{}');
      const bad2 = unknownColumns(table, Object.keys(patch));
      if (bad2) return pgErr(res, 400, `Could not find the '${bad2}' column of 'tasks' in the schema cache`, 'PGRST204');
      const hit = pick();
      hit.forEach(r => { Object.assign(r, patch); if (r.due_date && /^\d{4}-\d{2}-\d{2}$/.test(r.due_date)) r.due_date = `${r.due_date}T00:00:00+00:00`; });
      return prefer.includes('return=minimal') ? send(res, 204) : send(res, 200, hit.map(r => project(r, sel)));
    }
    return pgErr(res, 405, 'method not allowed');
  });
}).listen(0, '127.0.0.1', function () { console.log(`PORT ${this.address().port}`); });
