/**
 * Capture the product screenshots used by /watch/whats-new.
 *
 *   node scripts/capture-whats-new-shots.mjs [--base https://www.jesusfilm.org]
 *
 * Screenshots go stale, so this exists rather than a one-off manual grab:
 * re-run it after a visual change and commit the result. It drives a real
 * Chrome over CDP (Node 24 ships a global WebSocket, so no puppeteer),
 * because several shots need interaction — the search overlay and the
 * language picker only exist after a click.
 */
import { execFile, spawn } from "node:child_process"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { promisify } from "node:util"
import { join } from "node:path"

const BASE = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "https://www.jesusfilm.org"
const OUT = join(import.meta.dirname, "../public/images/whats-new")
const PORT = 9333
const run = promisify(execFile)
/**
 * UI screenshots are text on flat colour, which is exactly what a low WebP
 * quality smears. These are kept at full 2x capture width and encoded near
 * lossless; `next/image` re-encodes on the way out, so anything lost here
 * is lost twice.
 */
const WEBP_QUALITY = 94
const VIEWPORT = { width: 1440, height: 900 }

const SHOTS = [
  { name: "home", path: "/watch", settle: 9000 },
  { name: "player", path: "/watch/jesus.html/english.html", settle: 12000 },
  {
    // The picker is a modal and would not open reliably headless; the
    // browse-by-region index shows the same story without a click.
    name: "language",
    path: "/watch/languages",
    settle: 9000,
  },
  {
    name: "search",
    path: "/watch",
    settle: 9000,
    steps: [
      `document.querySelector('[data-testid="floating-search-desktop-button"]')?.click()`,
      `(() => { const i = document.querySelector('input'); if (!i) return 'no input'; i.focus(); const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(i, 'hope'); i.dispatchEvent(new Event('input', { bubbles: true })); return i.value })()`,
    ],
    stepDelay: 4000,
  },
  {
    // Scrolled to the body, where the share and download controls sit —
    // again avoiding a modal that headless will not reliably open.
    name: "share",
    path: "/watch/jesus.html/english.html",
    settle: 12000,
    steps: [`window.scrollTo({ top: window.innerHeight * 1.15 })`],
    stepDelay: 3500,
  },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function targets() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  return response.json()
}

class Cdp {
  #socket
  #next = 1
  #pending = new Map()

  static async attach(url) {
    const cdp = new Cdp()
    cdp.#socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      cdp.#socket.addEventListener("open", resolve, { once: true })
      cdp.#socket.addEventListener("error", reject, { once: true })
    })
    cdp.#socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data)
      const pending = cdp.#pending.get(message.id)
      if (!pending) return
      cdp.#pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
    return cdp
  }

  send(method, params = {}) {
    const id = this.#next++
    this.#socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
    })
  }

  close() {
    this.#socket.close()
  }
}

const chrome = spawn(
  "chromium",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--force-device-scale-factor=2",
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
)

process.on("exit", () => chrome.kill())

await mkdir(OUT, { recursive: true })
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    await targets()
    break
  } catch {
    await sleep(250)
  }
}

const [page] = (await targets()).filter((t) => t.type === "page")
const cdp = await Cdp.attach(page.webSocketDebuggerUrl)
await cdp.send("Page.enable")
await cdp.send("Runtime.enable")

for (const shot of SHOTS) {
  const url = `${BASE}${shot.path}`
  process.stdout.write(`${shot.name.padEnd(10)} ${url}\n`)
  await cdp.send("Page.navigate", { url })
  await sleep(shot.settle)

  for (const step of shot.steps ?? []) {
    await cdp.send("Runtime.evaluate", { expression: step, awaitPromise: true })
    await sleep(shot.stepDelay ?? 2000)
  }

  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  })
  const png = join(OUT, `${shot.name}.png`)
  await writeFile(png, Buffer.from(data, "base64"))
  await run("magick", [
    png,
    "-quality",
    String(WEBP_QUALITY),
    "-define",
    "webp:method=6",
    join(OUT, `${shot.name}.webp`),
  ])
  await rm(png)
}

cdp.close()
chrome.kill()
process.stdout.write(`\nWrote ${SHOTS.length} shots to ${OUT}\n`)
