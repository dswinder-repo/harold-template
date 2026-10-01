/**
 * Capture screenshots of the CRM for the public site.
 *
 * Drives a headless Chrome over the DevTools protocol, using Node's built-in
 * WebSocket so there is nothing to install. Chrome's own --screenshot flag fires
 * on the load event, which is before React has rendered anything, and returns a
 * blank page; this waits for real content instead.
 *
 * It must be pointed at a server running in demo mode. Screenshots of this app go
 * on a public marketing page, and the live database holds real people: their names,
 * employers and how warm the owner considers each relationship. The script refuses
 * to run against anything that is not demo mode, so that cannot happen by accident.
 *
 *   pnpm dev:demo --port 3111            # in one terminal
 *   pnpm capture http://localhost:3111 ./screenshots
 *
 * Chrome is found at its usual install path; set CHROME_PATH to use another
 * Chrome or Chromium binary. Images come out at 1440x900 CSS pixels, device
 * scale 2 (2880x1800).
 */

import { writeFileSync, mkdirSync, existsSync, mkdtempSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = process.argv[2] ?? 'http://localhost:3111'
const OUT = process.argv[3] ?? './screenshots'
const CHROME = findChrome()
const PORT = 9222
const WIDTH = 1440
const HEIGHT = 900

const SHOTS = [
  { name: 'dashboard', path: '/dashboard', waitFor: '.contact-card, [data-contact-card], h1, main' },
  { name: 'detail', path: '/contacts/d1', waitFor: 'main' },
]

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean)
  const found = candidates.find((p) => existsSync(p))
  if (!found) {
    console.error('Chrome not found. Set CHROME_PATH to a Chrome or Chromium binary.')
    process.exit(1)
  }
  return found
}

function chromeUp() {
  const args = [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'harold-capture-'))}`,
    '--no-first-run', '--no-default-browser-check',
    'about:blank',
  ]
  const p = spawn(CHROME, args, { stdio: 'ignore', detached: true })
  p.unref()
  return p
}

async function targetWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(500)
  }
  throw new Error('Chrome devtools endpoint never came up')
}

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  })
  return r.result?.value
}

const main = async () => {
  mkdirSync(OUT, { recursive: true })
  chromeUp()
  const wsUrl = await targetWs()
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  const cdp = new CDP(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false,
  })

  for (const shot of SHOTS) {
    await cdp.send('Page.navigate', { url: BASE + shot.path })

    // Wait for content, not for the load event. A client-rendered page fires load
    // while the body is still empty, which is exactly how the first attempt at this
    // produced a screenshot of an empty gradient.
    let text = ''
    for (let i = 0; i < 90; i++) {
      await sleep(1000)
      text = (await evaluate(cdp, 'document.body?.innerText ?? ""')) ?? ''
      if (text.replace(/\s/g, '').length > 400) break
    }
    if (text.replace(/\s/g, '').length <= 400) {
      console.error(`  ${shot.name}: page still looks empty, skipping`)
      continue
    }

    // Refuse to photograph anything but demo data.
    const isDemo = await evaluate(cdp, 'window.__HAROLD_DEMO__ === true')
    if (!isDemo) {
      throw new Error(
        `${shot.name}: the page is not running in demo mode. Refusing to capture, ` +
        'because these images are published and the real database holds real people.'
      )
    }

    // Remove the dev-server overlay so it does not appear in a published image.
    await evaluate(cdp, `
      document.querySelectorAll('nextjs-portal,[data-nextjs-toast],[data-nextjs-dev-tools-button]')
        .forEach(e => e.remove());
      window.scrollTo(0, 0);
      true
    `)
    await sleep(2500)

    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const file = `${OUT}/${shot.name}.png`
    writeFileSync(file, Buffer.from(data, 'base64'))
    console.log(`  ${shot.name}: ${file}`)
  }

  await cdp.send('Browser.close').catch(() => {})
  ws.close()
}

main().then(
  () => process.exit(0),
  (err) => { console.error(String(err.message ?? err)); process.exit(1) }
)
