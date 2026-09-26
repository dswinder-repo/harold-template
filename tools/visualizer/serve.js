#!/usr/bin/env node
/**
 * Expedition HQ — Dashboard Server
 *
 * Serves the visualizer with two session sources:
 *   1. Registered session files in harold/active-sessions/ (detailed activity info)
 *   2. Auto-detected Claude Code JSONL logs (safety net fallback)
 *
 * The JSONL auto-detection ensures active sessions ALWAYS appear on the
 * dashboard, even if the session forgets to write a registered file.
 *
 * Usage:
 *   node serve.js
 *   node serve.js --port 3333
 *   node serve.js --sessions /custom/path/to/active-sessions
 *
 * Then open http://localhost:3210 in your browser.
 *
 * Local-only by design: it listens on 127.0.0.1 (override with HOST=...) and sends no CORS
 * headers, because /api/preview-file can read files in your workspace. Do not expose the port.
 * Zero dependencies (Node 18+).
 */

const http = require('http');
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

// --- Config ---
const args = process.argv.slice(2);
const PORT = getArg('--port', 3210);
const HOST = process.env.HOST || '127.0.0.1';
const SESSIONS_DIR = getArg('--sessions',
  path.resolve(__dirname, '..', '..', 'harold', 'active-sessions')
);

// Claude Code JSONL session logs — auto-written by every session
// Top-level dir; all project subdirs are scanned for JSONL files.
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

const RETIRE_AFTER_MS = 2 * 60 * 60 * 1000; // 2 hours
const ACTIVE_THRESHOLD_MS = 10 * 60 * 1000;  // 10 min — sessions active within this window
const JSONL_OVERLAY_AFTER_MS = 2 * 60 * 1000; // 2 min — overlay JSONL activities onto stale session files

// Map Claude Code tool names to dashboard activity categories.
// Used by enhanceWithLiveActivities to auto-detect what agents are currently active.
const TOOL_TO_ACTIVITY = {
  Read: 'research', Glob: 'research', Grep: 'research',
  WebSearch: 'research', WebFetch: 'research',
  Edit: 'coding', Write: 'coding', NotebookEdit: 'coding',
  Bash: 'ops', Task: 'research', TodoWrite: 'strategy',
};

function getArg(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) {
    const val = args[idx + 1];
    return flag === '--port' ? parseInt(val, 10) : val;
  }
  return fallback;
}

