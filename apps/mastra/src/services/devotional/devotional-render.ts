import { spawn } from "node:child_process"
import { once } from "node:events"
import { createWriteStream } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { repoRoot } from "./repo-root"

import {
  produceDevotionalAudio,
  type ProduceDevotionalAudioDeps,
  type ProducedDevotionalAudio,
} from "./devotional-audio"
import type { NarrationPolicy } from "./authored-data"
import {
  buildDevotionalManifest,
  type StagedSegment,
} from "./devotional-manifest"
import {
  generateDevotional,
  type GenerateDevotionalDeps,
  type GeneratedDevotional,
} from "./generate-devotional"
import type { DevotionalLlm } from "./llm"
import { rotateFilter } from "./voice-rotation"

/**
 * Render a video-first devotional to an MP4. `renderDevotionalVideo` is the
 * pure RENDER stage (devo + audio → clip download/trim → manifest → spawned
 * Remotion render); `prepareAndRenderDevotional` is the CLI-facing wrapper that
 * also resolves the text/audio (cache or generate). The Mastra sub-workflows
 * call the stages separately, with the disk cache as the seam.
 *
 * The spawned render is heavy (Remotion + headless Chrome). It runs fine
 * locally / in the Mastra dev studio; for a deployed run it should be swapped
 * to trigger a dedicated worker service rather than spawning in-process.
 */

const REPO_ROOT = repoRoot()
const RENDER_SCRIPT = path.join(
  REPO_ROOT,
  "apps/shorts-worker/scripts/render-devotional-video.mjs",
)
const INTRO_HOLD_SEC = 1
const OUTRO_HOLD_SEC = 8
const CARD_TAIL_SEC = 0.4
const BACKGROUND_SAFETY_MARGIN_SEC = 3

function formatHeaderDate(date: string, narration?: NarrationPolicy): string {
  if (!narration) {
    throw new DevotionalRenderError(
      "invalid_input",
      "/inputs/render/narration.json: narration configuration is required",
    )
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) {
    throw new DevotionalRenderError(
      "invalid_input",
      `invalid devotional date ${date}`,
    )
  }
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, monthIndex, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== monthIndex ||
    parsed.getUTCDate() !== day
  ) {
    throw new DevotionalRenderError(
      "invalid_input",
      `invalid devotional date ${date}`,
    )
  }
  return `${narration.weekdays[parsed.getUTCDay()]} · ${narration.months[monthIndex]} ${day}`
}

type BackgroundTimelineCard = {
  kind: string
  durationSec?: number
  holdSec?: number
}

function computeBackgroundTimelineSec(
  cards: readonly BackgroundTimelineCard[],
): number {
  return cards.reduce(
    (sum, card) => {
      if (card.kind === "video") return sum
      return (
        sum +
        (Number(card.durationSec) || 3) +
        (Number(card.holdSec) || 0) +
        CARD_TAIL_SEC
      )
    },
    INTRO_HOLD_SEC + OUTRO_HOLD_SEC + BACKGROUND_SAFETY_MARGIN_SEC,
  )
}

// Outbound budgets: every network/subprocess call gets a per-call ceiling so a
// stalled Arclight download or a wedged ffmpeg can't hang the daily job forever
// (repo rule: outbound timeout strictly under the caller's budget).
const METADATA_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 120_000
const FFMPEG_TIMEOUT_MS = 180_000
const FFPROBE_TIMEOUT_MS = 30_000
const RENDER_TIMEOUT_MS = 20 * 60_000
// Hard cap on a downloaded film. JESUS-film chapters are ~100MB; this rejects a
// hostile/misconfigured response before it can exhaust memory or disk.
const MAX_DOWNLOAD_BYTES = 600 * 1024 * 1024

export class DevotionalRenderError extends Error {
  override readonly name = "DevotionalRenderError"

