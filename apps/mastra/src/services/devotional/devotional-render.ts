import { spawn } from "node:child_process"
import { once } from "node:events"
import { createWriteStream } from "node:fs"
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { repoRoot } from "./repo-root"

import {
  buildNarrationSegments,
  produceDevotionalAudio,
  type ProducedDevotionalAudio,
} from "./devotional-audio"
import { joinAudioVarGaps, slowAndPad } from "./audio-concat"
import { createSilentVoiceover } from "./devotional-silent-voiceover"
import {
  cacheDirFor,
  loadCachedAudio,
  loadCachedDevo,
  loadReusableAudio,
  saveCachedAudio,
  saveCachedDevo,
} from "./devotional-cache"
import {
  approvalMessage,
  approvalState,
  textFingerprint,
  writeApproval,
} from "./devotional-text-approval"
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
  settleLineFor,
  type DevotionalLang,
  type DevotionalLocale,
} from "./devotional-locale"
import { localizeDevotional } from "./localize-devotional"
import { applyStressOverrides } from "./speakify-tts"
import {
  arclightMediaInfo,
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
 * Floor when the backdrop LOOPS rather than stretching one pass.
 *
 * 0.5x reads as dreamlike drift; owner called it too slow. Once the clip
 * repeats, extreme slowing buys nothing — an extra repeat covers the same
 * ground while the motion stays close to life.
 */
const BG_LOOPED_MIN_RATE = 0.85
/**
 * How long each backdrop seam dissolves.
 *
 * The pieces used to be hard-concatenated, so every repeat cut from the end of
 * the scene straight back to its start — visible as the picture starting over,
 * which is exactly what the owner reported. Dissolving the seam is what makes a
 * repeat read as ambient motion instead. Slow on purpose: a fast crossfade
 * still registers as an edit.
 */
const BG_SEAM_XFADE_SEC = 1.2

/**
 * Music bed level against the narration.
 *
 * 0.12 left the bed inaudible under a bright voice, and the narration then sat
 * bare and hard on the ear; earlier devotionals ran the other way, with the
 * music up far enough to swallow words. This sits between the two. It is a
 * starting point for the ear, not a measured value — override per render with
 * `--music-volume` while judging.
 */
const MUSIC_VOLUME_DEFAULT = 0.2

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

/**
 * Move captions in time without changing their order or duration.
 *
 * Clamped at zero: a caption cannot begin before its card exists, and a cue
 * shifted past the card's start would otherwise render at a negative time and
 * simply vanish.
 */
function shiftCaptions(
  captions: TimedCaption[],
  offsetSec: number,
): TimedCaption[] {
  if (offsetSec === 0) return captions
  return captions.map((c) => ({
    ...c,
    startSec: Math.max(0, c.startSec + offsetSec),
    endSec: Math.max(0, c.endSec + offsetSec),
  }))
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
  const { downloadApiUrl, subtitleUrl } = await arclightMediaInfo(
    mediaId,
    languageId,
  )
  if (!downloadApiUrl) throw new Error(`Arclight ${mediaId}: no downloadUrls`)
  const downloadUrl = await bestMuxRendition(downloadApiUrl)
  return { downloadUrl, subtitleUrl }
}

/**
 * Arclight's `downloadUrls.high` is 720p even when Mux is serving a 1080p
 * rendition of the same asset (the HLS master for JESUS lists 1920x1080 at
 * ~6.2 Mbps against 1280x720 at ~2.6 Mbps). Every cut pays for that twice: the
 * 16:9 cut upscales the whole frame, and the 9:16 cut scales a centre crop of a
 * 1280-wide source up to a 1080-wide frame, so the film is the softest thing in
 * a video whose text is rendered natively.
 *
 * Mux serves fixed-name renditions at `/{playbackId}/{name}.mp4`, so ask for
 * 1080p directly and keep the API's answer when it isn't published. Best
 * effort by design: a probe failure means the original URL, never a broken
 * render.
 */
async function bestMuxRendition(apiUrl: string): Promise<string> {
  const m = /^https:\/\/stream\.mux\.com\/([A-Za-z0-9]+)\/[^/]+\.mp4/.exec(
    apiUrl,
  )
  if (!m) return apiUrl
  const candidate = `https://stream.mux.com/${m[1]}/1080p.mp4`
  try {
    const r = await fetch(candidate, {
      method: "HEAD",
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    })
    return r.ok ? candidate : apiUrl
  } catch {
    return apiUrl
  }
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

/**
 * x264 settings for every INTERMEDIATE encode in this module (the trimmed clip,
 * the concatenated segments, the background pass). These files are transient:
 * Remotion decodes them and re-encodes the final video, so any loss here is
 * baked into the output and then compressed a second time.
 *
 * The old `-preset veryfast` with no `-crf` meant the default CRF 23 at the
 * second-fastest preset, on the 75 seconds of film the viewer actually watches.
 * CRF 18 at `medium` is visually transparent for an intermediate and costs a
 * few seconds of ffmpeg time on a step measured in seconds, against a render
 * measured in minutes. `yuv420p` is stated rather than inherited so a source
 * with 4:2:2 chroma can't produce a file some players refuse.
 */
const INTERMEDIATE_X264 = [
  "-preset",
  "medium",
  "-crf",
  "18",
  "-pix_fmt",
  "yuv420p",
]

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
    ...INTERMEDIATE_X264,
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
 * Build the blurred backdrop by REPEATING a window until it covers `coverSec`.
 *
 * An episode's backdrop may only show that episode's footage, which for a 30s
 * beat is far less than the ~170s timeline. Slowing alone cannot bridge that
 * (0.18x, well under the floor), and the composition cannot help: its schema
 * declares `bgDurationSec` "so the background is looped", but nothing in
 * DevotionalVideo.tsx ever reads it — the field is dead, and the render simply
 * held its last frame for the remaining two minutes.
 *
 * So the repeat happens here, in ffmpeg, where it is verifiable. `-stream_loop`
 * repeats the trimmed window; `-t` cuts the result to exactly what the timeline
 * needs. The backdrop is heavily blurred, dimmed and Ken-Burns-zoomed, so a
 * repeat reads as ambient motion rather than a visible restart.
 */
/**
 * Plan which pieces of the film make up the blurred backdrop.
 *
 * Returns SOURCE segments, in order, to be concatenated and then slowed. Every
 * piece starts at the same point in the film, so each new piece reads as the
 * scene beginning again rather than as an arbitrary jump.
 *
 * `restartAtSec` is where a deliberate restart belongs — the moment the
 * reflection begins. The backdrop plays from the top of the scene under the
 * cover and scripture, then starts over exactly as the reflection opens, which
 * lands as a considered beat instead of a loop seam falling wherever the
 * arithmetic happened to put it.
 */
export function planBackgroundSegments(input: {
  startSec: number
  windowLen: number
  coverSec: number
  speed: number
  restartAtSec?: number
  /** Source seconds each seam dissolve consumes, times the seams expected.
   *  A crossfade overlaps its two sides, so the joined result is SHORTER than
   *  the sum of its pieces; without this the backdrop lands a few seconds
   *  short and freezes on its last frame. Over-provisioning is free — the
   *  composition takes what it needs — and `buildBackground` measures the
   *  real duration afterwards either way. */
  extraSourceSec?: number
}): { startSec: number; lengthSec: number }[] {
  const { startSec, windowLen, coverSec, speed } = input
  // At 0.85x a second of film paints ~1.18s of screen, so less source than
  // screen time is needed.
  const totalSource = coverSec * speed + (input.extraSourceSec ?? 0)
  const piece = (len: number) => ({
    startSec,
    lengthSec: Math.min(len, windowLen),
  })

  const out: { startSec: number; lengthSec: number }[] = []
  let placed = 0
  if (input.restartAtSec && input.restartAtSec > 0) {
    const preSource = Math.min(input.restartAtSec * speed, totalSource)
    // The pre-reflection stretch may itself be longer than the window.
    let pre = preSource
    while (pre > 0.01) {
      const take = Math.min(pre, windowLen)
      out.push({ startSec, lengthSec: take })
      pre -= take
      placed += take
    }
  }
  while (placed < totalSource - 0.01) {
    const take = Math.min(totalSource - placed, windowLen)
    out.push(piece(take))
    placed += take
  }
  return out
}

async function buildBackground(
  src: string,
  dest: string,
  segments: { startSec: number; lengthSec: number }[],
  coverSec: number,
  speed: number,
): Promise<void> {
  if (segments.length > 1) {
    await concatWithSeamXfade(src, dest, segments, speed, BG_SEAM_XFADE_SEC)
  } else {
    await trimClipSegments(src, dest, segments, false, speed)
  }
  // MEASURE it. An earlier version logged its own arithmetic as though it were
  // the result — "looped x6 -> covers 178s" while the file was 35s — so a
  // backdrop that froze under the whole reflection reported success three runs
  // running. Never claim coverage that has not been read back off the disk.
  const built = await probeDuration(dest)
  if (built < coverSec - 1.5) {
    throw new Error(
      `background is ${built.toFixed(0)}s but the timeline needs ` +
        `${coverSec.toFixed(0)}s — it would freeze on its last frame ` +
        `(${segments.length} segment(s), speed ${speed})`,
    )
  }
}

/**
 * Join backdrop pieces with a dissolve at every seam.
 *
 * The backdrop repeats because a chapter is often shorter than the timeline it
 * has to cover — the storm scene gives 111 usable seconds under a 177-second
 * layout, so no arrangement of it avoids a repeat. What CAN be avoided is
 * seeing the repeat, and that is the whole job here.
 *
 * `xfade` overlaps its two sides, so each seam costs `dissolveSec` of the
 * joined duration; the offsets below therefore walk the running total rather
 * than the raw sum, and callers over-provision the source to compensate.
 * `acrossfade` does the same for audio so the two streams stay the same length.
 */
async function concatWithSeamXfade(
  src: string,
  dest: string,
  segments: ReadonlyArray<{ startSec: number; lengthSec: number }>,
  speed: number,
  dissolveSec: number,
): Promise<void> {
  // A dissolve cannot be longer than the shorter side of the seam it joins.
  const shortest = Math.min(...segments.map((s) => s.lengthSec))
  const d = Math.max(0.2, Math.min(dissolveSec, shortest / 2))
  const args = ["-y"]
  for (const seg of segments) {
    args.push(
      "-ss",
      String(seg.startSec),
      "-t",
      String(seg.lengthSec),
      "-i",
      src,
    )
  }
  const filters: string[] = []
  let vLabel = "0:v"
  let aLabel = "0:a"
  let running = segments[0].lengthSec
  for (let i = 1; i < segments.length; i++) {
    const v = `vx${i}`
    const a = `ax${i}`
    filters.push(
      `[${vLabel}][${i}:v]xfade=transition=fade:duration=${d}:` +
        `offset=${(running - d).toFixed(3)}[${v}]`,
      `[${aLabel}][${i}:a]acrossfade=d=${d}[${a}]`,
    )
    running = running + segments[i].lengthSec - d
    vLabel = v
    aLabel = a
  }
  const vTail = speed !== 1 ? `,setpts=PTS/${speed}` : ""
  filters.push(`[${vLabel}]format=yuv420p${vTail}[v]`)
  filters.push(`[${aLabel}]${speed !== 1 ? `atempo=${speed}` : "anull"}[a]`)
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    ...INTERMEDIATE_X264,
    "-c:a",
    "aac",
    dest,
  )
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
    args.push(
      "-ss",
      String(seg.startSec),
      "-t",
      String(seg.lengthSec),
      "-i",
      src,
    )
  }
  const parts: string[] = []
  for (let i = 0; i < segments.length; i++) {
    parts.push(`[${i}:v][${i}:a]`)
  }
  const filters = [
    `${parts.join("")}concat=n=${segments.length}:v=1:a=1[vc][ac]`,
  ]
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
    ...INTERMEDIATE_X264,
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
  // One options bag rather than a tail of positionals: the list had reached
  // eleven arguments, four of them optional, and every new render knob made the
  // single call site harder to read than the flags it forwards.
  opts: {
    coverDateLabel?: string
    /** Leave the cover's date slot out entirely (no date, no label). */
    hideCoverDate?: boolean
    coverTitleFirst?: boolean
    textFont?: "sans" | "serif"
    videoFilter?: string
    /** Review preview: render N evenly spaced PNG stills INSTEAD of the MP4.
     *  One frame of rasterization each, so a layout can be checked for the
     *  price of a few seconds rather than a full encode. */
    stills?: number
    /** Same, at exactly these frame numbers. */
    stillsFrames?: string
    /** Grain tile size in px; smaller reads as finer film grain. */
    grainSizePx?: number
    /** Tint + blend for the grain noise; see the composition schema. */
    grainFilter?: string
    grainBlend?: string
    /** Multiplier on every card's background blur. */
    blurScale?: number
    /** Render only this slice of the timeline, "start-end" in frames. */
    frameRange?: string
  } = {},
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
        ...(opts.coverDateLabel
          ? [`--cover-date-label=${opts.coverDateLabel}`]
          : []),
        ...(opts.hideCoverDate ? ["--hide-cover-date=true"] : []),
        ...(opts.frameRange ? [`--frame-range=${opts.frameRange}`] : []),
        ...(opts.coverTitleFirst ? ["--cover-title-first=true"] : []),
        ...(opts.textFont ? [`--text-font=${opts.textFont}`] : []),
        ...(opts.videoFilter ? [`--vfilter=${opts.videoFilter}`] : []),
        ...(opts.stills ? [`--stills=${opts.stills}`] : []),
        ...(opts.stillsFrames ? [`--stills-frames=${opts.stillsFrames}`] : []),
        ...(opts.grainSizePx ? [`--grain-size=${opts.grainSizePx}`] : []),
        ...(opts.grainFilter ? [`--grain-filter=${opts.grainFilter}`] : []),
        ...(opts.grainBlend ? [`--grain-blend=${opts.grainBlend}`] : []),
        ...(opts.blurScale ? [`--blur-scale=${opts.blurScale}`] : []),
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

/**
 * Name the output file so nothing a render can vary silently overwrites
 * something else.
 *
 * Every part earns its place by a collision it prevents: two episodes of one
 * scene share the clip title AND the sequence, a localized edition shares
 * everything but the language, and the wide cut shares everything but the
 * aspect. The episode tag was added after episode 1 of Zacchaeus overwrote the
 * full-scene devotional of the same name.
 */
export function devotionalVideoFilename(input: {
  clipTitle: string
  sequence: number
  lang: string
  aspect: "portrait" | "wide"
  episode?: number
}): string {
  // Trim the edges: a title ending in punctuation ("Jesus' Triumphal Entry!")
  // otherwise leaves a trailing dash and the name comes out double-dashed.
  const slug = input.clipTitle
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
  const ep = input.episode ? `-ep${input.episode}` : ""
  const lang = input.lang === "en" ? "" : `-${input.lang}`
  const aspect = input.aspect === "wide" ? "-wide" : ""
  return `${slug}-seq${input.sequence}${ep}${lang}${aspect}.mp4`
}

/**
 * The first name in `dir` that is not taken: `name.mp4`, then `name-v2.mp4`,
 * `name-v3.mp4`, …
 *
 * Owner rule: a re-render must NEVER replace the previous file. Re-rendering
 * the same chapter to compare two treatments used to overwrite the cut she had
 * already reviewed, so the comparison was gone by the time the new render
 * finished.
 */
export async function nextFreePath(
  dir: string,
  filename: string,
): Promise<string> {
  const ext = path.extname(filename)
  const base = filename.slice(0, filename.length - ext.length)
  // Bounded: at some point a directory of 200 takes is the real problem.
  for (let n = 1; n < 200; n++) {
    const candidate = path.join(dir, n === 1 ? filename : `${base}-v${n}${ext}`)
    try {
      await stat(candidate)
    } catch {
      return candidate
    }
  }
  throw new Error(
    `${dir} already holds 199 renders of ${base}${ext} — clear some out first`,
  )
}

export type RenderOptions = {
  /** Directory to write the MP4 into. */
  outDir: string
  /** 1-based episode of a scene split into a series. Tags the filename, so
   *  episodes of one scene do not overwrite each other — they share a clip
   *  title and a sequence, which is everything else the name is built from. */
  episode?: number
  /** "portrait" (9:16 social, default) or "wide" (16:9 desktop/YouTube). */
  aspect?: "portrait" | "wide"
  style?: string
  layout?: string
  /** Header date label; defaults to today (Mon D). */
  headerDate?: string
  /** Let the BACKGROUND run past the episode's window.
   *
   *  An episode's backdrop is normally confined to that episode's footage, but
   *  a 30s window under a ~180s timeline has to repeat six times, and the
   *  repetition is noticeable. This starts the backdrop at the episode's start
   *  and lets it keep playing forward through whatever film remains, so most
   *  of the reflection still sits under this episode's own scene and the
   *  repeats drop to one or none. The clip card is unaffected — it always
   *  shows only the episode. */
  bgExtendPastEpisode?: boolean
  /** Shift every caption later by this many seconds (negative = earlier).
   *
   *  The film's SRT can lead its own audio. Our trim is frame-accurate — 30.000s
   *  measured for a 30s ask — and the mapping was verified cue by cue, so a
   *  residual lead belongs to the track, not to the arithmetic. Sync can only be
   *  judged by ear, so it is a knob rather than a computed value. */
  captionOffsetSec?: number
  /** Text in the cover's date slot. Defaults to "Today's Devotional". */
  coverDateLabel?: string
  /** Title animates first, logo follows ~2s in. Off by default: it changes the
   *  opening seconds, and the established devotional opens with the mark. */
  coverTitleFirst?: boolean
  /** Leave today's fixed-date occasion unspoken and off the cover. */
  suppressOccasion?: boolean
  /** Render ONLY the cover card — the opening seconds, animation and all. */
  coverOnly?: boolean
  /** Use this mp3 as the music bed instead of the library or the generator. */
  musicFile?: string
  /** Replace the rotated settle line on the cover for this run. */
  settleLine?: string
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
  /** Playback speed for the video card's clip (pitch-preserved). Default 1.12;
   *  clamped to 1–1.3 because past that the dubbed dialogue reads as hurried. */
  videoSpeed?: number
  /** Open the video card SILENT for this many seconds, showing the "Let's
   *  watch" line, before the clip's audio eases in. The window is pulled the
   *  same amount EARLIER in the film so the silent opening is extra footage
   *  rather than the first seconds of the scene playing unheard. */
  mutedLeadSec?: number
  /** Show the cover's spoken settle line on screen under the hook. */
  showSettleLine?: boolean
  /** Typeface for the spoken-text cards: "sans" (Inter, default) or "serif". */
  textFont?: "sans" | "serif"
  /** CSS filter applied to the video card's footage. The `grain` style grades
   *  nothing, which left the film reading bright and yellow (owner) — pass a
   *  muted grade here to bring it back without switching to an orange
   *  split-tone style. */
  videoFilter?: string
  /** Stop right after the manifest and staged clip/background files are
   *  written, before the Remotion MP4 encode — the expensive step. Leaves the
   *  stage directory intact (normally deleted in a `finally`) so a caller can
   *  build a fast still-frame preview or just play the trimmed clip directly,
   *  instead of waiting on a full render to see the same thing. */
  stopBeforeRender?: boolean
  /** Review preview: render N evenly spaced PNG stills INSTEAD of the MP4.
   *  Costs one frame of rasterization each — seconds, not minutes — which is
   *  what makes "show me screenshots before you render the whole thing" a
   *  reasonable request to make on every layout change. */
  stills?: number
  /** Same, at exactly these frame numbers (comma-separated). Use when the card
   *  boundaries are known and an even split would land mid-crossfade. */
  stillsFrames?: string
  /** Render only a SLICE of the timeline as a real MP4, "start-end" in frames.
   *  Stills cannot show motion, and the opening beats — the logo stamp, the
   *  stepper's travelling light, a verse unfolding under the voice — are all
   *  motion. A twelfth of the encode answers the same question. */
  frameRange?: string
  /** Grain tile size in px (default 260). See `grainSizePx` in the composition
   *  schema for why the tile size, not opacity, is the lever. */
  grainSizePx?: number
  /** Tint + blend for the grain noise. */
  grainFilter?: string
  grainBlend?: string
  /** Multiplier on every card's background blur (default 1). */
  blurScale?: number
  /**
   * Put the spoken lead-ins on their own STEPPER cards (READ / WATCH /
   * REFLECT / PRAY) instead of inline on the host cards, and render that
   * screen between the stages. Off keeps the previous running order exactly.
   */
  steps?: boolean
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
  let keepStage = false
  try {
    const result = await renderInStage(devo, audio, options, {
      stage,
      style,
      layout,
      headerDate,
      locale,
      log,
    })
    // Deliberately skip cleanup only on this successful, intentional
    // early-exit — the caller asked to stop before the encode specifically to
    // use what's in `stage`, and owns removing it when done. A thrown error
    // still falls through to the cleanup below.
    keepStage = options.stopBeforeRender === true
    return result
  } finally {
    if (!keepStage) {
      // Always remove the temp tree (full film download + trimmed clips +
      // audio): the video-first flow renders TWICE per run, so a leak fills
      // /tmp fast.
      await rm(stage, { recursive: true, force: true }).catch(() => {})
    }
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
  log(
    `source ${clipInfo.downloadUrl.split("/").pop()} for ${devo.clip.id} ` +
      `(Arclight's own "high" is 720p; a 1080p Mux rendition is used when published)`,
  )
  await download(clipInfo.downloadUrl, full)
  const fullDur = await probeDuration(full)
  // Every JESUS-film chapter ends with ~8s of QR code + titles — never show it.
  const TRAILER = 8
  const usableDur = Math.max(1, fullDur - TRAILER)
  /**
   * Extra footage past the card's on-screen time so the picture keeps moving
   * through the dissolve into the next card instead of freezing on its last
   * frame.
   *
   * DERIVED, not a constant. It used to be a flat 3s, which was fine until the
   * card was allowed to end 1.5s after the last spoken line (the fix for "the
   * film's closing words are inaudible"). That change spent the whole 3s on the
   * tail pad and left the crossfade nothing to play, so the Good Samaritan's
   * last frame held for over a second — the exact freeze the margin exists to
   * prevent, reintroduced by the fix for the neighbouring bug.
   *
   * So the margin now covers BOTH: the tail pad, the seam, and a little slack.
   * On-screen seconds cost `× VIDEO_SPEED` of source.
   */
  const SEAM_SEC = options.xfadeSec ?? 1.2
  const TAIL_PAD_SEC = 1.5
  // The JESUS film is old and slow; play the video-card clip a touch faster so
  // it's less draggy. Pitch-preserved (atempo), so ~1.12× is imperceptible in
  // the dialogue. The on-screen duration shrinks by the same factor.
  // Overridable per render: how draggy a scene feels is a judgement about THAT
  // scene, and 1.12 is only the default that suited the ones tuned so far.
  // Clamped to what atempo keeps natural — past ~1.3 the dialogue starts to
  // sound hurried even with pitch preserved.
  const VIDEO_SPEED = Math.min(1.3, Math.max(1, options.videoSpeed ?? 1.12))
  const window = passageForChapter(devo.clip.index, options.episode)
  // Owner rule: the "clear" video card (before it cuts to blurred-background
  // text cards) must stay in this range — long enough to feel like a real
  // scene, never so long it drags. Without a cap this was set to the FULL
  // trimmed clip length (~60-70s+ for some chapters), not a highlight window.
  // Only ever pads a SHORT card UP; the available-footage clamp below still has
  // the final say, so this can never outrun the clip. Lowered from 30 once the
  // parable series brought in scenes that are simply short — the Parable of the
  // Lamp is 28s of dialogue end to end. At 30 such a card was padded two
  // seconds past its own last line and into the NEXT scene's footage; at 24 it
  // ends on its own words. Owner rule for these: don't speed them up either.
  const MIN_VIDEO_CARD_SEC = 24
  // Per-chapter override: a scene whose dialogue runs longer than the default
  // ceiling would otherwise have its closing lines fall outside the card
  // entirely (ch14's runs 74s), which reads as the film being cut off.
  const MAX_VIDEO_CARD_SEC = window?.maxVideoCardSec ?? 60
  // A silent lead is EXTRA time in front of the scene, so it raises the ceiling
  // rather than eating into the footage the card was allowed to show.
  const leadSecForCap = Math.max(0, Math.min(4, options.mutedLeadSec ?? 0))
  /** Same value, named for the manifest hand-off further down. */
  const mutedLeadForManifest = leadSecForCap
  const clampVideoCardSec = (sec: number) =>
    Math.min(
      MAX_VIDEO_CARD_SEC + leadSecForCap,
      Math.max(MIN_VIDEO_CARD_SEC, sec),
    )
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
    // Every path out of here used to be silent. When the fetch or the alignment
    // failed the clip simply rendered without captions and nothing said so —
    // which is how an episode shipped with the subtitles missing and no trace
    // in the log to explain it.
    if (!clipInfo.subtitleUrl) {
      log(
        `⚠️  no subtitle track for ${devo.clip.id} in ${locale.lang}; the clip will have NO captions`,
      )
    }
    if (clipInfo.subtitleUrl) {
      const edited = await fetchEditedWindow(
        clipInfo.subtitleUrl,
        winStart,
        winLen,
        {},
        {
          ...(window.minGapSec != null ? { minGapSec: window.minGapSec } : {}),
          ...(window.maxGapSec != null ? { maxGapSec: window.maxGapSec } : {}),
          ...(window.leadingBufferSec != null
            ? { leadingBufferSec: window.leadingBufferSec }
            : {}),
        },
      )
      if (edited) {
        winStart = edited.startSec
        winLen = edited.lengthSec
        clipSegments = edited.segments
        sourceCues = edited.cues
        if (!edited.snapped) {
          log(
            `⚠️  window ${winStart.toFixed(0)}s +${winLen.toFixed(0)}s could not snap to ` +
              `sentence boundaries (the beat's dialogue is shorter than the ` +
              `window); keeping the seeded edges. Captions are unaffected.`,
          )
        }
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
    // SILENT LEAD: pull the window EARLIER by the lead so the muted opening is
    // extra footage, not the first seconds of the scene playing unheard. The
    // lead is on-screen time, so it costs `lead × speed` of source.
    const mutedLead = Math.max(0, Math.min(4, options.mutedLeadSec ?? 0))
    const withLead =
      mutedLead > 0 && clipSegments.length > 0
        ? (() => {
            const [first, ...rest] = clipSegments
            const room = Math.min(mutedLead * VIDEO_SPEED, first.startSec)
            return [
              {
                startSec: first.startSec - room,
                lengthSec: first.lengthSec + room,
              },
              ...rest,
            ]
          })()
        : clipSegments
    const clamped = withLead
      .map((s) => {
        const startSec = Math.min(s.startSec, usableDur - 1)
        const lengthSec = Math.min(s.lengthSec, usableDur - startSec)
        return { startSec, lengthSec }
      })
      .filter((s) => s.lengthSec > 0.1)
    const onScreenSec = clamped.reduce((sum, s) => sum + s.lengthSec, 0)
    const last = clamped[clamped.length - 1]
    // Footage past the window's end, for the tail pad and the dissolve to play
    // over. Generous on purpose: unused margin costs only a slightly longer
    // clip.mp4, while too little margin freezes the last frame. It can be
    // generous ONLY because the card's length is chosen from the WINDOW's own
    // lines (see `lineLimit`), so extra margin can no longer drag the card into
    // dialogue the curated window deliberately left out.
    const marginWanted = (TAIL_PAD_SEC + SEAM_SEC + 2) * VIDEO_SPEED
    const marginAvailable = Math.max(
      0,
      Math.min(marginWanted, usableDur - (last.startSec + last.lengthSec)),
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
    const wantsActs =
      window.splitActs === true && devo.reflection.parts?.length === 2
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
        const act1Sec =
          act1Segments.reduce((s, x) => s + x.lengthSec, 0) / VIDEO_SPEED
        const act2Sec =
          act2Segments.reduce((s, x) => s + x.lengthSec, 0) / VIDEO_SPEED
        videoCardSec = clampVideoCardSec(act1Sec)
        if (sourceCues.length > 0) {
          videoCaptions = mapCuesToEditedTimeline(
            sourceCues,
            act1Segments,
            VIDEO_SPEED,
          )
          act2Captions = mapCuesToEditedTimeline(
            sourceCues,
            act2Segments,
            VIDEO_SPEED,
          )
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
      // The card can never be longer than the footage it shows. Clamping UP to
      // MIN_VIDEO_CARD_SEC held the clip's last frame for the difference —
      // 30s of card against 26.8s of sped-up footage froze for three seconds
      // before the reflection took over.
      const playableSec = onScreenSec / VIDEO_SPEED
      // Captions must follow the SAME edit as the picture: cut-out pauses shift
      // later lines earlier, and the speed-up compresses every timestamp. Map
      // against `trimSegments` (exactly what was encoded into clip.mp4).
      // Mapped BEFORE the card length is chosen, because the last line that
      // finishes inside the cap is what decides where the card may end.
      if (sourceCues.length > 0) {
        videoCaptions = shiftCaptions(
          mapCuesToEditedTimeline(sourceCues, trimSegments, VIDEO_SPEED),
          options.captionOffsetSec ?? 0,
        )
        log(
          `captions: ${videoCaptions.length} cue(s) mapped onto the edited clip`,
        )
      }
      // END AFTER A FINISHED LINE, WITH ROOM FOR THE FADE. The cap (60s + any
      // silent lead) exists so the clip never drags, but applied as a raw
      // number it cut the card mid-sentence: a 74s clip was shown for 62.5s and
      // the film's last words were never heard.
      //
      // Ending exactly ON the last line was the SECOND half of that bug (owner
      // reported it a third time: "Go in peace" inaudible). The card carries a
      // 0.5s audio fade-out and dissolves into the reflection over the xfade,
      // so a card that ends when the dialogue ends fades out ON the closing
      // words. TAIL_PAD_SEC buys silence for the fade to land on — spent from
      // the trailing MARGIN footage, which is uncut and already encoded, so
      // this cannot run past the end of clip.mp4.
      const playableWithMarginSec =
        (onScreenSec + marginAvailable) / VIDEO_SPEED
      // The card must END far enough from the last frame for the dissolve to
      // have moving picture to play. Ending AT the footage's end is what froze
      // the Good Samaritan's final frame for over a second.
      const seamCeilingSec = playableWithMarginSec - SEAM_SEC - 0.2
      const cap = clampVideoCardSec(playableSec)
      // Which lines is the card allowed to wait for?
      //
      // The CURATED WINDOW's lines, and no others. This used to allow anything
      // inside `playableWithMarginSec`, which quietly included the trailing
      // margin — so for the Good Samaritan the "last line" the card waited for
      // was a line from the margin, past the window's chosen ending, and
      // holding for it ate the very footage the dissolve needed. The window
      // decides the content; the margin only feeds the seam.
      //
      // The 0.4s of slack absorbs a subtitle cue that ends just past the window
      // edge, since cues do not land exactly on it: dropping a real closing
      // line over a fractional overrun is how "Go in peace" went missing.
      const lineLimit = Math.min(cap, playableSec) + 0.4
      const lineEnd = videoCaptions
        .filter((c) => c.endSec <= lineLimit)
        .reduce((max, c) => Math.max(max, c.endSec), 0)
      // MIN_VIDEO_CARD_SEC still applies (a short scene is held so it reads as
      // a scene), and the footage available is still the hard ceiling — that is
      // what stops the picture freezing on the last frame.
      const wanted =
        lineEnd > 0 ? Math.max(lineEnd + TAIL_PAD_SEC, MIN_VIDEO_CARD_SEC) : cap
      videoCardSec = Math.min(wanted, seamCeilingSec)
      log(
        `video card ${videoCardSec.toFixed(1)}s (last line ends ${lineEnd.toFixed(1)}s, ` +
          `cap ${cap.toFixed(1)}s, ${playableWithMarginSec.toFixed(1)}s of footage, ` +
          `seam ceiling ${seamCeilingSec.toFixed(1)}s)`,
      )
      // The two bugs this balances pull in opposite directions, so say when the
      // seam won and the last line had to be given up — otherwise a future
      // "the last words are cut off" report has nothing to read.
      if (lineEnd > 0 && wanted > seamCeilingSec) {
        log(
          `⚠️  the scene's last line (${lineEnd.toFixed(1)}s) does not fit before ` +
            `the ${SEAM_SEC.toFixed(1)}s dissolve; widen clipLengthSec for this ` +
            `chapter if the closing words matter`,
        )
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
      ...(s.audio.words && s.audio.words.length > 0
        ? { words: s.audio.words }
        : {}),
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
    // Suppressed for social cuts. This is the SECOND place the occasion enters
    // — the narration reads it from its own call — and silencing only the voice
    // left "WORLD HUMANITARIAN DAY" sitting on the cover.
    occasion: options.suppressOccasion
      ? undefined
      : (occasionFor(devo.date, locale.lang) ?? undefined),
    videoCaptions,
    ...(options.showSettleLine
      ? {
          settleLine: settleLineFor(devo.sequence, options.settleLine ?? null),
        }
      : {}),
    ...(mutedLeadForManifest > 0
      ? {
          // The silent opening stays (the clip's own sound eases in), but the
          // caption does NOT ride the film any more: "Let's watch" now lands on
          // the scripture card, zooming in as the voice says it, and repeating
          // it over the first seconds of the clip read as a duplicate.
          mutedLeadSec: mutedLeadForManifest,
        }
      : {}),
    ...(act2Info ? { act2: { ...act2Info, captions: act2Captions } } : {}),
  })

  // COVER ONLY: keep the opening card and drop the rest. Used when the cover
  // itself needs re-cutting — a new date label, say — and the devotional it
  // belongs to is already finished and liked. Rendering the whole thing again
  // would re-synthesise every line and hand back a video that differs from the
  // one being kept.
  if (options.coverOnly) {
    manifest.cards = manifest.cards.filter((c) => c.kind === "cover")
    if (manifest.cards.length === 0) {
      throw new Error("cover-only render: this devotional has no cover card")
    }
  }

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
  // The background may only ever show THIS episode's footage.
  //
  // Three rules meet here and the first version of this got all three wrong:
  //   - an episode's backdrop must not reach into the next episode's story
  //     (the viewer watched Zacchaeus give his money away while the voice was
  //     still describing him up the tree),
  //   - it must not run past `usableDur`, which already withholds the film's
  //     last TRAILER seconds,
  //   - and it must not run past the end of the file at all: offsetting the
  //     start without shrinking the length asked ffmpeg for 39s→173s of a 142s
  //     clip, which is how both of the above happened at once.
  // A short source is fine — the composition loops at `bgDurationSec`.
  const bgStart = options.episode ? (window?.clipStartSec ?? 0) : 0
  const bgAvailable = Math.max(1, usableDur - bgStart)
  const bgWindowLen =
    options.episode && !options.bgExtendPastEpisode
      ? Math.min(window?.clipLengthSec ?? bgAvailable, bgAvailable)
      : bgAvailable
  const bgLen = Math.min(bgTimelineSec, bgWindowLen)
  manifest.bgFile = "bg.mp4"
  // Pin the held beats the composition adds to the first/last card, so its
  // layout can't drift from the budget computed above.
  manifest.introHoldSec = INTRO_HOLD_SEC
  manifest.outroHoldSec = OUTRO_HOLD_SEC
  // If the usable film is SHORTER than the background timeline, slow the ONE
  // continuous clip so it stretches across every card instead of running out
  // (a freeze). Never faster than 1×.
  // Slow a short backdrop as far as the floor allows; the composition loops
  // whatever is still missing. Slowing alone cannot cover an episode-sized
  // window (30s under a ~170s timeline would need 0.18×, well past the floor),
  // so loop and slow together rather than stretching one clip to a crawl.
  // Keep the motion close to life and let the scene begin again instead, which
  // reads better than stretching one pass to a crawl.
  const bgRate =
    bgTimelineSec > bgLen
      ? Math.max(BG_LOOPED_MIN_RATE, Math.min(1, bgLen / bgTimelineSec))
      : 1
  // Where the backdrop should visibly start over: the moment the reflection
  // opens. Video cards are excluded from this timeline (the clip itself is on
  // screen then), so this is the intro hold plus the cards before the first
  // reflection card — cover and scripture.
  // Only meaningful when there IS a reflection to restart on. A cover-only
  // render has none, and the accumulator then ran past every card and put the
  // seam inside the cover itself — two black frames at 7.3s, which read as the
  // picture glitching.
  // ...and ONLY for an episode. The restart exists because an episode's
  // backdrop may only show that episode's few seconds of film, so it has to
  // begin again and the honest place for the seam is a deliberate beat. A full
  // devotional has the whole scene: the owner asked for the earlier look, where
  // the backdrop reads as one continuous take carrying on behind the voice, so
  // there is no deliberate restart and the seams are dissolved instead.
  const hasReflection =
    Boolean(options.episode) &&
    manifest.cards.some((c) => String(c.kind).startsWith("reflection"))
  let bgRestartAtSec = hasReflection ? INTRO_HOLD_SEC : 0
  if (hasReflection) {
    for (const card of manifest.cards) {
      if (String(card.kind).startsWith("reflection")) break
      if (card.kind === "video") continue
      bgRestartAtSec +=
        (Number(card.durationSec) || 3) +
        (Number(card.holdSec) || 0) +
        CARD_TAIL_SEC
    }
  }
  const bgSegments = planBackgroundSegments({
    startSec: bgStart,
    windowLen: bgLen,
    coverSec: bgTimelineSec,
    speed: bgRate,
    restartAtSec: bgRestartAtSec,
    // Generous: a few seams cost a few seconds, and running long is harmless
    // while running short freezes the picture.
    extraSourceSec: BG_SEAM_XFADE_SEC * 4,
  })
  await buildBackground(
    full,
    path.join(stage, "bg.mp4"),
    bgSegments,
    bgTimelineSec,
    bgRate,
  )
  // bg.mp4 is now built to cover the timeline (slowed AND repeated), so the
  // composition must play it straight — re-applying the rate would stretch it
  // a second time and leave the same hole this loop was added to close.
  manifest.bgPlaybackRate = 1
  manifest.bgDurationSec = bgTimelineSec
  // Non-video cards read the shared top-level bgFile — clear any per-card bg so
  // they all window into the ONE continuous clip.
  for (const card of manifest.cards) {
    if (card.kind !== "video") {
      delete card.bgFile
      delete card.bgDurationSec
    }
  }
  // bg.mp4 is built to the full timeline, so coverage is no longer the slice
  // length over a rate — the repeat count is what closes the gap. Log the
  // repeats so a backdrop that visibly restarts can be traced to a window that
  // was too short, rather than looking like a render glitch.
  const bgCoverageSec = bgTimelineSec
  log(
    `background: ${bgStart.toFixed(0)}s +${bgLen.toFixed(0)}s ×${bgRate.toFixed(2)}, ` +
      `${bgSegments.length} pass(es), ` +
      (bgRestartAtSec > 0
        ? `restarts at ${bgRestartAtSec.toFixed(0)}s (reflection) `
        : `${BG_SEAM_XFADE_SEC}s seam dissolves `) +
      `→ covers ${bgTimelineSec.toFixed(0)}s`,
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

  if (options.stopBeforeRender) {
    // Return the STAGE dir, not a video path — same string-shaped return as
    // always, so callers that never set this option see no change at all.
    log(
      `stopped before render — manifest + staged files left in ${stage} ` +
        `(clip.mp4, bg.mp4, per-segment audio, manifest.json)`,
    )
    return stage
  }

  await mkdir(options.outDir, { recursive: true })
  const aspect = options.aspect ?? "portrait"
  const comp = aspect === "wide" ? "devotional-wide" : "devotional"
  const filename = devotionalVideoFilename({
    clipTitle: devo.clip.title,
    sequence: devo.sequence,
    lang: locale.lang,
    aspect,
    ...(options.episode ? { episode: options.episode } : {}),
  })
  // Stills write PNGs derived from this name and never produce the MP4, so a
  // preview must NOT burn the next free version number — it would leave a gap
  // and name the stills after a video that does not exist.
  const stillsOnly = Boolean(options.stills || options.stillsFrames)
  const videoPath = stillsOnly
    ? path.join(options.outDir, filename)
    : await nextFreePath(options.outDir, filename)
  log(
    stillsOnly
      ? `stills (${aspect}) → ${videoPath.replace(/\.mp4$/, "")}-still-NN.png`
      : `render (${aspect}) → ${videoPath}`,
  )
  await runRender(
    path.join(stage, "manifest.json"),
    videoPath,
    comp,
    style,
    layout,
    options.musicVolume ?? MUSIC_VOLUME_DEFAULT,
    options.xfadeSec ?? 1.2,
    options.videoAudioLevel ?? 0.55,
    {
      // Owner rules for the devotional cover: never a date, and nothing in
      // the date's slot either — the "Today's Devotional" label that used to
      // fill it wiped open after the mark had already settled, which is the
      // beat she asked to end the opening on. Logo, title, credit, nothing
      // else. An explicit label still overrides.
      ...(options.coverDateLabel
        ? { coverDateLabel: options.coverDateLabel }
        : { hideCoverDate: true }),
      coverTitleFirst: options.coverTitleFirst ?? false,
      ...(options.textFont ? { textFont: options.textFont } : {}),
      ...(options.videoFilter ? { videoFilter: options.videoFilter } : {}),
      ...(options.stills ? { stills: options.stills } : {}),
      ...(options.stillsFrames ? { stillsFrames: options.stillsFrames } : {}),
      ...(options.frameRange ? { frameRange: options.frameRange } : {}),
      ...(options.grainSizePx ? { grainSizePx: options.grainSizePx } : {}),
      ...(options.grainFilter ? { grainFilter: options.grainFilter } : {}),
      ...(options.grainBlend ? { grainBlend: options.grainBlend } : {}),
      ...(options.blurScale ? { blurScale: options.blurScale } : {}),
    },
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
  /** Stop after the text is written, reviewed by the critics and cached —
   *  before a single character is sent to TTS. The whole devotional is printed
   *  so a person can read it, and the cached devo.json can be hand-edited or
   *  the prompts changed and the text regenerated, all at LLM prices. Resume by
   *  re-running without this flag: the cached text is reused and only the audio
   *  and video are produced. */
  reviewOnly?: boolean
  /** Record that a person has read THIS wording, and continue to audio. The
   *  approval is bound to the text's fingerprint, so a later edit or
   *  regeneration invalidates it and the gate closes again. */
  approveText?: boolean
  /** Read the scene with this commentator for THIS run, ignoring what the
   *  passage table says. For comparing readings before choosing one. */
  commentaryOverride?: "ryle" | "henry"
  /** Target length of the spoken reflection, in words. Defaults to 170, which
   *  runs about 70 seconds. The picker also reads it, to judge whether two
   *  commentary points can honestly fit in the budget. */
  approxWords?: number
  /** Render one beat of a scene that defines `episodes` (1-based) as its own
   *  standalone devotional. Caches under its own dir, so episodes of the same
   *  scene do not overwrite one another. */
  episode?: number
  /** Swap real ElevenLabs narration for timed silence (see
   *  `createSilentVoiceover`) and skip both the human-approval gate and the
   *  LLM quality critics — they're non-deterministic and shouldn't block a
   *  design-only preview. Renders the REAL pipeline (clip alignment, gap
   *  removal, speed, background, cover) with zero TTS spend, to check layout
   *  and card splitting before paying for a voice. */
  silentPreview?: boolean
  /** Words/sec used to size the silent voiceover's duration estimate. See
   *  `createSilentVoiceover`'s doc comment for where the default was measured. */
  silentPreviewWordsPerSec?: number
  /** Request ElevenLabs' per-word alignment for every narration segment, so
   *  each card reveals its text word by word exactly in step with the voice
   *  instead of at a guessed pace. Cards whose audio gets re-timed after
   *  synthesis keep the old reveal. */
  wordTimings?: boolean
}

export type RenderedDevotional = {
  devotional: GeneratedDevotional
  /** null when `reviewOnly` stopped the run before any audio or video work. */
  videoPath: string | null
  /** Set only when `stopBeforeRender` stopped the run after staging, before
   *  the Remotion encode — the directory holding clip.mp4, bg.mp4, per-segment
   *  audio and manifest.json. */
  previewStageDir?: string
}

/**
 * Refuse to render a devotional whose narration is incomplete.
 *
 * Narration failures were once invisible: produceDevotionalAudio collects
 * failed segment ids in `skipped` and returns them, but only the standalone
 * devo-audio-track script ever read it. When EVERY TTS call failed, the render
 * carried on, produced a clip-only video with no text and no voice, and cached
 * that empty audio as if it were valid. A later run lost 15 of 21 segments —
 * including the conclusion and the whole question/prayer card — and still
 * shipped a 110s video that simply skipped its own ending.
 *
 * Runs on BOTH the freshly-produced and the cache-loaded path. Checking only
 * fresh audio left the worse hole open: an incomplete run that reached the
 * cache would pass unexamined on every subsequent render, forever.
 */
export function assertNarrationComplete(audio: ProducedDevotionalAudio): void {
  const missing = new Set(audio.skipped)
  const structural = ["cover", "scripture", "conclusion", "questions"].filter(
    (id) => missing.has(id),
  )
  const reflectionMissing = audio.skipped.filter((id) =>
    /^reflection-\d+$/.test(id),
  ).length
  // ANY lost reflection sentence is fatal. The earlier test compared losses
  // against SURVIVORS (`reflectionMissing > reflectionProduced`), so losing 5 of
  // 10 sentences gave `5 > 5` — false — and shipped a devotional missing half
  // its reflection behind a console warning. A skipped segment still renders its
  // text card, so the viewer reads a sentence no voice speaks; and with retries
  // upstream, reaching here means several attempts already failed.
  if (
    audio.segments.length === 0 ||
    structural.length > 0 ||
    reflectionMissing > 0
  ) {
    // Name the actual CAUSE per segment. The message used to end with a flat
    // "usually a rate limit or quota — retry, or check the key", which is wrong
    // guidance for the two causes that need a different action: a cache written
    // by an incomplete earlier run (regenerate the audio, retrying changes
    // nothing) and an exhausted quota (top up; retrying burns what is left).
    const causes = audio.failures.length
      ? audio.failures.map((f) => `${f.id}: ${f.reason}`).join(", ")
      : "(no reasons recorded)"
    const quota = audio.failures.some((f) => f.reason === "quota_exceeded")
    const stale = audio.failures.some((f) => f.reason === "cached_incomplete")
    throw new Error(
      `narration is incomplete — refusing to render a devotional that would ` +
        `be missing content. ` +
        (structural.length
          ? `Missing whole cards: ${structural.join(", ")}. `
          : "") +
        (reflectionMissing
          ? `Missing ${reflectionMissing} reflection chunk(s). `
          : "") +
        `Causes — ${causes}. ` +
        (quota
          ? `The ElevenLabs quota is exhausted: top it up, retrying cannot succeed.`
          : stale
            ? `This came from a CACHED incomplete run: re-run with --regenerate-audio ` +
              `(retrying as-is will read the same cache and fail identically).`
            : `Usually an ElevenLabs rate limit — retry, or check the key.`),
    )
  }
}

/**
 * THE one way to obtain a devotional's narration. Every caller must come
 * through here — the CLI scripts and the Mastra workflow alike.
 *
 * It exists because the two paths had silently diverged. The workflow called
 * `produceDevotionalAudio(devotional)` with NO deps at all, which meant it got
 * no per-segment reuse (so one edited sentence re-voiced everything and drained
 * the quota), no real-silence pauses between sentences, no slowed scripture or
 * closing card — measurably worse audio — and then wrote that straight to the
 * shared cache with no completeness check. The CLI path, meanwhile, had all
 * four. Keeping the deps in one function is what makes that divergence
 * unrepresentable rather than merely fixed.
 *
 * On a cache hit that turns out to be INCOMPLETE, this falls through to
 * production instead of throwing. Throwing there was a dead end: the render
 * would fail identically on every future run until a human passed
 * --regenerate-audio, and the incomplete cache could be written by any of three
 * other callers. Falling through self-heals, and per-segment reuse means it pays
 * only for the segments that are actually missing.
 */
export async function produceNarration(
  devo: GeneratedDevotional,
  locale: DevotionalLocale,
  opts: {
    cacheDir: string
    reuse: boolean
    log?: (msg: string) => void
    suppressOccasion?: boolean
    musicFile?: string
    settleLine?: string
    /**
     * Write the produced segments into the persistent audio cache. Default
     * true; pass FALSE for anything synthetic.
     *
     * A silent preview used to persist its own silence here, and because the
     * reuse key is (role, text, voice) — all three identical to the real thing
     * — the very next run reported "reused 16 cached segment(s)" and staged a
     * devotional with no narration at all. Nothing in the logs said otherwise;
     * the only symptom was -91 dB. Whatever produced the audio, if it is not
     * the real voice it must not enter the cache the real render reads.
     */
    persist?: boolean
    /** Drop-in replacement for the real ElevenLabs call — see
     *  `createSilentVoiceover` for the silent-preview use case. */
    voiceover?: NonNullable<
      Parameters<typeof produceDevotionalAudio>[1]
    >["voiceover"]
    /** Ask for ElevenLabs' per-word alignment so cards can reveal their text
     *  in step with the voice. */
    withTimestamps?: boolean
    /** Emit step segments (the stepper screen's own narration). */
    steps?: boolean
  },
): Promise<ProducedDevotionalAudio> {
  const log = opts.log ?? (() => {})
  const { cacheDir } = opts

  if (opts.reuse) {
    const cached = await loadCachedAudio(cacheDir, devo.voice)
    if (cached) {
      // THE TEXT MUST MATCH, not merely be present.
      //
      // This whole-bundle shortcut used to check only that every segment
      // EXISTED. So after an approved edit to the conclusion, the cards showed
      // the new line while the voice kept reading the old one — the render was
      // "complete", nothing warned, and the mismatch was only visible by
      // opening the cache by hand. The same trap swallowed the change to the
      // spoken connector ("Let's bring this to God"): any devotional with a
      // full cache would never have said it.
      //
      // The per-segment path below is already keyed on text, so a mismatch just
      // falls through to it and re-synthesises the segments that actually
      // changed.
      const wanted = buildNarrationSegments(devo, locale, {
        suppressOccasion: opts.suppressOccasion ?? false,
        ...(opts.settleLine ? { settleLine: opts.settleLine } : {}),
        ...(opts.steps ? { steps: true } : {}),
      })
      // Compare what the voice SAYS, not what the card shows.
      //
      // This used to compare the display text, which a reflection card keeps
      // identical whether or not its spoken connector is there — so moving
      // "Reflect on this." onto its own step card looked like no change at
      // all, and the cached reflection kept saying it. Segments cached before
      // the spoken text was recorded compare as changed, which is the honest
      // reading: what they say is unknown.
      const cachedSpoken = new Map(cached.segments.map((s) => [s.id, s.spoken]))
      const changed = wanted.filter(
        (w) => (cachedSpoken.get(w.id) ?? "").trim() !== w.text.trim(),
      )
      if (changed.length > 0) {
        log(
          `📝 text changed since the cached narration (${changed
            .map((c) => c.id)
            .join(", ")}) — re-producing those segments`,
        )
      } else {
        try {
          assertNarrationComplete(cached)
          log("reusing cached audio")
          return cached
        } catch {
          log(
            "⚠️  cached audio is INCOMPLETE — re-producing the missing segments " +
              "(the complete ones are reused, so only the gaps cost credits)",
          )
        }
      }
    }
  }

  // Reuse any cached narration whose words are IDENTICAL, so a text edit only
  // costs TTS credits for the sentences that actually changed. The whole-
  // devotional cache is all-or-nothing, which is how one edited sentence
  // previously re-voiced all ~21 segments and drained the quota.
  const reusable = await loadReusableAudio(cacheDir, devo.voice)
  log(
    reusable.size > 0
      ? `produce audio… (${reusable.size} cached segment(s) available for reuse)`
      : "produce audio…",
  )
  const audio = await produceDevotionalAudio(
    devo,
    {
      suppressOccasion: opts.suppressOccasion ?? false,
      ...(opts.musicFile ? { musicFile: opts.musicFile } : {}),
      ...(opts.settleLine ? { settleLine: opts.settleLine } : {}),
      reusable,
      // Numbers are spelled deterministically in the connectors. Stress marks:
      // ONLY the owner-curated overrides (spoken only). ElevenLabs' Russian
      // voice stresses most words correctly on its own; marking EVERY word
      // (dictionary blanket) degrades its delivery — mis-stress despite the
      // mark, odd phonetics, lost terminal intonation. So mark selectively. The
      // dictionary (ru-stress-dict) is the TOOL to get the correct mark for a
      // word we add to the overrides, not a blanket pass.
      speakify: (t) =>
        Promise.resolve(applyStressOverrides(t, locale.stressOverrides ?? [])),
      // Real-silence pauses at the connectors' paragraph breaks (cover date |
      // lead-in | hook; before "Давайте посмотрим"; question | prayer). Short
      // between sentences, longer between sections.
      joinVarGaps: joinAudioVarGaps,
      // Pace certain cards (scripture + last reflection slower; closing slower
      // + padded so it doesn't end abruptly).
      pace: slowAndPad,
      ...(opts.voiceover ? { voiceover: opts.voiceover } : {}),
      ...(opts.withTimestamps ? { withTimestamps: true } : {}),
      ...(opts.steps ? { steps: true } : {}),
    },
    locale,
  )
  if (audio.reused.length > 0) {
    log(
      `♻️  reused ${audio.reused.length} cached segment(s); synthesised ${audio.segments.length - audio.reused.length}`,
    )
  }
  // Guard BEFORE persisting: an incomplete result must not reach the cache,
  // where three other callers would later read it back as usable.
  assertNarrationComplete(audio)
  if (opts.persist !== false) await saveCachedAudio(cacheDir, audio)
  return audio
}

/**
 * Render the devotional as a person will actually HEAR it, for the review stop.
 *
 * Built from `buildNarrationSegments` — the same function the TTS step calls —
 * so what is read here is character-for-character what would be synthesized,
 * connectors included. A pretty-printed devo.json would show the raw fields and
 * hide exactly the seams ("Here's today's scripture", "Let's watch") that make
 * a devotional sound stitched together or natural.
 */
export function printDevotionalForReview(
  devo: GeneratedDevotional,
  locale: DevotionalLocale,
  cacheDir: string,
  opts: { suppressOccasion?: boolean; steps?: boolean } = {},
): string {
  const spoken = buildNarrationSegments(devo, locale, {
    suppressOccasion: opts.suppressOccasion ?? false,
    ...(opts.steps ? { steps: true } : {}),
  })
  const rule = "─".repeat(72)
  const lines = [
    "",
    rule,
    `REVIEW — nothing has been sent to TTS yet`,
    rule,
    `voice ${devo.voice} · mood ${devo.mood} · ${devo.scripture.reference} · ${devo.date}`,
    `source: ${devo.reflection.attribution}`,
    "",
    "SPOKEN, in order (connectors included):",
    "",
  ]
  for (const seg of spoken) {
    lines.push(`  [${seg.id}]`)
    for (const para of seg.text.split("\n").filter((p) => p.trim())) {
      lines.push(`  ${para.trim()}`)
    }
    lines.push("")
  }
  const highlights = (devo.reflectionHighlights ?? []).filter(Boolean)
  if (highlights.length) {
    lines.push(`ON SCREEN, accented: ${highlights.join(" / ")}`, "")
  }
  lines.push(
    rule,
    `To change the WORDING: edit ${path.join(cacheDir, "devo.json")}`,
    `To change the RULES:   edit the agent prompts, then re-run with --regenerate`,
    `To continue as is:     re-run the same command without --review`,
    rule,
    "",
  )
  return lines.join("\n")
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
  const enDir = cacheDirFor(
    input.chapterIndex,
    input.sequence,
    "en",
    input.episode,
  )
  let devo = input.regenerate ? null : await loadCachedDevo(enDir)
  if (devo) {
    log("reusing cached devotional text")
    // The cache key is (chapter, sequence) with NO date in it, so yesterday's
    // cached text is a hit today — and `devo.date` is what the cover card both
    // displays and narrates. Without this the daily job silently shipped a
    // video captioned with the date of whenever the text was first generated.
    if (input.date && devo.date !== input.date) {
      log(`  ↳ restamping cached text ${devo.date} → ${input.date}`)
      devo = { ...devo, date: input.date }
    }
  } else {
    log(
      `generate (ch${input.chapterIndex}, seq${input.sequence}` +
        `${input.episode ? `, episode ${input.episode}` : ""})…`,
    )
    devo = await generateDevotional({
      chapterIndex: input.chapterIndex,
      sequence: input.sequence,
      date: input.date,
      llm: input.llm,
      // Per-agent models: strong for modernizer/copywriter, cheap for the rest.
      llms: buildDevotionalAgentLlms(),
      log,
      ...(input.episode ? { episode: input.episode } : {}),
      ...(input.commentaryOverride
        ? { commentaryOverride: input.commentaryOverride }
        : {}),
      ...(input.approxWords ? { approxWords: input.approxWords } : {}),
    })
    await saveCachedDevo(enDir, devo)
  }

  // Localize the finished English devotional (translate copy + Synodal verse +
  // film-language voice), cached under the -<lang> dir.
  let cacheDir = enDir
  if (lang !== "en") {
    cacheDir = cacheDirFor(
      input.chapterIndex,
      input.sequence,
      lang,
      input.episode,
    )
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
    devo = {
      ...devo,
      voice: input.voiceOverride as GeneratedDevotional["voice"],
    }
  }

  // APPROVAL FIRST. A human reading the text is the real gate; the critics
  // exist so nobody has to read a bad one. Once this exact wording has been
  // approved, re-running them is not a second opinion — it is a lottery, and
  // it lost: text approved yesterday failed coherence today and refused to
  // render. Critics are LLM calls, so their verdict is not stable across runs.
  // Skipping them here also saves three calls on every re-render.
  // The fingerprint follows the SPOKEN text, so moving the lead-ins onto step
  // cards is a change the owner re-approves rather than one that slips through.
  const spoken = buildNarrationSegments(devo, locale, {
    suppressOccasion: input.suppressOccasion ?? false,
    ...(input.steps ? { steps: true } : {}),
  }).map((s) => s.text)
  let approval = await approvalState(cacheDir, spoken)
  if (approval !== "approved" && input.approveText) {
    await writeApproval(cacheDir, textFingerprint(spoken), input.date)
    log("✅ text approved — this wording, and only this wording")
    approval = "approved"
  }

  // QUALITY GATE — runs on the FINAL text, before any audio or video work,
  // and ONLY while no human has signed off on this wording.
  // The critics only ever read text, so running them here instead of after the
  // render means a bad devotional costs three cheap LLM calls rather than a
  // full ElevenLabs narration plus a multi-minute Remotion render.
  // silentPreview bypasses both this gate and the human-approval gate below —
  // this run is design-only (no TTS spend), and the critics are LLM calls
  // that shouldn't block a preview on their own non-determinism.
  const review =
    approval === "approved" || input.silentPreview
      ? { blocking: [] as string[] }
      : await reviewDevotionalText({
          devotional: devo,
          // Fidelity compares against the English modernization step, so it is
          // meaningless once `devo` is a translation — skip it for localized
          // runs rather than compare an English excerpt to Russian prose.
          checkFidelity: lang === "en",
          lang: lang === "ru" ? "ru" : "en",
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

  // HUMAN GATE — the critics have passed, the text is cached, and nothing has
  // been paid for beyond the LLM calls. Stopping here makes a rewrite cost a
  // few cents instead of a full narration: change a prompt or hand-edit
  // `<cacheDir>/devo.json`, then re-run to continue from the cached text.
  //
  // It is a GATE, not a flag: the run stops here unless this exact wording has
  // been approved. `--review` opts IN to reading it; nothing opts out of having
  // read it, because the only way past is an approval bound to the text's own
  // fingerprint. Forgetting a flag then costs nothing instead of a narration.
  if (!input.silentPreview && (input.reviewOnly || approval !== "approved")) {
    log(
      printDevotionalForReview(devo, locale, cacheDir, {
        suppressOccasion: input.suppressOccasion ?? false,
      }),
    )
    if (approval !== "approved") {
      log(`⛔ ${approvalMessage(approval)}`)
      log(
        "   Read it above. If it is right, re-run with --approve to continue.",
      )
    }
    return { devotional: devo, videoPath: null }
  }

  // A voice override always regenerates audio (cached audio is a different voice).
  const reuseAudio =
    !input.regenerate &&
    !input.regenerateAudio &&
    !input.voiceOverride &&
    !input.silentPreview
  const audio = await produceNarration(devo, locale, {
    cacheDir,
    suppressOccasion: input.suppressOccasion ?? false,
    ...(input.musicFile ? { musicFile: input.musicFile } : {}),
    ...(input.settleLine ? { settleLine: input.settleLine } : {}),
    reuse: reuseAudio,
    ...(input.steps ? { steps: true } : {}),
    // Silence is never cacheable: see `persist` on produceNarration.
    persist: !input.silentPreview,
    ...(input.silentPreview
      ? {
          voiceover: createSilentVoiceover(
            input.silentPreviewWordsPerSec ?? 2.51,
          ),
        }
      : {}),
    // Silent previews have no real speech to align to, so never ask for
    // timestamps there.
    ...(input.wordTimings && !input.silentPreview
      ? { withTimestamps: true }
      : {}),
    log,
  })

  const result = await renderDevotionalVideo(devo, audio, {
    ...input,
    locale,
    // A chapter may carry its own grain tint (sunlit scenes need a brighter
    // noise than the dark-interior default). An explicit flag still wins, so
    // the override can be compared against on the command line.
    ...(input.grainFilter
      ? { grainFilter: input.grainFilter }
      : passageForChapter(devo.clip.index, input.episode)?.grainFilter
        ? {
            grainFilter: passageForChapter(devo.clip.index, input.episode)!
              .grainFilter,
          }
        : {}),
  })
  if (input.stopBeforeRender) {
    return { devotional: devo, videoPath: null, previewStageDir: result }
  }
  return { devotional: devo, videoPath: result }
}