// --- Server ---
const server = http.createServer((req, res) => {
  if (req.url === '/api/sessions') {
    return serveSessions(req, res);
  }
  // History endpoints
  if (req.method === 'POST' && req.url === '/api/history') {
    return handleHistoryPost(req, res);
  }
  if (req.method === 'GET' && req.url === '/api/history') {
    return handleHistoryGet(req, res);
  }
  // Git endpoints
  if (req.method === 'GET' && req.url === '/api/git/log') {
    return handleGit(res, 'git log --oneline --no-decorate -20');
  }
  if (req.method === 'GET' && req.url === '/api/git/diff') {
    return handleGit(res, 'git diff --stat HEAD');
  }
  if (req.method === 'GET' && req.url === '/api/git/status') {
    return handleGit(res, 'git status --short');
  }
  // Preview file serving — serves local HTML/images for the live preview panel
  if (req.method === 'GET' && req.url && req.url.startsWith('/api/preview-candidates')) {
    return handlePreviewCandidates(req, res);
  }
  if (req.method === 'GET' && req.url && req.url.startsWith('/api/preview-file')) {
    return handlePreviewFile(req, res);
  }
  if (req.url === '/' || req.url === '/index.html') {
    return serveFile(res, path.join(__dirname, 'index.html'), 'text/html');
  }
  if (req.method === 'POST' && req.url === '/api/cleanup') {
    return cleanupStaleSessions(req, res);
  }
  if (req.method === 'DELETE' && req.url && req.url.startsWith('/api/sessions/')) {
    return deleteSession(req, res);
  }
  // Static asset serving for /assets/ directory
  if (req.url && req.url.startsWith('/assets/')) {
    const safePath = req.url.replace(/\.\./g, '').replace(/\/+/g, '/');
    const filePath = path.join(__dirname, safePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.json': 'application/json',
      '.css': 'text/css',
      '.js': 'application/javascript'
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    return serveFile(res, filePath, contentType);
  }
  res.writeHead(404);
  res.end('Not found');
});

function serveSessions(req, res) {
  const result = {};

  function respond() {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  // Source 1: Registered session files (harold/active-sessions/*.json)
  readRegisteredSessions(result, () => {
    // Source 2: Auto-detected Claude Code JSONL logs
    readAutoSessions(result, () => {
      // Source 3: Live JSONL activity overlay.
      // Reads recent tool calls from JSONL logs to keep registered session
      // activities fresh — even when the session forgets to update its JSON file.
      enhanceWithLiveActivities(result, respond);
    });
  });
}

/**
 * Source 1: Registered session files with detailed activity info.
 * These are written by sessions that follow CLAUDE.md instructions.
 */
function readRegisteredSessions(result, done) {
  fs.readdir(SESSIONS_DIR, (err, files) => {
    if (err) return done();

    const jsonFiles = files.filter(f => f.endsWith('.json'));
    let pending = jsonFiles.length;
    if (pending === 0) return done();

    jsonFiles.forEach(file => {
      const filePath = path.join(SESSIONS_DIR, file);
      fs.stat(filePath, (statErr, stats) => {
        fs.readFile(filePath, 'utf8', (readErr, data) => {
          if (!readErr) {
            try {
              const parsed = JSON.parse(data);
              parsed._mtime = statErr ? null : stats.mtime.toISOString();
              parsed._source = 'registered';
              const mtime = stats ? stats.mtime.getTime() : Date.now();
              // Only include sessions that are active (session !== false) and recent
              if (parsed.session !== false && Date.now() - mtime <= RETIRE_AFTER_MS) {
                result[file] = parsed;
              }
            } catch (e) { /* skip malformed */ }
          }
          pending--;
          if (pending === 0) done();
        });
      });
    });
  });
}

/**
 * Source 2: Auto-detected sessions from Claude Code JSONL logs.
 * These exist for EVERY session — no manual action required.
 * Only includes sessions active within ACTIVE_THRESHOLD_MS.
 */
function readAutoSessions(result, done) {
  // JSONL files live inside subdirectories of CLAUDE_PROJECTS_DIR
  // (e.g. ~/.claude/projects/<encoded-project-path>/*.jsonl)
  fs.readdir(CLAUDE_PROJECTS_DIR, (err, entries) => {
    if (err) return done();

    // Collect all JSONL paths across all subdirectories
    let pending = entries.length;
    if (pending === 0) return done();

    const allJsonls = [];

    entries.forEach(entry => {
      const entryPath = path.join(CLAUDE_PROJECTS_DIR, entry);
      fs.stat(entryPath, (statErr, stats) => {
        if (!statErr && stats && stats.isDirectory()) {
          fs.readdir(entryPath, (rdErr, files) => {
            if (!rdErr && files) {
              files.filter(f => f.endsWith('.jsonl')).forEach(f => {
                allJsonls.push(path.join(entryPath, f));
              });
            }
            if (--pending === 0) processJsonls();
          });
        } else {
          // Top-level JSONL files (legacy / flat layout)
          if (!statErr && entry.endsWith('.jsonl')) {
            allJsonls.push(entryPath);
          }
          if (--pending === 0) processJsonls();
        }
      });
    });

    function processJsonls() {
      let filePending = allJsonls.length;
      if (filePending === 0) return done();

      allJsonls.forEach(filePath => {
        fs.stat(filePath, (statErr, stats) => {
          if (statErr || !stats) { filePending--; if (filePending === 0) done(); return; }

          const mtime = stats.mtime.getTime();
          const age = Date.now() - mtime;

          // Only include sessions active within the threshold
          if (age > ACTIVE_THRESHOLD_MS) {
            filePending--;
            if (filePending === 0) done();
            return;
          }

          const sessionId = path.basename(filePath).replace('.jsonl', '');
          const autoKey = '_auto_' + sessionId.slice(0, 8) + '.json';

          // Don't show auto-detected sessions when registered sessions exist.
          const hasRegisteredCoverage = Object.values(result).some(s =>
            s._source === 'registered' && s._mtime &&
            (Date.now() - new Date(s._mtime).getTime()) <= RETIRE_AFTER_MS
          );

          if (hasRegisteredCoverage) {
            filePending--;
            if (filePending === 0) done();
            return;
          }

          // Read first few lines to extract the initial user prompt as task description
          extractFirstPrompt(filePath, (taskDesc) => {
            result[autoKey] = {
              _auto: true,
              _mtime: stats.mtime.toISOString(),
              _source: 'auto',
              _sessionId: sessionId,
              task: taskDesc || 'Active session',
              activities: {
                research: { status: 'sleeping' },
                strategy: { status: 'sleeping' },
                writing: { status: 'sleeping' },
                coding: { status: 'working', task: taskDesc || 'Session in progress', progress: 50, started: stats.mtime.toISOString() },
                data: { status: 'sleeping' },
                comms: { status: 'sleeping' },
                design: { status: 'sleeping' },
                ops: { status: 'sleeping' }
              }
            };

            filePending--;
            if (filePending === 0) done();
          });
        });
      });
    }
  });
}

/**
 * Read the first ~20 lines of a JSONL to find the first user message.
 * Returns a truncated version as the task description.
 */
function extractFirstPrompt(filePath, cb) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  let found = false;
  let linesRead = 0;

  rl.on('line', (line) => {
    linesRead++;
    if (found || linesRead > 30) { rl.close(); return; }

    try {
      const obj = JSON.parse(line);
      if (obj.type === 'user' && obj.message && obj.message.role === 'user') {
        found = true;
        let content = obj.message.content || '';
        if (Array.isArray(content)) {
          content = content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join(' ');
        }
        // Trim to a reasonable task description
        content = content.replace(/\s+/g, ' ').trim();
        if (content.length > 80) content = content.slice(0, 77) + '...';
        rl.close();
        cb(content || null);
      }
    } catch (e) { /* skip unparseable lines */ }
  });

  rl.on('close', () => {
    if (!found) cb(null);
  });

  rl.on('error', () => cb(null));
}

/**
 * Source 3: Live activity overlay.
 *
 * For any registered session whose JSON file hasn't been updated in
 * JSONL_OVERLAY_AFTER_MS (2 min), reads recent tool calls from the most
 * active JSONL and overlays inferred activities onto the session.
 *
 * This eliminates dashboard staleness — the dashboard always reflects what
 * the session is ACTUALLY doing, not what it last remembered to report.
 */
function enhanceWithLiveActivities(result, done) {
  // DISABLED: The previous implementation found the single newest JSONL log
  // and overlaid its inferred activities onto ALL stale registered sessions.
  // This caused a bug where ended/idle sessions would display agent activity
  // from a completely unrelated active session. Since there's no reliable way
  // to match a JSONL log to a specific registered session file, the overlay
  // is removed entirely. Sessions must self-report their activities via their
  // JSON file (which is the intended protocol per CLAUDE.md).
  done();
}

/**
 * Read the last 64KB of a JSONL file and infer current activities
 * from recent tool_use entries.
 */
function readJSONLTail(filePath, cb) {
  fs.stat(filePath, (err, stats) => {
    if (err) return cb(null);
    const TAIL_BYTES = 64 * 1024;
    const start = Math.max(0, stats.size - TAIL_BYTES);
    const stream = fs.createReadStream(filePath, { start, encoding: 'utf8' });
    let data = '';
    stream.on('data', chunk => { data += chunk; });
    stream.on('end', () => {
      const lines = data.split('\n').filter(l => l.trim());
      if (start > 0 && lines.length > 0) lines.shift(); // drop partial first line
      cb(inferActivitiesFromTools(lines));
    });
    stream.on('error', () => cb(null));
  });
}

/**
 * Parse JSONL lines (newest to oldest) and map tool_use calls to activity
 * categories. Only considers tools used within the last 5 minutes.
 * Returns a full activities object, or null if nothing recent was found.
 */
function inferActivitiesFromTools(lines) {
  const now = Date.now();
  const RECENT_MS = 5 * 60 * 1000;
  const detected = {}; // category → task description

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);

      // Stop scanning once we've gone past the recency window
      if (obj.timestamp) {
        if (now - new Date(obj.timestamp).getTime() > RECENT_MS) break;
      }

      if (obj.type === 'assistant' && obj.message && obj.message.content) {
        const content = Array.isArray(obj.message.content) ? obj.message.content : [];
        for (const block of content) {
          if (block.type !== 'tool_use' || !block.name) continue;
          // Skip session file self-writes — not actual work
          if (block.input && block.input.file_path &&
              block.input.file_path.includes('active-sessions/')) continue;

          const category = TOOL_TO_ACTIVITY[block.name];
          if (category && !detected[category]) {
            detected[category] = toolCallDescription(block.name, block.input);
          }
        }
      }
    } catch (e) { /* skip unparseable */ }
  }

  if (Object.keys(detected).length === 0) return null;

  const ALL_CATS = ['research', 'strategy', 'writing', 'coding', 'data', 'comms', 'design', 'ops'];
  const activities = {};
  for (const cat of ALL_CATS) {
    if (detected[cat]) {
      activities[cat] = {
        status: 'working',
        task: detected[cat],
        progress: 50,
        started: new Date().toISOString()
      };
    } else {
      activities[cat] = { status: 'sleeping' };
    }
  }
  return activities;
}

