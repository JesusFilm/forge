/**
 * Capture the looping product clips used by /watch/whats-new.
 *
 *   node scripts/capture-whats-new-clips.mjs [--base https://www.jesusfilm.org]
 *                                            [--only home,search]
 *
 * Sibling of `capture-whats-new-shots.mjs`, which grabs the still posters.
 * This one records a short screencast of the same surface actually being
 * used — scrolled, clicked, typed into — because a still cannot show that
 * search suggests as you type or that the player has scrubbing previews.
 *
 * Frames come off CDP's `Page.screencast`, which emits a JPEG whenever the
 * page paints. That is a VARIABLE rate, so frames are muxed through
 * ffmpeg's concat demuxer with their real inter-frame gaps as durations and
 * resampled to a constant rate on the way out — assuming a fixed rate
 * instead makes a slow scroll judder.
 *
 * Chrome (not Chromium) on purpose: Chromium builds ship without the
 * proprietary decoders, so the JESUS player renders a black rectangle and
 * the playback clip shows nothing.
 *
 * Output is two files per clip: VP9/WebM for browsers that take it and
 * H.264/MP4 for the rest. Both are muted, short, and loop; the poster is
 * the matching still from the shots script, so nothing here blocks paint.
 */
import { execFile, spawn } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

const arg = (name, fallback) =>
  process.argv.includes(name)
    ? process.argv[process.argv.indexOf(name) + 1]
    : fallback

