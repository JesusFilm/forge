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
  type ProducedDevotionalAudio,
} from "./devotional-audio"
import { joinAudioVarGaps, slowAndPad } from "./audio-concat"
import {
  cacheDirFor,
  loadCachedAudio,
  loadCachedDevo,
  loadReusableAudio,
  saveCachedAudio,
  saveCachedDevo,
} from "./devotional-cache"
import {
  buildDevotionalManifest,
  type StagedSegment,
} from "./devotional-manifest"
import { occasionFor } from "./devotional-occasions"
import {
  DevotionalQualityGateError,
  reviewDevotionalText,
} from "./devotional-quality-gate"
import {
  generateDevotional,
  type GeneratedDevotional,
} from "./generate-devotional"
import { buildDevotionalAgentLlms } from "./devotional-models"
import {
  EN_LOCALE,
  localeFor,
  type DevotionalLang,
  type DevotionalLocale,
} from "./devotional-locale"
import { localizeDevotional } from "./localize-devotional"
import { applyStressOverrides } from "./speakify-tts"
import {
  findActBreak,
  fetchEditedWindow,
  mapCuesToEditedTimeline,
  type SubtitleCue,
  type TimedCaption,
} from "./subtitle-align"
import { passageForChapter } from "./jesus-film-passages"
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
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]

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

// ---- background-timeline budget --------------------------------------------
// These MUST agree with how the composition lays cards out, or the shared
// background clip gets cut too short and the last cards FREEZE on its final
// frame. `introHoldSec`/`outroHoldSec` are written onto the manifest below, so
// THIS FILE is the single source of truth for those two (the composition falls
// back to its own INTRO_HOLD_FRAMES/OUTRO_HOLD_FRAMES only when absent).
//
// CARD_TAIL_SEC has no manifest override, so it must be kept in step with
// CARD_TAIL_FRAMES in packages/shorts-compositions/src/devotional/timing.ts
// (24 frames @ 30fps = 0.8s). A stale value here is exactly what caused the
// end-of-video freeze once that tail grew from 0.4s to 0.8s.
const CARD_TAIL_SEC = 0.8
/** Silent beat on the FIRST card before the narration starts. */
const INTRO_HOLD_SEC = 1
/** Held beat on the LAST card after its narration, to sit with the question. */
const OUTRO_HOLD_SEC = 8
/** Slack for the per-boundary crossfades (each card lingers into the next). */
const BG_SAFETY_SEC = 5
/**
 * Floor for the background's playback rate. When the usable film is SHORTER
 * than the background timeline, the clip is slowed to stretch across it; the
 * background is heavily blurred, dimmed and Ken-Burns-zoomed, so a slow rate is
 * imperceptible — whereas running out of footage is a visible freeze. (Was
 * 0.8, which wasn't enough for short chapters: "Jesus Calms the Storm" has
 * ~111s of usable film against a ~154s timeline, so it needs ~0.72.)
 */
const BG_MIN_PLAYBACK_RATE = 0.5

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
    throw new Error("download URL is not a valid URL")
  }
  if (u.protocol !== "https:") {
    throw new Error(`refusing non-https download URL (${u.protocol})`)
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
    throw new Error(`refusing private/reserved download host (${host})`)
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
        new Error(
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
        reject(new Error(`ffprobe exit ${code} for ${file}`))
        return
      }
      const v = Number.parseFloat(out.trim())
      if (!Number.isFinite(v) || v <= 0) {
        reject(new Error(`ffprobe returned no usable duration for ${file}`))
        return
      }
      resolve(v)
    })
  })
}

type ArclightClipInfo = { downloadUrl: string; subtitleUrl?: string }