/**
 * Generate a readable task description from a tool call's name and input.
 */
function toolCallDescription(name, input) {
  if (!input) return name;
  switch (name) {
    case 'Edit':
    case 'Write':
    case 'Read':
      return input.file_path ? 'Working on ' + path.basename(input.file_path) : name;
    case 'Grep':
      return input.pattern ? `Searching: ${String(input.pattern).slice(0, 40)}` : 'Searching codebase';
    case 'Glob':
      return input.pattern ? `Finding ${input.pattern}` : 'Finding files';
    case 'WebSearch':
      return input.query ? `Researching: ${String(input.query).slice(0, 40)}` : 'Web research';
    case 'Bash': {
      const cmd = String(input.command || '');
      return cmd.length > 50 ? cmd.slice(0, 47) + '...' : cmd || 'Running command';
    }
    default:
      return name;
  }
}

/**
 * POST /api/cleanup — Remove stale/ended session files.
 * Deletes any JSON file in active-sessions/ where session===false or mtime > 2h.
 */
function cleanupStaleSessions(req, res) {
  fs.readdir(SESSIONS_DIR, (err, files) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Cannot read sessions dir' }));
      return;
    }
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const removed = [];
    let pending = jsonFiles.length;
    if (pending === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ removed: [] }));
      return;
    }
    jsonFiles.forEach(file => {
      const filePath = path.join(SESSIONS_DIR, file);
      fs.stat(filePath, (statErr, stats) => {
        fs.readFile(filePath, 'utf8', (readErr, data) => {
          let shouldRemove = false;
          if (!readErr) {
            try {
              const parsed = JSON.parse(data);
              const age = stats ? Date.now() - stats.mtime.getTime() : Infinity;
              // Remove if session ended or file is older than retire threshold
              if (parsed.session === false || age > RETIRE_AFTER_MS) {
                shouldRemove = true;
              }
            } catch (e) { shouldRemove = true; /* malformed */ }
          }
          if (shouldRemove) {
            fs.unlink(filePath, () => {});
            removed.push(file);
          }
          if (--pending === 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ removed }));
          }
        });
      });
    });
  });
}