const BASE = arg("--base", "https://www.jesusfilm.org")
const ONLY = arg("--only", "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean)
/**
 * `assets/`, not `videos/`: `/watch/videos` is a live legacy redirect to
 * /watch/languages, so a `videos` first segment cannot be reserved as a
 * static subtree. Unreserved, every clip URL canonicalizes into
 * `/watch/videos.html/...` and 307s away, and the player then sits at
 * readyState 0 — which reads as a codec fault, not a routing one.
 */
const OUT = join(import.meta.dirname, "../public/assets/whats-new")
const PORT = 9345
const run = promisify(execFile)

/**
 * 16:9 at a size the cards actually render at. The featured cell crops to
 * 21:7 through `object-cover`, so it takes its slice off the top of the
 * same recording rather than needing its own pass.
 */
const VIEWPORT = { width: 1280, height: 720 }
const FPS = 20
/**
 * Quality knobs. Scrolling is high-motion, so it is the CRF that decides
 * whether these land near 300KB or near 2MB. Raise CRF before dropping
 * resolution: text stays legible far longer than it stays sharp.
 */
const VP9_CRF = 46
const H264_CRF = 40

/**
 * Injected into every page: eased scrolling and typing, as promises.
 *
 * Clicking is NOT here — it goes through CDP Input as a trusted event,
 * because a synthetic `element.click()` does not open the base-ui dialogs
 * behind Share and Download.
 */
const HELPERS = `
window.__clip = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  scrollTo(to, duration) {
    return new Promise((resolve) => {
      const from = window.scrollY
      const start = performance.now()
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration)
        // easeInOutSine: no hard start or stop, which is what makes a
        // recorded scroll read as deliberate rather than dragged.
        const eased = -(Math.cos(Math.PI * t) - 1) / 2
        window.scrollTo(0, from + (to - from) * eased)
        t < 1 ? requestAnimationFrame(step) : resolve()
      }
      requestAnimationFrame(step)
    })
  },
  async type(selector, text, perChar) {
    const input = document.querySelector(selector)
    if (!input) throw new Error('no input for ' + selector)
    input.focus()
    const set = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set
    for (let i = 1; i <= text.length; i += 1) {
      set.call(input, text.slice(0, i))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await this.sleep(perChar)
    }
    return input.value
  },
}
`

/**
 * One entry per improvement card, in content order.
 *
 * `settle` is dead time before recording starts — long enough for the hero
 * image, fonts, and any above-the-fold video to be there, so the clip never
 * opens on a skeleton. `before` runs after that and is NOT recorded: use it
 * to park the page where the clip should open, so the recording spends its
 * seconds on the feature rather than on travel. `steps` is the recorded
 * timeline and its runtime is the clip length.
 *
 * A step is one of:
 *   { wait: ms }          hold
 *   { eval: expression }  page-side, awaited (scrolling, typing)
 *   { click: selector }   REAL mouse press/release through CDP Input
 *   { key: "Escape" }     real key event
 *
 * `click` is a trusted input event on purpose. `element.click()` is enough
 * to trip a plain handler but does not open the base-ui dialogs behind
 * Share and Download, so a synthetic click silently records the page not
 * reacting.
 */
const CLIPS = [
  {
    name: "home",
    path: "/watch",
    settle: 11000,
    // Opens on the cinematic hero, then walks down into the curated rows —
    // the "clearer and more visual way to discover" claim, in one move.
    steps: [
      { wait: 900 },
      { eval: `__clip.scrollTo(1500, 4200)` },
      { wait: 900 },
    ],
  },
  {
    name: "player",
    path: "/watch/jesus.html/english.html",
    settle: 14000,
    // The hero already autoplays muted, so this does not press play — it
    // clicks the pre-reveal surface to drop the poster overlay and show the
    // real player chrome, then just watches it run.
    steps: [
      { wait: 700 },
      { click: '[data-testid="hero-player-pre-reveal-click-surface"]' },
      { wait: 5000 },
    ],
  },
  {
    name: "language",
    path: "/watch/languages",
    settle: 10000,
    // The longest clip, and the only one with two beats: this card carries
    // five claims, so breadth alone undersells it. First the scroll through
    // regions (thousands of languages), then the index actually being
    // searched — typing collapses ~59,000px of results down to one country,
    // which is "find content in their own language" in a form a still or a
    // scroll cannot show.
    //
    // The index rather than the in-player picker: this is the FEATURED
    // 21:7 cell, and `object-cover object-top` keeps only the top ~59% of
    // a 16:9 frame, so a centred modal would be cropped through the middle.
    // Everything here stays in the upper band.
    steps: [
      { wait: 800 },
      { eval: `__clip.scrollTo(1400, 4200)` },
      { wait: 700 },
      { eval: `__clip.scrollTo(0, 1600)` },
      { wait: 500 },
      { click: 'input[type="search"]' },
      { wait: 600 },
      { eval: `__clip.type('input[type="search"]', 'portug', 200)` },
      { wait: 900 },
      { eval: `__clip.scrollTo(250, 900)` },
      { wait: 2200 },
    ],
  },
  {
    name: "search",
    path: "/watch",
    settle: 11000,
    // The one clip that genuinely cannot be a still: suggestions arriving
    // per keystroke is the whole feature.
    steps: [
      { wait: 700 },
      { click: '[data-testid="floating-search-desktop-button"]' },
      { wait: 1200 },
      { eval: `__clip.type('input', 'hope', 260)` },
      { wait: 1500 },
    ],
  },
  {
    name: "share",
    path: "/watch/jesus.html/english.html",
    settle: 14000,
    // Both workflows the card actually claims, end to end: share a trusted
    // link, then pick a download size.
    //
    // Parked at 250 rather than scrolled to either control, because that is
    // the one offset where the hero Share and the body Download are BOTH
    // clickable: they sit 749px apart in the document, so no position shows
    // both without this being deliberate, and the body `watch-share-button`
    // (docY 1492) cannot share a viewport with Download at all. Measured at
    // 1280x720 — re-measure if the viewport or that page's layout changes;
    // the click step hit-tests, so a stale offset fails loudly.
    //
    // The final "Download" confirm inside the modal is deliberately NOT
    // clicked — it would start a real multi-hour feature-film transfer.
    before: [{ eval: `window.scrollTo(0, 250)` }, { wait: 1400 }],
    steps: [
      { wait: 700 },
      { click: '[data-testid="hero-player-share-button"]' },
      { wait: 2900 },
      { key: "Escape" },
      { wait: 1100 },
      { click: '[data-testid="watch-download-button"]' },
      { wait: 1900 },
      { click: '[data-testid="watch-download-modal-size-trigger"]' },
      { wait: 2300 },
    ],
  },
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function targets() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  return response.json()
}

class Cdp {
  #socket
  #next = 1
  #pending = new Map()
  #listeners = new Map()

  static async attach(url) {
    const cdp = new Cdp()
    cdp.#socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      cdp.#socket.addEventListener("open", resolve, { once: true })
      cdp.#socket.addEventListener("error", reject, { once: true })
    })
    cdp.#socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data)
      if (message.method) {
        for (const handler of cdp.#listeners.get(message.method) ?? []) {
          handler(message.params)
        }
        return
      }
      const pending = cdp.#pending.get(message.id)
      if (!pending) return
      cdp.#pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
    return cdp
  }

  on(method, handler) {
    this.#listeners.set(method, [
      ...(this.#listeners.get(method) ?? []),
      handler,
    ])
    return () => {
      this.#listeners.set(
        method,
        (this.#listeners.get(method) ?? []).filter((it) => it !== handler),
      )
    }
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

