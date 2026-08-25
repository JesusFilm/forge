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
/**
 * `--only name[,name]` re-captures a subset. Useful because the two
 * before/after shots pull from the Internet Archive and production, which
 * are slow and unrelated to a local UI change.
 */
const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1].split(",")
  : []
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
/**
 * Capture viewport for the side-by-side before/after pair only. Narrower
 * than `VIEWPORT` because those two are rendered at about half the
 * content rail: a 1440-wide capture scaled into ~600 CSS px reduces the
 * interface labels the section argues about to roughly five pixels tall.
 * The height reaches just past the tab row on the 2024 page, which is
 * where its last English labels sit.
 */
const NARROW = { width: 900, height: 960 }

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
  /**
   * The two halves of the before/after comparison on the page. Both are
   * the SAME address — the Modern Standard Arabic JESUS page — under two
   * years apart, so neither may be re-pointed at a different film or
   * language without rewriting the section's copy.
   *
   * Both capture the page from its top, unscrolled, at the same NARROW
   * viewport: the argument is what the whole frame looks like (the 2024
   * page runs left to right in English, today's mirrors into Arabic), so
   * anything other than an identical frame for both would be putting a
   * thumb on the scale.
   *
   * `absolute` because neither comes from `--base`: one is the Internet
   * Archive, the other is production. The archive URL is pinned to one
   * capture (20241116160206) — a bare wayback URL resolves to whatever
   * snapshot is nearest today, and the panel's caption quotes this one.
   */
  {
    name: "arabic-2024",
    absolute: true,
    path: "https://web.archive.org/web/20241116160206/https://www.jesusfilm.org/watch/jesus.html/arabic-modern-standard.html",
    // Archived pages reassemble slowly out of `web.archive.org` assets,
    // and the hero photograph is the last thing to arrive. Do not lower
    // this: a short settle yields a frame with a black hero.
    settle: 30000,
    viewport: NARROW,
    /**
     * The hero photograph comes back from the archive intermittently —
     * some runs it 404s and the frame is a black rectangle, which is a
     * materially different (and much weaker) picture than the one the
     * caption describes. Shape-based rather than URL-based so an archive
     * rewrite of the asset path does not silently disarm it.
     */
    waitFor: `(() => {
      const hero = [...document.images].find((img) => {
        const box = img.getBoundingClientRect()
        return box.width > 500 && box.top < 400
      })
      return Boolean(hero && hero.complete && hero.naturalWidth > 0)
    })()`,
    steps: [
      `for (const id of ["wm-ipp-base", "wm-ipp", "donato"]) document.getElementById(id)?.remove()`,
      `window.scrollTo({ top: 0 })`,
    ],
    stepDelay: 2500,
  },
  {
    // Deliberately production rather than `--base`: the panel's caption
    // describes what an Arabic speaker sees on the live site today, and
    // a local build with no Admin renders a stub.
    name: "arabic-today",
    absolute: true,
    path: "https://www.jesusfilm.org/watch/jesus.html/arabic-modern-standard.html",
    settle: 18000,
    viewport: NARROW,
    steps: [`window.scrollTo({ top: 0 })`],
    stepDelay: 3000,
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
  if (only.length > 0 && !only.includes(shot.name)) continue
  const url = shot.absolute ? shot.path : `${BASE}${shot.path}`
  process.stdout.write(`${shot.name.padEnd(14)} ${url}\n`)

  // A per-shot viewport. The before/after pair is displayed at roughly
  // half the content rail, so a 1440-wide capture shrinks its labels to
  // an unreadable size — and those labels are the whole argument. Both
  // halves of the pair must use the SAME viewport or the comparison
  // stops being like for like.
  const view = shot.viewport ?? VIEWPORT
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: view.width,
    height: view.height,
    deviceScaleFactor: 2,
    mobile: false,
  })

  await cdp.send("Page.navigate", { url })
  await sleep(shot.settle)

  // Poll an optional readiness predicate, reloading once if it never
  // comes true. A failure is announced rather than swallowed: a shot
  // that quietly captured the wrong thing is worse than a loud one.
  if (shot.waitFor) {
    let ready = false
    for (let round = 0; round < 2 && !ready; round += 1) {
      if (round > 0) {
        process.stdout.write(`  ${shot.name}: not ready, reloading\n`)
        await cdp.send("Page.reload", { ignoreCache: true })
        await sleep(shot.settle)
      }
      for (let poll = 0; poll < 30 && !ready; poll += 1) {
        const { result } = await cdp.send("Runtime.evaluate", {
          expression: shot.waitFor,
          returnByValue: true,
        })
        ready = result.value === true
        if (!ready) await sleep(1000)
      }
    }
    if (!ready) {
      process.exitCode = 1
      process.stdout.write(
        `  ${shot.name}: WAITFOR NEVER SATISFIED - shot is probably wrong, do not commit it\n`,
      )
    }
  }

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
