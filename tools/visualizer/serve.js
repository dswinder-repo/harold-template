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
 */

const http = require('http');
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const os = require('os');

// --- Config ---
const args = process.argv.slice(2);
const PORT = getArg('--port', 3210);
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
  if (req.url === '/' || req.url === '/index.html') {
    return serveFile(res, path.join(__dirname, 'index.html'), 'text/html');
  }
  res.writeHead(404);
  res.end('Not found');
});

function serveSessions(req, res) {
  const result = {};

  function respond() {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
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
              if (Date.now() - mtime <= RETIRE_AFTER_MS) {
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
  // (e.g. ~/.claude/projects/your-workspace-path/*.jsonl)
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
  // Only act on registered sessions with stale activity data AND all activities sleeping.
  // If a session already has any "working" activity in its JSON, leave it alone —
  // overwriting it with another session's JSONL would be wrong.
  const staleKeys = Object.keys(result).filter(key => {
    const s = result[key];
    if (s._source !== 'registered' || !s._mtime) return false;
    if ((Date.now() - new Date(s._mtime).getTime()) <= JSONL_OVERLAY_AFTER_MS) return false;
    const activities = s.activities || {};
    return !Object.values(activities).some(a => a && a.status === 'working');
  });

  if (staleKeys.length === 0) return done();

  // Scan all project subdirs under CLAUDE_PROJECTS_DIR for the freshest active JSONL.
  // Each subdir (e.g. your-workspace-path) holds JSONL files for one CWD.
  fs.readdir(CLAUDE_PROJECTS_DIR, (err, entries) => {
    if (err) return done();

    // Collect all JSONL paths across all subdirs
    let pending = 0;
    const allJsonls = [];

    entries.forEach(entry => {
      const entryPath = path.join(CLAUDE_PROJECTS_DIR, entry);
      pending++;
      fs.stat(entryPath, (statErr, stats) => {
        if (!statErr && stats && stats.isDirectory()) {
          pending++;
          fs.readdir(entryPath, (rdErr, files) => {
            if (!rdErr && files) {
              files.filter(f => f.endsWith('.jsonl')).forEach(f => {
                allJsonls.push(path.join(entryPath, f));
              });
            }
            if (--pending === 0) findNewestAndOverlay();
          });
        }
        if (--pending === 0) findNewestAndOverlay();
      });
    });

    if (pending === 0) findNewestAndOverlay();

    function findNewestAndOverlay() {
      if (allJsonls.length === 0) return done();

      let newestPath = null;
      let newestMtime = 0;
      let checked = 0;

      allJsonls.forEach(filePath => {
        fs.stat(filePath, (statErr, stats) => {
          checked++;
          if (!statErr && stats) {
            const mtime = stats.mtime.getTime();
            if (mtime > newestMtime && (Date.now() - mtime) <= ACTIVE_THRESHOLD_MS) {
              newestPath = filePath;
              newestMtime = mtime;
            }
          }
          if (checked === allJsonls.length) {
            if (!newestPath) return done();
            readJSONLTail(newestPath, (activities) => {
              if (activities) {
                staleKeys.forEach(key => {
                  result[key].activities = activities;
                  result[key]._liveDetected = true;
                });
              }
              done();
            });
          }
        });
      });
    }
  });
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

server.listen(PORT, () => {
  console.log(`\n  Expedition HQ running at http://localhost:${PORT}`);
  console.log(`  Registered sessions: ${SESSIONS_DIR}`);
  console.log(`  Auto-detect:     ${CLAUDE_PROJECTS_DIR}`);
  console.log();
});