/**
 * Run `expression` while recording, and return the frames that painted.
 *
 * Every frame MUST be acked or Chrome stops sending them after the first
 * few — the ack is the backpressure signal, not a formality.
 */
/**
 * Resolve a selector to a clickable viewport point.
 *
 * Reports what `elementFromPoint` finds at that point rather than assuming
 * the rect is clickable: the floating Watch header overlays the top of the
 * viewport, so a target scrolled just under it has a perfectly good rect
 * and still cannot be clicked.
 */
async function aim(cdp, selector) {
  const found = await evaluate(
    cdp,
    `(() => {
       const node = document.querySelector(${JSON.stringify(selector)})
       if (!node) return null
       let box = node.getBoundingClientRect()
       const offscreen =
         box.top < 0 || box.bottom > window.innerHeight
       if (offscreen) {
         node.scrollIntoView({ block: 'center', behavior: 'instant' })
         box = node.getBoundingClientRect()
       }
       const x = box.x + box.width / 2
       const y = box.y + box.height / 2
       const inside =
         x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight
       const at = inside ? document.elementFromPoint(x, y) : null
       return JSON.stringify({
         x,
         y,
         scrolled: offscreen,
         hit: !inside
           ? 'offscreen'
           : at && (at === node || node.contains(at) || at.contains(node))
             ? 'hits'
             : 'covered by ' + (at ? at.tagName.toLowerCase() : 'nothing'),
       })
     })()`,
  )
  if (!found) throw new Error(`no target for ${selector}`)
  return JSON.parse(found)
}

/**
 * Run one timeline step.
 *
 * A click is resolved to viewport coordinates immediately before dispatch
 * rather than once up front: the previous step may have opened a dialog and
 * moved the target, and a stale point lands on whatever is there now.
 */
async function step(cdp, item) {
  if ("wait" in item) return sleep(item.wait)

  if ("key" in item) {
    for (const type of ["keyDown", "keyUp"]) {
      await cdp.send("Input.dispatchKeyEvent", {
        type,
        key: item.key,
        code: item.key,
        windowsVirtualKeyCode: item.key === "Escape" ? 27 : 0,
      })
    }
    return undefined
  }

  if ("click" in item) {
    const aimed = await aim(cdp, item.click)
    if (aimed.scrolled) {
      // Only when the target was off screen. Landing a synthetic mouse
      // event at off-viewport coordinates is silently a no-op, so the
      // alternative is a clip of the page not reacting.
      await sleep(500)
    }
    const { x, y, hit } = aimed.scrolled ? await aim(cdp, item.click) : aimed

    // Hit test before dispatching. `Input.dispatchMouseEvent` reports
    // nothing about what it landed on, so without this a click onto empty
    // space or through a floating header just produces a still clip — a
    // failure that only shows up later as a suspiciously low frame count.
    if (hit !== "hits") {
      throw new Error(`click on ${item.click} would not land (${hit})`)
    }
    for (const type of ["mousePressed", "mouseReleased"]) {
      await cdp.send("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "left",
        clickCount: 1,
      })
    }
    return undefined
  }

  return evaluate(cdp, `(async () => { await ${item.eval} })()`)
}

/**
 * `Runtime.evaluate` reports a page-side throw in the RESULT rather than by
 * rejecting, so without this check a timeline that never ran still produces
 * a file — of whatever happened to be on screen.
 */
async function evaluate(cdp, expression) {
  const outcome = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (outcome.exceptionDetails) {
    throw new Error(
      outcome.exceptionDetails.exception?.description ??
        outcome.exceptionDetails.text,
    )
  }
  return outcome.result.value
}

async function record(cdp, steps) {
  const frames = []
  const off = cdp.on(
    "Page.screencastFrame",
    ({ data, metadata, sessionId }) => {
      frames.push({ data, timestamp: metadata.timestamp })
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {})
    },
  )

  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 92,
    maxWidth: VIEWPORT.width,
    maxHeight: VIEWPORT.height,
    everyNthFrame: 1,
  })
  try {
    for (const item of steps) await step(cdp, item)
  } finally {
    // Stopped in `finally` so a step that throws still tears the screencast
    // down; a live screencast leaks frames into the NEXT clip's recording.
    await cdp.send("Page.stopScreencast")
    off()
  }
  return frames
}