  constructor(
    readonly code:
      | "invalid_input"
      | "invalid_media"
      | "process_failed"
      | "process_timeout"
      | "source_rejected"
      | "upstream_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

/**
 * SSRF guard for the Arclight-returned download URL: the metadata endpoint is a
 * hardcoded https host, but the download URL comes from its JSON body, so treat
 * it as untrusted. Require https and refuse hosts that resolve to loopback,
 * link-local (cloud metadata 169.254.169.254), or private ranges. Redirects are
 * still followed (Arclight serves signed-CDN 302s) so this validates the first
 * hop only — a redirect into a private host is a known, narrow residual.
 */
function assertPublicHttpsUrl(raw: string): void {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new DevotionalRenderError(
      "source_rejected",
      "download URL is not a valid URL",
    )
  }
  if (u.protocol !== "https:") {
    throw new DevotionalRenderError(
      "source_rejected",
      `refusing non-https download URL (${u.protocol})`,
    )
  }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.startsWith("fe80:") ||
    host.startsWith("fc") ||
    host.startsWith("fd")
  if (isPrivate) {
    throw new DevotionalRenderError(
      "source_rejected",
      `refusing private/reserved download host (${host})`,
    )
  }
}

function probeDuration(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const c = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      file,
    ])
    let out = ""
    c.stdout.on("data", (d) => (out += d.toString()))
    const timer = setTimeout(() => {
      c.kill("SIGKILL")
      reject(
        new DevotionalRenderError(
          "process_timeout",
          `ffprobe timed out after ${FFPROBE_TIMEOUT_MS}ms for ${file}`,
        ),
      )
    }, FFPROBE_TIMEOUT_MS)
    c.on("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
    c.on("close", (code) => {
      clearTimeout(timer)
      // Fail LOUD: a probe failure (nonzero exit, missing binary, corrupt/HTML
      // download) used to return 0 and silently degrade the render to a 1s clip.
      if (code !== 0) {
        reject(
          new DevotionalRenderError(
            "process_failed",
            `ffprobe exit ${code} for ${file}`,
          ),
        )
        return
      }
      const v = Number.parseFloat(out.trim())
      if (!Number.isFinite(v) || v <= 0) {
        reject(
          new DevotionalRenderError(
            "invalid_media",
            `ffprobe returned no usable duration for ${file}`,
          ),
        )
        return
      }
      resolve(v)
    })
  })
}

async function arclightClipUrl(mediaId: string): Promise<string> {
  const r = await fetch(
    `https://api.arclight.org/v2/media-components/${mediaId}/languages/529?platform=web`,
    { signal: AbortSignal.timeout(METADATA_TIMEOUT_MS) },
  )
  if (!r.ok) {
    throw new DevotionalRenderError(
      "upstream_failed",
      `Arclight ${mediaId}: HTTP ${r.status}`,
    )
  }
  const j = (await r.json()) as {
    downloadUrls?: Record<string, { url: string }>
  }
  const url = j.downloadUrls?.high?.url ?? j.downloadUrls?.low?.url
  if (!url) {
    throw new DevotionalRenderError(
      "invalid_media",
      `Arclight ${mediaId}: no downloadUrls`,
    )
  }
  return url
}

async function download(url: string, dest: string): Promise<void> {
  assertPublicHttpsUrl(url)
  const r = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })
  if (!r.ok) {
    throw new DevotionalRenderError(
      "upstream_failed",
      `download ${url}: HTTP ${r.status}`,
    )
  }
  if (!r.body) {
    throw new DevotionalRenderError(
      "invalid_media",
      `download ${url}: empty response body`,
    )
  }
  const declared = Number(r.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
    throw new DevotionalRenderError(
      "invalid_media",
      `download ${url}: content-length ${declared} exceeds ${MAX_DOWNLOAD_BYTES}`,
    )
  }
  // Stream to disk with a running byte cap so a body that lies about (or omits)
  // its content-length still can't blow past the ceiling into memory.
  const out = createWriteStream(dest)
  let received = 0
  try {
    for await (const chunk of Readable.fromWeb(
      r.body as Parameters<typeof Readable.fromWeb>[0],
    )) {
      received += (chunk as Buffer).length
      if (received > MAX_DOWNLOAD_BYTES) {
        throw new DevotionalRenderError(
          "invalid_media",
          `download ${url}: exceeded ${MAX_DOWNLOAD_BYTES}-byte cap`,
        )
      }
      if (!out.write(chunk)) await once(out, "drain")
    }
    out.end()
    await once(out, "finish")
  } catch (err) {
    out.destroy()
    throw err
  }
}

/** Trim [startSec, startSec+lengthSec] out of `src` into `dest` (re-encoded for
 *  an accurate cut). `normalize` runs loudnorm so the clip's audio is a
 *  consistent loudness across devotionals (some films are quiet, some loud). */