/**
 * DELETE /api/sessions/:name — Remove a specific session file.
 */
function deleteSession(req, res) {
  const name = decodeURIComponent(req.url.replace('/api/sessions/', ''));
  if (!name || name.includes('..') || name.includes('/')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid session name' }));
    return;
  }
  const filePath = path.join(SESSIONS_DIR, name.endsWith('.json') ? name : name + '.json');
  fs.unlink(filePath, (err) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ removed: name }));
  });
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// --- History endpoints ---
// Kept outside the workspace so dashboard polling never counts as a knowledge change for bin/harold close.
const HISTORY_FILE = path.join(os.homedir(), '.harold', 'expedition-history.jsonl');
try { fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true }); } catch (_) {}
const HISTORY_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

function handleHistoryPost(req, res) {
  let body = '';
  let aborted = false;
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 4096 && !aborted) {
      aborted = true;
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end('{"error":"Payload too large"}');
      req.destroy();
    }
  });
  req.on('end', () => {
    if (aborted) return;
    try {
      const snapshot = JSON.parse(body);
      if (!snapshot.ts) snapshot.ts = Date.now();
      fs.appendFile(HISTORY_FILE, JSON.stringify(snapshot) + '\n', () => {});
      // Prune old entries periodically (every ~100 writes)
      if (Math.random() < 0.01) pruneHistory();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"error":"Invalid JSON"}');
    }
  });
}

function handleHistoryGet(req, res) {
  fs.readFile(HISTORY_FILE, 'utf8', (err, data) => {
    if (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
      return;
    }
    const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
    const entries = data.split('\n').filter(l => l.trim()).map(l => {
      try { return JSON.parse(l); } catch(e) { return null; }
    }).filter(e => e && e.ts > cutoff);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(entries));
  });
}

function pruneHistory() {
  fs.readFile(HISTORY_FILE, 'utf8', (err, data) => {
    if (err) return;
    const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
    const lines = data.split('\n').filter(l => {
      if (!l.trim()) return false;
      try { return JSON.parse(l).ts > cutoff; } catch(e) { return false; }
    });
    fs.writeFile(HISTORY_FILE, lines.join('\n') + '\n', () => {});
  });
}