/**
 * Mux JPEG frames into WebM + MP4 at a constant rate.
 *
 * The concat demuxer wants a duration after every entry and repeats the
 * last file, which is its documented quirk for holding the final frame.
 */
async function encode(frames, name) {
  const work = await mkdtemp(join(tmpdir(), `whats-new-${name}-`))
  const lines = []

  for (const [index, frame] of frames.entries()) {
    const file = join(work, `f${String(index).padStart(5, "0")}.jpg`)
    await writeFile(file, Buffer.from(frame.data, "base64"))
    const next = frames[index + 1]
    const seconds = next
      ? Math.max(1 / 120, next.timestamp - frame.timestamp)
      : 1 / FPS
    lines.push(`file '${file}'`, `duration ${seconds.toFixed(4)}`)
  }
  lines.push(
    `file '${join(work, `f${String(frames.length - 1).padStart(5, "0")}.jpg`)}'`,
  )

  const list = join(work, "frames.txt")
  await writeFile(list, lines.join("\n"))

  const input = ["-f", "concat", "-safe", "0", "-i", list]
  // `-an`: these are decoration. A muted track still costs bytes, and a
  // video element with no audio track cannot trip an autoplay policy.
  //
  // The `trunc(…/2)*2` pair is not belt-and-braces: the screencast frame
  // size follows the compositor, not the window flag, so an odd height
  // reaches ffmpeg and libx264 refuses it outright.
  const common = [
    "-vf",
    `fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
    "-an",
    "-y",
  ]

  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    ...input,
    ...common,
    "-c:v",
    "libvpx-vp9",
    "-crf",
    String(VP9_CRF),
    "-b:v",
    "0",
    "-row-mt",
    "1",
    "-deadline",
    "good",
    "-cpu-used",
    "2",
    join(OUT, `${name}.webm`),
  ])

  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    ...input,
    ...common,
    "-c:v",
    "libx264",
    "-crf",
    String(H264_CRF),
    "-preset",
    "slow",
    "-profile:v",
    "high",
    // `faststart`: moves the index to the front so the clip can start
    // without the whole file, which matters when five of them autoplay.
    "-movflags",
    "+faststart",
    join(OUT, `${name}.mp4`),
  ])

  await rm(work, { recursive: true, force: true })
}

const chrome = spawn(
  "google-chrome-stable",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--mute-audio",
    "--autoplay-policy=no-user-gesture-required",
    "--force-device-scale-factor=1",
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
)
process.on("exit", () => chrome.kill())

await mkdir(OUT, { recursive: true })
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    await targets()
    break
  } catch {
    await sleep(250)
  }
}

const [page] = (await targets()).filter((target) => target.type === "page")
const cdp = await Cdp.attach(page.webSocketDebuggerUrl)
await cdp.send("Page.enable")
await cdp.send("Runtime.enable")
// Pins the layout viewport to the recording size. `--window-size` alone
// leaves the compositor a few dozen pixels short, which both crops the
// frame and hands ffmpeg an odd height.
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: VIEWPORT.width,
  height: VIEWPORT.height,
  deviceScaleFactor: 1,
  mobile: false,
})

const selected = CLIPS.filter(
  (clip) => !ONLY.length || ONLY.includes(clip.name),
)
for (const clip of selected) {
  const url = `${BASE}${clip.path}`
  process.stdout.write(`${clip.name.padEnd(9)} ${url}\n`)

  await cdp.send("Page.navigate", { url })
  await sleep(clip.settle)
  await cdp.send("Runtime.evaluate", { expression: HELPERS })

  for (const item of clip.before ?? []) await step(cdp, item)

  const frames = await record(cdp, clip.steps)
  if (frames.length < FPS) {
    throw new Error(
      `${clip.name}: only ${frames.length} frames — the page probably never painted`,
    )
  }
  const span = frames.at(-1).timestamp - frames[0].timestamp
  process.stdout.write(
    `${" ".repeat(9)} ${frames.length} frames over ${span.toFixed(1)}s\n`,
  )
  await encode(frames, clip.name)
}

cdp.close()
chrome.kill()
process.stdout.write(`\nWrote ${selected.length} clips to ${OUT}\n`)