function trimClip(
  src: string,
  dest: string,
  startSec: number,
  lengthSec: number,
  normalize = false,
  speed = 1,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // -ss + -t BEFORE -i limit the INPUT read to `lengthSec` of source from
    // `startSec` — so with a speed-up (setpts on video + atempo on audio, which
    // PRESERVES PITCH) the output is that source content compressed to
    // lengthSec/speed. The JESUS film is old and slow; a gentle speed makes it
    // less draggy without an audible pitch change.
    const args = [
      "-y",
      "-ss",
      String(startSec),
      "-t",
      String(lengthSec),
      "-i",
      src,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
    ]
    if (speed !== 1) args.push("-vf", `setpts=PTS/${speed}`)
    const af: string[] = []
    if (speed !== 1) af.push(`atempo=${speed}`)
    if (normalize) af.push("loudnorm=I=-18:TP=-2:LRA=11")
    if (af.length) args.push("-af", af.join(","))
    args.push("-c:a", "aac", dest)
    // Capture stderr so a nonzero exit reports the real ffmpeg cause instead of
    // just an exit code; watchdog kills a hung encode so it can't wedge the run.
    const c = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] })
    let err = ""
    c.stderr.on("data", (d) => {
      if (err.length < 4000) err += d.toString()
    })
    const timer = setTimeout(() => {
      c.kill("SIGKILL")
      reject(
        new DevotionalRenderError(
          "process_timeout",
          `ffmpeg trim timed out after ${FFMPEG_TIMEOUT_MS}ms`,
        ),
      )
    }, FFMPEG_TIMEOUT_MS)
    c.on("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
    c.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else
        reject(
          new DevotionalRenderError(
            "process_failed",
            `ffmpeg trim exit ${code}: ${err.trim().slice(-500)}`,
          ),
        )
    })
  })
}

async function terminateProcessTree(
  child: ReturnType<typeof spawn>,
): Promise<void> {
  if (child.pid == null) return
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    })
    await once(killer, "close").catch(() => undefined)
    return
  }
  try {
    process.kill(-child.pid, "SIGKILL")
  } catch {
    child.kill("SIGKILL")
  }
}

function runRender(
  manifest: string,
  publicDir: string,
  out: string,
  comp: string,
  style: string,
  layout: string,
  musicVol: number,
  xfadeSec: number,
  videoAudioLevel: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(
      "node",
      [
        RENDER_SCRIPT,
        `--comp=${comp}`,
        `--manifest=${manifest}`,
        `--public-dir=${publicDir}`,
        `--out=${out}`,
        `--style=${style}`,
        `--layout=${layout}`,
        // Owner rule: text reveals letter-by-letter (smooth per-character fade).
        `--anim=letters`,
        `--music-vol=${musicVol}`,
        `--xfade=${xfadeSec}`,
        // Video-card clip audio at a BALANCED level (loudnorm'd upstream), fading
        // gently under the music. Backgrounds stay muted (bgAudio off), so this
        // does NOT bleed into the reflection. Music is not ducked (plays through
        // quietly as a bed).
        `--video-audio=${videoAudioLevel}`,
      ],
      {
        stdio: "inherit",
        cwd: REPO_ROOT,
        detached: process.platform !== "win32",
      },
    )
    // Remotion + headless Chrome can hang (first-run browser download stall, a
    // wedged render). Watchdog SIGKILLs past the budget so the step fails and is
    // retryable instead of blocking the daily job indefinitely.
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      void terminateProcessTree(c)
    }, RENDER_TIMEOUT_MS)
    c.on("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
    c.on("close", (code) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(
          new DevotionalRenderError(
            "process_timeout",
            `render timed out after ${RENDER_TIMEOUT_MS}ms`,
          ),
        )
      } else if (code === 0) resolve()
      else
        reject(
          new DevotionalRenderError("process_failed", `render exited ${code}`),
        )
    })
  })
}

export type RenderOptions = {
  /** Directory to write the MP4 into. */
  outDir: string
  /** "portrait" (9:16 social, default) or "wide" (16:9 desktop/YouTube). */
  aspect?: "portrait" | "wide"
  /** Render a wide variant from the same prepared media after portrait. */
  renderWideVariant?: boolean
  style?: string
  /** Workspace-authored rotation used when style is not selected explicitly. */
  filterRotation?: readonly string[]
  narration?: NarrationPolicy
  layout?: string
  /** Header date label; defaults to today (Mon D). */
  headerDate?: string
  /** Music bed level (0–1). Low by default — music is a BACKGROUND bed, well
   *  below the voice. */
  musicVolume?: number
  /** Crossfade between cards (s). Slow by default for smooth transitions. */
  xfadeSec?: number
  /** Video-card clip audio level (0–1), balanced against the narration. */
  videoAudioLevel?: number
  /** Progress log; defaults to console.log. */
  log?: (msg: string) => void
}