async function arclightClipInfo(
  mediaId: string,
  languageId = 529,
): Promise<ArclightClipInfo> {
  const r = await fetch(
    `https://api.arclight.org/v2/media-components/${mediaId}/languages/${languageId}?platform=web`,
    { signal: AbortSignal.timeout(METADATA_TIMEOUT_MS) },
  )
  if (!r.ok) throw new Error(`Arclight ${mediaId}: HTTP ${r.status}`)
  const j = (await r.json()) as {
    downloadUrls?: Record<string, { url: string }>
    subtitleUrls?: Record<string, Array<{ languageId: number; url: string }>>
  }
  const downloadUrl = j.downloadUrls?.high?.url ?? j.downloadUrls?.low?.url
  if (!downloadUrl) throw new Error(`Arclight ${mediaId}: no downloadUrls`)
  // Subtitle track for the SAME language (for clip-window alignment).
  const subtitleUrl = j.subtitleUrls?.srt?.find(
    (t) => t.languageId === languageId,
  )?.url
  return { downloadUrl, subtitleUrl }
}

async function download(url: string, dest: string): Promise<void> {
  assertPublicHttpsUrl(url)
  const r = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })
  if (!r.ok) throw new Error(`download ${url}: HTTP ${r.status}`)
  if (!r.body) throw new Error(`download ${url}: empty response body`)
  const declared = Number(r.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
    throw new Error(
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
        throw new Error(
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

/** Spawn ffmpeg with `args`, capturing stderr for the error message and
 *  watchdog-killing a hung encode so it can't wedge the run. Shared by every
 *  ffmpeg call in this module (single-trim and multi-segment concat alike). */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] })
    let err = ""
    c.stderr.on("data", (d) => {
      if (err.length < 4000) err += d.toString()
    })
    const timer = setTimeout(() => {
      c.kill("SIGKILL")
      reject(new Error(`ffmpeg timed out after ${FFMPEG_TIMEOUT_MS}ms`))
    }, FFMPEG_TIMEOUT_MS)
    c.on("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
    c.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${err.trim().slice(-500)}`))
    })
  })
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
  return runFfmpeg(args)
}

/**
 * Concatenate multiple [startSec, startSec+lengthSec] pieces of `src` into
 * one `dest` — the multi-segment counterpart of `trimClip`, used when
 * `removeInternalGaps` cut one or more dead-air gaps out of the window. A
 * single segment falls through to the identical single-trim behavior.
 */
function trimClipSegments(
  src: string,
  dest: string,
  segments: ReadonlyArray<{ startSec: number; lengthSec: number }>,
  normalize = false,
  speed = 1,
): Promise<void> {
  if (segments.length === 1) {
    return trimClip(
      src,
      dest,
      segments[0].startSec,
      segments[0].lengthSec,
      normalize,
      speed,
    )
  }
  const args = ["-y"]
  for (const seg of segments) {
    args.push("-ss", String(seg.startSec), "-t", String(seg.lengthSec), "-i", src)
  }
  const parts: string[] = []
  for (let i = 0; i < segments.length; i++) {
    parts.push(`[${i}:v][${i}:a]`)
  }
  const filters = [`${parts.join("")}concat=n=${segments.length}:v=1:a=1[vc][ac]`]
  const vTail = speed !== 1 ? `,setpts=PTS/${speed}` : ""
  filters.push(`[vc]null${vTail}[v]`)
  const aChain = [
    ...(speed !== 1 ? [`atempo=${speed}`] : []),
    ...(normalize ? ["loudnorm=I=-18:TP=-2:LRA=11"] : []),
  ]
  filters.push(`[ac]${aChain.length ? aChain.join(",") : "anull"}[a]`)
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    dest,
  )
  return runFfmpeg(args)
}

function runRender(
  manifest: string,
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
      { stdio: "inherit", cwd: REPO_ROOT },
    )
    // Remotion + headless Chrome can hang (first-run browser download stall, a
    // wedged render). Watchdog SIGKILLs past the budget so the step fails and is
    // retryable instead of blocking the daily job indefinitely.
    const timer = setTimeout(() => {
      c.kill("SIGKILL")
      reject(new Error(`render timed out after ${RENDER_TIMEOUT_MS}ms`))
    }, RENDER_TIMEOUT_MS)
    c.on("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
    c.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`render exited ${code}`))
    })
  })
}

export type RenderOptions = {
  /** Directory to write the MP4 into. */
  outDir: string
  /** "portrait" (9:16 social, default) or "wide" (16:9 desktop/YouTube). */
  aspect?: "portrait" | "wide"
  style?: string
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
  /** Language/localization (film audio, labels, date, connectors). Default en. */
  locale?: DevotionalLocale
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
  const locale = options.locale ?? EN_LOCALE
  // Filter ROTATES per devotional (owner: option b) — splittone → grain →
  // tealorange by sequence; layout stays fixed for readable, consistent text.
  const style = options.style ?? rotateFilter(devo.sequence)
  const layout = options.layout ?? "grounded"
  const now = new Date()
  // Cover date via the locale ("Thursday · December 25" / "Четверг · 25 декабря";
  // the composition upper-cases + tracks it). Falls back to today if unparseable.
  const headerDate =
    options.headerDate ??
    locale.coverDate(devo.date) ??
    `${WEEKDAYS[now.getDay()]} · ${MONTHS[now.getMonth()]} ${now.getDate()}`

  const stage = await mkdtemp(path.join(tmpdir(), "devo-render-"))
  try {
    return await renderInStage(devo, audio, options, {
      stage,
      style,
      layout,
      headerDate,
      locale,
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
  locale: DevotionalLocale
  log: (msg: string) => void
}

async function renderInStage(
  devo: GeneratedDevotional,
  audio: ProducedDevotionalAudio,
  options: RenderOptions,
  ctx: RenderStageContext,
): Promise<string> {
  const { stage, style, layout, headerDate, locale, log } = ctx
  log(`download clip ${devo.clip.id} (lang ${locale.lang})…`)
  const full = path.join(stage, "full.mp4")
  const clip = path.join(stage, "clip.mp4")
  const clipInfo = await arclightClipInfo(devo.clip.id, locale.filmLanguageId)
  await download(clipInfo.downloadUrl, full)
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
  // Owner rule: the "clear" video card (before it cuts to blurred-background
  // text cards) must stay in this range — long enough to feel like a real
  // scene, never so long it drags. Without a cap this was set to the FULL
  // trimmed clip length (~60-70s+ for some chapters), not a highlight window.
  const MIN_VIDEO_CARD_SEC = 30
  const MAX_VIDEO_CARD_SEC = 60
  const clampVideoCardSec = (sec: number) =>
    Math.min(MAX_VIDEO_CARD_SEC, Math.max(MIN_VIDEO_CARD_SEC, sec))
  const window = passageForChapter(devo.clip.index)
  // Assigned by every branch below (two-act split, single clip, or the
  // no-curated-window fallback); the assertion after the block proves it
  // rather than letting a sentinel 0 reach the manifest.
  let videoCardSec = 0
  // Captions for the video card, timed against the FINAL edited clip.
  let videoCaptions: TimedCaption[] = []
  // TWO-ACT LAYOUT (opt-in per chapter) — set only when the clip was split.
  let act2Captions: TimedCaption[] = []
  let act2Info: { clipFile: string; durationSec: number } | undefined
  if (window?.clipStartSec != null && window.clipLengthSec != null) {
    let winStart = window.clipStartSec
    let winLen = window.clipLengthSec
    // The curated windows are hand-picked timestamps that often land mid-phrase
    // (and a dubbed language says the scene with different timing anyway), so use
    // the curated window as a SEED and snap it to THAT language's subtitle cue
    // boundaries — for every language, English included. Best-effort. Owner
    // rule: seeds are curated WIDE (from the scene's setup dialogue, showing a
    // whole story, not just the verse's moment) — `removeInternalGaps` then
    // cuts any dead-air gap >=10s back out per language, so the wide seed
    // never actually airs as a too-long clip.
    let clipSegments: { startSec: number; lengthSec: number }[] = [
      { startSec: winStart, lengthSec: winLen },
    ]
    let sourceCues: SubtitleCue[] = []
    if (clipInfo.subtitleUrl) {
      const edited = await fetchEditedWindow(
        clipInfo.subtitleUrl,
        winStart,
        winLen,
        {},
        {
          ...(window.minGapSec != null ? { minGapSec: window.minGapSec } : {}),
          ...(window.maxGapSec != null ? { maxGapSec: window.maxGapSec } : {}),
        },
      )
      if (edited) {
        winStart = edited.startSec
        winLen = edited.lengthSec
        clipSegments = edited.segments
        sourceCues = edited.cues
        const cutNote =
          edited.segments.length > 1
            ? ` (${edited.segments.length - 1} pause${edited.segments.length > 2 ? "s" : ""} cut)`
            : ""
        log(
          `aligned clip to ${locale.lang} subtitles → ${winStart.toFixed(1)}s +${winLen.toFixed(1)}s${cutNote}`,
        )
      }
    }
    // Clamp every segment to the usable range, then append MARGIN of extra
    // (uncut) trailing footage so the clip keeps rolling through the
    // crossfade/fade instead of freezing or cutting off mid-word.
    const clamped = clipSegments
      .map((s) => {
        const startSec = Math.min(s.startSec, usableDur - 1)
        const lengthSec = Math.min(s.lengthSec, usableDur - startSec)
        return { startSec, lengthSec }
      })
      .filter((s) => s.lengthSec > 0.1)
    const onScreenSec = clamped.reduce((sum, s) => sum + s.lengthSec, 0)
    const last = clamped[clamped.length - 1]
    const marginAvailable = Math.max(
      0,
      Math.min(MARGIN, usableDur - (last.startSec + last.lengthSec)),
    )
    const trimSegments =
      marginAvailable > 0
        ? [
            ...clamped.slice(0, -1),
            { ...last, lengthSec: last.lengthSec + marginAvailable },
          ]
        : clamped
    log(
      `trim clip → ${trimSegments.length} segment(s), ${onScreenSec.toFixed(1)}s on-screen ×${VIDEO_SPEED} (usable ${usableDur.toFixed(0)}s, +${marginAvailable.toFixed(1)}s margin)…`,
    )
    // TWO-ACT LAYOUT: cut the window at its longest internal silence and
    // encode the halves as two clips, so the manifest can play act 1, show
    // the first half of the reflection, then play act 2. Only when the
    // chapter opted in AND the reflection actually came back as two halves.
    const wantsActs = window.splitActs === true && devo.reflection.parts?.length === 2
    const actBreak = wantsActs
      ? findActBreak(sourceCues, winStart, winLen)
      : null
    if (actBreak) {
      const inAct1 = (s: { startSec: number; lengthSec: number }) =>
        s.startSec < actBreak.act1EndSec
      const act1Segments = trimSegments
        .filter(inAct1)
        .map((s) => ({
          startSec: s.startSec,
          lengthSec: Math.min(s.lengthSec, actBreak.act1EndSec - s.startSec),
        }))
        .filter((s) => s.lengthSec > 0.1)
      const act2Segments = trimSegments
        .map((s) => {
          const startSec = Math.max(s.startSec, actBreak.act2StartSec)
          return { startSec, lengthSec: s.startSec + s.lengthSec - startSec }
        })
        .filter((s) => s.lengthSec > 0.1)

      if (act1Segments.length > 0 && act2Segments.length > 0) {
        const clip2 = path.join(stage, "clip2.mp4")
        await trimClipSegments(full, clip, act1Segments, true, VIDEO_SPEED)
        await trimClipSegments(full, clip2, act2Segments, true, VIDEO_SPEED)
        const act1Sec = act1Segments.reduce((s, x) => s + x.lengthSec, 0) / VIDEO_SPEED
        const act2Sec = act2Segments.reduce((s, x) => s + x.lengthSec, 0) / VIDEO_SPEED
        videoCardSec = clampVideoCardSec(act1Sec)
        if (sourceCues.length > 0) {
          videoCaptions = mapCuesToEditedTimeline(sourceCues, act1Segments, VIDEO_SPEED)
          act2Captions = mapCuesToEditedTimeline(sourceCues, act2Segments, VIDEO_SPEED)
        }
        // Cap by the clip that was ACTUALLY encoded, exactly as the main
        // video card does. Deriving the duration from the segment arithmetic
        // alone leaves no margin, and any rounding against the real file
        // holds the last frame — the freeze this replaced.
        const clip2Dur = await probeDuration(clip2)
        act2Info = {
          clipFile: "clip2.mp4",
          // NEVER apply the 30s MINIMUM to act 2. The minimum exists so a
          // single video card feels like a scene, but act 2 is naturally
          // short (22.8s here) — padding it to 30s made the card outlast its
          // own footage and the picture FROZE on the last frame for ~7s while
          // the music kept playing (owner-reported). Cap only the maximum,
          // and never exceed what was actually encoded.
          durationSec: Math.min(act2Sec, MAX_VIDEO_CARD_SEC, clip2Dur),
        }
        log(
          `two-act split at ${actBreak.act1EndSec.toFixed(1)}s → act1 ${act1Sec.toFixed(1)}s (${videoCaptions.length} cues), act2 ${act2Sec.toFixed(1)}s (${act2Captions.length} cues)`,
        )
      }
    }

    if (!act2Info) {
      await trimClipSegments(full, clip, trimSegments, true, VIDEO_SPEED) // normalize + speed
      videoCardSec = clampVideoCardSec(onScreenSec / VIDEO_SPEED)
      // Captions must follow the SAME edit as the picture: cut-out pauses shift
      // later lines earlier, and the speed-up compresses every timestamp. Map
      // against `trimSegments` (exactly what was encoded into clip.mp4).
      if (sourceCues.length > 0) {
        videoCaptions = mapCuesToEditedTimeline(
          sourceCues,
          trimSegments,
          VIDEO_SPEED,
        )
        log(`captions: ${videoCaptions.length} cue(s) mapped onto the edited clip`)
      }
    }
  } else {
    await trimClip(full, clip, 0, usableDur, true, VIDEO_SPEED)
    videoCardSec = clampVideoCardSec(usableDur / VIDEO_SPEED)
  }
  if (videoCardSec <= 0) {
    throw new Error("internal: video card duration was never computed")
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
    labels: locale.labels,
    occasion: occasionFor(devo.date, locale.lang) ?? undefined,
    videoCaptions,
    ...(act2Info
      ? { act2: { ...act2Info, captions: act2Captions } }
      : {}),
  })

  // SEAMLESS BACKGROUND: cut ONE continuous slice of the source film and let
  // EVERY non-video card be a window into it (the composition sets each card's
  // trimBefore so adjacent cards share the exact same frame across a crossfade —
  // no repeated motion, no visible cut). The clear video card keeps its own
  // curated meaningful window.
  //
  // The slice MUST cover the composition's ENTIRE background timeline, or the
  // last cards run past the end of the footage and the background FREEZES on
  // its final frame (owner-reported). The timeline must therefore be counted
  // the SAME way the composition lays cards out (framesFromDurations +
  // calculateDevotionalMetadata): every non-video card's narration + its hold +
  // a per-card tail, plus the held beats the composition adds at the very start
  // and very end.
  const bgTimelineSec = manifest.cards.reduce(
    (sum, card) => {
      if (card.kind === "video") return sum
      return (
        sum +
        (Number(card.durationSec) || 3) +
        (Number(card.holdSec) || 0) +
        CARD_TAIL_SEC
      )
    },
    INTRO_HOLD_SEC + OUTRO_HOLD_SEC + BG_SAFETY_SEC,
  )
  const bgLen = Math.min(bgTimelineSec, usableDur)
  await trimClip(full, path.join(stage, "bg.mp4"), 0, bgLen)
  manifest.bgFile = "bg.mp4"
  manifest.bgDurationSec = bgLen
  // Pin the held beats the composition adds to the first/last card, so its
  // layout can't drift from the budget computed above.
  manifest.introHoldSec = INTRO_HOLD_SEC
  manifest.outroHoldSec = OUTRO_HOLD_SEC
  // If the usable film is SHORTER than the background timeline, slow the ONE
  // continuous clip so it stretches across every card instead of running out
  // (a freeze). Never faster than 1×.
  const bgRate =
    bgTimelineSec > usableDur
      ? Math.max(BG_MIN_PLAYBACK_RATE, usableDur / bgTimelineSec)
      : 1
  manifest.bgPlaybackRate = bgRate
  // Non-video cards read the shared top-level bgFile — clear any per-card bg so
  // they all window into the ONE continuous clip.
  for (const card of manifest.cards) {
    if (card.kind !== "video") {
      delete card.bgFile
      delete card.bgDurationSec
    }
  }
  const bgCoverageSec = bgLen / bgRate
  log(
    `background: one continuous ${bgLen.toFixed(0)}s slice ×${bgRate.toFixed(2)} → covers ${bgCoverageSec.toFixed(0)}s of a ${bgTimelineSec.toFixed(0)}s timeline`,
  )
  if (bgCoverageSec < bgTimelineSec - 0.5) {
    // Only reachable when the film is so short that even the slowest allowed
    // rate can't cover the timeline — the background would freeze at the end.
    log(
      `⚠️  background is ${(bgTimelineSec - bgCoverageSec).toFixed(0)}s short — it will hold its last frame at the end`,
    )
  }

  await writeFile(
    path.join(stage, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  )

  await mkdir(options.outDir, { recursive: true })
  const aspect = options.aspect ?? "portrait"
  const comp = aspect === "wide" ? "devotional-wide" : "devotional"
  const suffix = aspect === "wide" ? "-wide" : ""
  // Clip title stays English, so tag non-English renders to avoid overwriting.
  const langSuffix = locale.lang === "en" ? "" : `-${locale.lang}`
  const slug = devo.clip.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()
  const videoPath = path.join(
    options.outDir,
    `${slug}-seq${devo.sequence}${langSuffix}${suffix}.mp4`,
  )
  log(`render (${aspect}) → ${videoPath}`)
  await runRender(
    path.join(stage, "manifest.json"),
    videoPath,
    comp,
    style,
    layout,
    options.musicVolume ?? 0.12,
    options.xfadeSec ?? 1.2,
    options.videoAudioLevel ?? 0.55,
  )
  return videoPath
}

export type PrepareAndRenderInput = RenderOptions & {
  chapterIndex: number
  sequence: number
  date: string
  llm: DevotionalLlm
  /** Optional stronger model for translation/adaptation (localization). Falls
   *  back to `llm` when omitted. Set from getDevotionalTranslateModel(). */
  translateLlm?: DevotionalLlm
  /** Target language. "en" (default) renders the English devotional; any other
   *  language localizes it (translate copy + Synodal scripture + film audio). */
  lang?: DevotionalLang
  /** Explicit narration voice id/alias for THIS render (e.g. auditioning a
   *  voice). Overrides the locale voice and forces audio regen; does not change
   *  any default. */
  voiceOverride?: string
  /** Regenerate the text (and therefore audio) instead of reusing the cache. */
  regenerate?: boolean
  /** Regenerate only the voice/music audio, keeping the cached text. Useful for
   *  TTS glitches or after hand-editing the cached devo.json. */
  regenerateAudio?: boolean
  /** Render even when the quality gate finds a high-severity problem (or a
   *  critic could not run). Default false — the gate runs BEFORE audio and
   *  video precisely so a bad text doesn't cost a TTS bill and a render. */
  ignoreQualityGate?: boolean
}

export type RenderedDevotional = {
  devotional: GeneratedDevotional
  videoPath: string
}

export async function prepareAndRenderDevotional(
  input: PrepareAndRenderInput,
): Promise<RenderedDevotional> {
  const log = input.log ?? ((m: string) => console.log(m))
  const lang = input.lang ?? "en"
  const locale = localeFor(lang)

  // Text and audio are cached separately so render-only tweaks reuse both, a
  // TTS glitch can regenerate just the audio (keeping the wording), and a hand
  // edit to the cached devo.json flows into a fresh audio render. English is
  // cached under ch<N>-seq<M>; a localized edition gets its own -<lang> dir.
  const enDir = cacheDirFor(input.chapterIndex, input.sequence)
  let devo = input.regenerate ? null : await loadCachedDevo(enDir)
  if (devo) {
    log("reusing cached devotional text")
  } else {
    log(`generate (ch${input.chapterIndex}, seq${input.sequence})…`)
    devo = await generateDevotional({
      chapterIndex: input.chapterIndex,
      sequence: input.sequence,
      date: input.date,
      llm: input.llm,
      // Per-agent models: strong for modernizer/copywriter, cheap for the rest.
      llms: buildDevotionalAgentLlms(),
      log,
    })
    await saveCachedDevo(enDir, devo)
  }

  // Localize the finished English devotional (translate copy + Synodal verse +
  // film-language voice), cached under the -<lang> dir.
  let cacheDir = enDir
  if (lang !== "en") {
    cacheDir = cacheDirFor(input.chapterIndex, input.sequence, lang)
    const cached = input.regenerate ? null : await loadCachedDevo(cacheDir)
    if (cached) {
      log(`reusing cached ${lang} devotional text`)
      devo = cached
    } else {
      log(`localize → ${lang}…`)
      devo = await localizeDevotional({
        devotional: devo,
        locale,
        llm: input.llm,
        translateLlm: input.translateLlm,
      })
      await saveCachedDevo(cacheDir, devo)
    }
  }

  // Always apply the locale's CURRENT narration voice, so a voice change takes
  // effect even when reusing a cached localized devotional (the cached devo.json
  // may carry an older voice).
  if (locale.voice !== "rotate") devo = { ...devo, voice: locale.voice }
  // Per-render voice override (experiments) — wins over the locale voice.
  if (input.voiceOverride) {
    devo = { ...devo, voice: input.voiceOverride as GeneratedDevotional["voice"] }
  }

  // QUALITY GATE — runs on the FINAL text, before any audio or video work.
  // The critics only ever read text, so running them here instead of after the
  // render means a bad devotional costs three cheap LLM calls rather than a
  // full ElevenLabs narration plus a multi-minute Remotion render.
  const review = await reviewDevotionalText({
    devotional: devo,
    // Fidelity compares against the English modernization step, so it is
    // meaningless once `devo` is a translation — skip it for localized runs
    // rather than compare an English excerpt to Russian prose.
    checkFidelity: lang === "en",
    passageReference: devo.passage.reference,
    log,
  })
  if (review.blocking.length > 0) {
    const summary = review.blocking.join("; ")
    if (input.ignoreQualityGate) {
      log(`⚠️  quality gate FAILED but --ignore-quality was set: ${summary}`)
    } else {
      throw new DevotionalQualityGateError(review.blocking)
    }
  }

  // A voice override always regenerates audio (cached audio is a different voice).
  const reuseAudio =
    !input.regenerate && !input.regenerateAudio && !input.voiceOverride
  let audio = reuseAudio ? await loadCachedAudio(cacheDir, devo.voice) : null
  if (audio) {
    log("reusing cached audio")
  } else {
    // Reuse any cached narration whose words are IDENTICAL, so a text edit
    // only costs TTS credits for the sentences that actually changed. The
    // whole-devotional cache is all-or-nothing, which is how one edited
    // sentence previously re-voiced all ~21 segments and drained the quota.
    const reusable = await loadReusableAudio(cacheDir, devo.voice)
    log(
      reusable.size > 0
        ? `produce audio… (${reusable.size} cached segment(s) available for reuse)`
        : "produce audio…",
    )
    audio = await produceDevotionalAudio(
      devo,
      {
        reusable,
        // Numbers are spelled deterministically in the connectors. Stress marks:
        // ONLY the owner-curated overrides (spoken only). ElevenLabs' Russian
        // voice stresses most words correctly on its own; marking EVERY word
        // (dictionary blanket) degrades its delivery — mis-stress despite the
        // mark, odd phonetics, lost terminal intonation. So mark selectively.
        // The dictionary (ru-stress-dict) is the TOOL to get the correct mark
        // for a word we add to the overrides, not a blanket pass.
        speakify: (t) =>
          Promise.resolve(applyStressOverrides(t, locale.stressOverrides ?? [])),
        // Real-silence pauses at the connectors' paragraph breaks (cover date |
        // lead-in | hook; before "Давайте посмотрим"; question | prayer).
        // Real-silence pauses: short between sentences, longer between sections.
        joinVarGaps: joinAudioVarGaps,
        // Pace certain cards (scripture + last reflection slower; closing
        // slower + padded so it doesn't end abruptly).
        pace: slowAndPad,
      },
      locale,
    )
    // Narration failures were previously invisible here: produceDevotionalAudio
    // collects failed segment ids in `skipped` and returns them, but only the
    // standalone devo-audio-track script ever looked. When EVERY TTS call
    // failed, the render carried on, produced a clip-only video with no text
    // and no voice at all, and cached the empty audio as if it were valid.
    // Treat missing narration as fatal, and never persist an empty result.
    // PARTIAL loss is nearly as bad as total loss, and the first version of
    // this guard only caught zero. A real run lost 15 of 21 segments —
    // including the conclusion AND the whole question/prayer card — and still
    // shipped a 110s video that just skipped its own ending. So fail on any
    // missing STRUCTURAL card, and on losing a meaningful share of the
    // reflection; `skipped` is no longer something we merely print.
    const missing = new Set(audio.skipped)
    const structural = ["cover", "scripture", "conclusion", "questions"].filter(
      (id) => missing.has(id),
    )
    const reflectionTotal = audio.segments.filter((s) =>
      /^reflection-\d+$/.test(s.id),
    ).length
    const reflectionMissing = audio.skipped.filter((id) =>
      /^reflection-\d+$/.test(id),
    ).length
    if (
      audio.segments.length === 0 ||
      structural.length > 0 ||
      reflectionMissing > reflectionTotal
    ) {
      throw new Error(
        `narration is incomplete — refusing to render a devotional that would ` +
          `be missing content. ` +
          (structural.length
            ? `Missing whole cards: ${structural.join(", ")}. `
            : "") +
          (reflectionMissing
            ? `Missing ${reflectionMissing} reflection chunk(s). `
            : "") +
          `Skipped: ${audio.skipped.join(", ") || "(none reported)"}. ` +
          `Usually an ElevenLabs rate limit or quota — retry, or check the key.`,
      )
    }
    if (audio.reused.length > 0) {
      log(
        `♻️  reused ${audio.reused.length} cached segment(s); synthesised ${audio.segments.length - audio.reused.length}`,
      )
    }
    if (audio.skipped.length > 0) {
      log(`⚠️  narration incomplete — skipped: ${audio.skipped.join(", ")}`)
    }
    await saveCachedAudio(cacheDir, audio)
  }

  const videoPath = await renderDevotionalVideo(devo, audio, { ...input, locale })
  return { devotional: devo, videoPath }
}