// --- Preview candidates ---
// Returns session-declared artifacts only.
// Only artifacts explicitly set by active sessions appear here.
// No auto-detection of dev servers — running servers don't mean active work.
let _previewCandidatesCache = null;
let _previewCandidatesCacheTime = 0;
const PREVIEW_CACHE_TTL = 10000; // 10 seconds

function detectFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const typeMap = {
    '.html': 'html', '.htm': 'html',
    '.md': 'markdown', '.markdown': 'markdown',
    '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.svg': 'image', '.webp': 'image',
    '.pdf': 'pdf',
    '.docx': 'docx', '.doc': 'docx',
    '.xlsx': 'xlsx', '.xls': 'xlsx',
    '.pptx': 'pptx',
    '.js': 'code', '.ts': 'code', '.tsx': 'code', '.jsx': 'code',
    '.py': 'code', '.rs': 'code', '.go': 'code', '.rb': 'code',
    '.json': 'code', '.css': 'code', '.sh': 'code',
  };
  return typeMap[ext] || 'code';
}

function handlePreviewCandidates(req, res) {
  const now = Date.now();
  if (_previewCandidatesCache && now - _previewCandidatesCacheTime < PREVIEW_CACHE_TTL) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(_previewCandidatesCache));
    return;
  }

  const artifacts = [];

  fs.readdir(SESSIONS_DIR, (err, files) => {
    if (err) { respond(); return; }
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    let pending = jsonFiles.length;
    if (pending === 0) { respond(); return; }

    jsonFiles.forEach(file => {
      const filePath = path.join(SESSIONS_DIR, file);
      fs.readFile(filePath, 'utf8', (readErr, data) => {
        if (!readErr) {
          try {
            const parsed = JSON.parse(data);
            if (parsed.session !== false && parsed.artifact) {
              const sessionName = file.replace(/\.json$/, '').replace(/-/g, ' ');
              artifacts.push({
                session: sessionName,
                path: parsed.artifact,
                type: detectFileType(parsed.artifact),
                filename: path.basename(parsed.artifact)
              });
            }
          } catch (e) { /* skip */ }
        }
        if (--pending === 0) respond();
      });
    });
  });

  function respond() {
    const result = { artifacts };
    _previewCandidatesCache = result;
    _previewCandidatesCacheTime = Date.now();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }
}

// --- Preview file serving ---
// Safely serves local files for the live preview iframe.
// Only allows files under the workspace root (REPO_DIR) to prevent path traversal.
function handlePreviewFile(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const filePath = url.searchParams.get('path');
  if (!filePath) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing path parameter');
    return;
  }
  const resolved = path.resolve(filePath);
  const workspaceRoot = path.resolve(__dirname, '..', '..');
  // Security: only serve files under the workspace (a sibling folder sharing the prefix does not count)
  if (resolved !== workspaceRoot && !resolved.startsWith(workspaceRoot + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access denied: file outside workspace');
    return;
  }
  const ext = path.extname(resolved).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html', '.htm': 'text/html',
    '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.txt': 'text/plain', '.md': 'text/plain',
    '.pdf': 'application/pdf',
    '.py': 'text/plain', '.ts': 'text/plain', '.tsx': 'text/plain',
    '.jsx': 'text/plain', '.rs': 'text/plain', '.go': 'text/plain',
    '.docx': 'application/octet-stream',
    '.xlsx': 'application/octet-stream', '.xls': 'application/octet-stream',
    '.pptx': 'application/octet-stream',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

// --- Git endpoints ---
// NOTE: All git commands are hardcoded strings — no user input is passed to exec.
// This is safe from command injection.
const REPO_DIR = path.resolve(__dirname, '..', '..');
const GIT_MAX_OUTPUT = 4096;

function handleGit(res, command) {
  exec(command, { cwd: REPO_DIR, timeout: 5000, maxBuffer: GIT_MAX_OUTPUT * 2 }, (err, stdout, stderr) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (err) {
      res.end(JSON.stringify({ error: stderr || err.message, output: '' }));
      return;
    }
    var output = stdout || '';
    if (output.length > GIT_MAX_OUTPUT) output = output.slice(0, GIT_MAX_OUTPUT) + '\n... (truncated)';
    res.end(JSON.stringify({ output: output }));
  });
}

server.listen(PORT, HOST, () => {
  console.log(`\n  Expedition HQ running at http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Registered sessions: ${SESSIONS_DIR}`);
  console.log(`  Auto-detect:     ${CLAUDE_PROJECTS_DIR}`);
  console.log();
});