/**
 * The RENDER stage: given the devotional text + produced audio, download and
 * trim the clip (drop the ~8s QR/titles trailer), stage per-card narration and
 * consecutive background slices, build the manifest, and spawn the Remotion
 * render. Returns the MP4 path.
 */
export async function renderDevotionalVideo(
  devo: GeneratedDevotional,
  audio: ProducedDevotionalAudio,
  options: RenderOptions,
): Promise<string> {
  const log = options.log ?? ((m: string) => console.log(m))
  // Filter ROTATES per devotional (owner: option b) — splittone → grain →
  // tealorange by sequence; layout stays fixed for readable, consistent text.
  const style =
    options.style ?? rotateFilter(devo.sequence, options.filterRotation)
  const layout = options.layout ?? "grounded"
  // Owner rule: the cover date carries the weekday — "Monday, Jul 14".
  // Cover date format (owner design): "Thursday · December 25" — full weekday,
  // middot separator, full month; the composition upper-cases + tracks it.
  const headerDate =
    options.headerDate ?? formatHeaderDate(devo.date, options.narration)

  const stage = await mkdtemp(path.join(tmpdir(), "devo-render-"))
  try {
    return await renderInStage(devo, audio, options, {
      stage,
      style,
      layout,
      headerDate,
      log,
    })
  } finally {
    // Always remove the temp tree (full film download + trimmed clips + audio):
    // the video-first flow renders TWICE per run, so a leak fills /tmp fast.
    await rm(stage, { recursive: true, force: true }).catch(() => {})
  }
}

type RenderStageContext = {
  stage: string
  style: string
  layout: string
  headerDate: string
  log: (msg: string) => void
}

export function devotionalVideoOutputPath(
  devo: GeneratedDevotional,
  outDir: string,
  aspect: "portrait" | "wide",
): string {
  const suffix = aspect === "wide" ? "-wide" : ""
  const slug = devo.clip.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()
  return path.join(outDir, `${slug}-seq${devo.sequence}${suffix}.mp4`)
}

async function renderInStage(
  devo: GeneratedDevotional,
  audio: ProducedDevotionalAudio,
  options: RenderOptions,
  ctx: RenderStageContext,
): Promise<string> {
  const { stage, style, layout, headerDate, log } = ctx
  log(`download clip ${devo.clip.id}…`)
  const full = path.join(stage, "full.mp4")
  const clip = path.join(stage, "clip.mp4")
  await download(await arclightClipUrl(devo.clip.id), full)
  const fullDur = await probeDuration(full)
  // Every JESUS-film chapter ends with ~8s of QR code + titles — never show it.
  const TRAILER = 8
  const usableDur = Math.max(1, fullDur - TRAILER)
  // Extra footage past each card's on-screen time so the video keeps playing
  // through the crossfade instead of freezing on its last frame.
  const MARGIN = 3
  // The JESUS film is old and slow; play the video-card clip a touch faster so
  // it's less draggy. Pitch-preserved (atempo), so ~1.12× is imperceptible in
  // the dialogue. The on-screen duration shrinks by the same factor.
  const VIDEO_SPEED = 1.12
  const window = devo.passage as GeneratedDevotional["passage"] & {
    clipStartSec?: number
    clipLengthSec?: number
  }
  let videoCardSec: number
  if (window?.clipStartSec != null && window.clipLengthSec != null) {
    const start = Math.min(window.clipStartSec, usableDur - 1)
    const len = Math.min(window.clipLengthSec + MARGIN, usableDur - start)
    log(
      `trim clip → ${start}s +${window.clipLengthSec}s ×${VIDEO_SPEED} (usable ${usableDur.toFixed(0)}s, +${MARGIN}s margin)…`,
    )
    await trimClip(full, clip, start, len, true, VIDEO_SPEED) // normalize + speed
    videoCardSec =
      Math.min(window.clipLengthSec, usableDur - start) / VIDEO_SPEED
  } else {
    await trimClip(full, clip, 0, usableDur, true, VIDEO_SPEED)
    videoCardSec = 18 / VIDEO_SPEED
  }
  const clipDurationSec = await probeDuration(clip)

  const segments: StagedSegment[] = []
  let n = 1
  for (const s of audio.segments) {
    const file = `${String(n).padStart(2, "0")}-${s.id}.mp3`
    await writeFile(path.join(stage, file), s.audio.bytes)
    segments.push({
      id: s.id,
      file,
      durationSec: await probeDuration(path.join(stage, file)),
      text: s.text,
    })
    n++
  }
  let musicFile: string | undefined
  if (audio.music) {
    musicFile = "music.mp3"
    await writeFile(path.join(stage, musicFile), audio.music.audio.bytes)
  }

  const manifest = buildDevotionalManifest({
    devotional: devo,
    segments,
    clipFile: "clip.mp4",
    clipDurationSec,
    videoCardSec,
    musicFile,
    headerDate,
  })

  // SEAMLESS BACKGROUND: cut ONE continuous slice of the source film and let
  // EVERY non-video card be a window into it (the composition sets each card's
  // trimBefore so adjacent cards share the exact same frame across a crossfade —
  // no repeated motion, no visible cut). The clear video card keeps its own
  // curated meaningful window. The single clip must be long enough to cover the
  // whole background timeline: the sum of every non-video card's ON-SCREEN time
  // plus the composition's per-card tails, the cover's intro lead, and the
  // trailing crossfade — with a safety margin, capped to the usable range.
  const bgTimelineSec = computeBackgroundTimelineSec(manifest.cards)
  const bgLen = Math.min(bgTimelineSec, usableDur)
  await trimClip(full, path.join(stage, "bg.mp4"), 0, bgLen)
  manifest.bgFile = "bg.mp4"
  manifest.bgDurationSec = bgLen
  // If the usable film is shorter than the background timeline, play the ONE
  // continuous clip slightly slower so it stretches to cover every card without
  // running out (imperceptible on a slow shot). Never faster than 1×.
  manifest.bgPlaybackRate =
    bgTimelineSec > usableDur ? Math.max(0.8, usableDur / bgTimelineSec) : 1
  // Non-video cards read the shared top-level bgFile — clear any per-card bg so
  // they all window into the ONE continuous clip.
  for (const card of manifest.cards) {
    if (card.kind !== "video") {
      delete card.bgFile
      delete card.bgDurationSec
    }
  }
  log(
    `background: one continuous ${bgLen.toFixed(0)}s slice (seamless windows per card)`,
  )

  await writeFile(
    path.join(stage, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  )

  await mkdir(options.outDir, { recursive: true })
  const aspect = options.aspect ?? "portrait"
  const comp = aspect === "wide" ? "devotional-wide" : "devotional"
  const videoPath = devotionalVideoOutputPath(devo, options.outDir, aspect)
  log(`render (${aspect}) → ${videoPath}`)
  await runRender(
    path.join(stage, "manifest.json"),
    path.join(stage, "remotion-public"),
    videoPath,
    comp,
    style,
    layout,
    options.musicVolume ?? 0.12,
    options.xfadeSec ?? 1.2,
    options.videoAudioLevel ?? 0.55,
  )
  if (options.renderWideVariant && aspect === "portrait") {
    const wideVideoPath = devotionalVideoOutputPath(
      devo,
      options.outDir,
      "wide",
    )
    log(`render (wide) -> ${wideVideoPath}`)
    await runRender(
      path.join(stage, "manifest.json"),
      path.join(stage, "remotion-public"),
      wideVideoPath,
      "devotional-wide",
      style,
      layout,
      options.musicVolume ?? 0.12,
      options.xfadeSec ?? 1.2,
      options.videoAudioLevel ?? 0.55,
    )
  }
  return videoPath
}

export type PrepareAndRenderInput = RenderOptions & {
  chapterIndex: number
  sequence: number
  date: string
  llm: DevotionalLlm
  /** Required Workspace-backed authored inputs for uncached generation. */
  generationDeps?: GenerateDevotionalDeps
  audioDeps?: ProduceDevotionalAudioDeps
}

export type RenderedDevotional = {
  devotional: GeneratedDevotional
  videoPath: string
}

export async function prepareAndRenderDevotional(
  input: PrepareAndRenderInput,
): Promise<RenderedDevotional> {
  const log = input.log ?? ((m: string) => console.log(m))

  log(`generate (ch${input.chapterIndex}, seq${input.sequence})…`)
  if (!input.generationDeps) {
    throw new Error("Workspace-authored generation dependencies are required")
  }
  const devo = await generateDevotional(
    {
      chapterIndex: input.chapterIndex,
      sequence: input.sequence,
      date: input.date,
      llm: input.llm,
    },
    input.generationDeps,
  )
  if (!input.audioDeps) {
    throw new Error("Workspace-authored audio dependencies are required")
  }
  log("produce audio…")
  const audio = await produceDevotionalAudio(devo, input.audioDeps)

  const videoPath = await renderDevotionalVideo(devo, audio, input)
  return { devotional: devo, videoPath }
}

export const _internal = {
  computeBackgroundTimelineSec,
  devotionalVideoOutputPath,
  formatHeaderDate,
}
