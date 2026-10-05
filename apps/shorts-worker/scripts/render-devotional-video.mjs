#!/usr/bin/env node
/**
 * Local Remotion render for a daily-devotional video (real animated cards +
 * narration + optional background clip). Runs from @forge/shorts-worker because
 * that package has @remotion/bundler + @remotion/renderer installed.
 *
 * Usage (from the repo root):
 *   node apps/shorts-worker/scripts/render-devotional-video.mjs \
 *     --report=devo/artifacts/reports/2026-12-25.json \
 *     --audio=devo/artifacts/audio/2026-12-25.mp3 \
 *     --out=devo/artifacts/video/2026-12-25-remotion.mp4 \
 *     [--bg=/path/to/your-clip.mp4]
 *
 * First run downloads chrome-headless-shell (~150MB) via ensureBrowser().
 */
import { spawn } from "node:child_process"
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { bundle } from "@remotion/bundler"
import {
  ensureBrowser,
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../..")
const ENTRY = path.join(
  REPO_ROOT,
  "packages/shorts-compositions/src/devotional/entry.ts",
)

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

function abs(p) {
  return path.isAbsolute(p) ? p : path.join(REPO_ROOT, p)
}

// Bounded waits so a hung ffprobe/ffmpeg can't stall the render before it even
// reaches renderMedia.
const FFPROBE_TIMEOUT_MS = 30_000
const FFMPEG_TIMEOUT_MS = 180_000

function probeDuration(file) {
  return new Promise((resolve) => {
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
      resolve(null)
    }, FFPROBE_TIMEOUT_MS)
    c.on("error", () => {
      clearTimeout(timer)
      resolve(null)
    })
    c.on("close", () => {
      clearTimeout(timer)
      const v = Number.parseFloat(out.trim() || "")
      resolve(Number.isFinite(v) && v > 0 ? v : null)
    })
  })
}

/** Run ffmpeg with a kill-and-reject watchdog. */
function runFfmpeg(args, label) {
  return new Promise((resolve, reject) => {
    const c = spawn("ffmpeg", args, { stdio: "ignore" })
    const timer = setTimeout(() => {
      c.kill("SIGKILL")
      reject(
        new Error(`ffmpeg ${label} timed out after ${FFMPEG_TIMEOUT_MS}ms`),
      )
    }, FFMPEG_TIMEOUT_MS)
    c.on("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
    c.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg ${label} failed (${code})`))
    })
  })
}

/** How long each seam between two repeats of the bed takes to cross over.
 *  Long enough that the join reads as the music continuing rather than a new
 *  take starting; short enough that it doesn't wash out a whole phrase. */
const MUSIC_SEAM_XFADE_SEC = 2.5

/** Hard ceiling on crossfaded copies. A normal 30-60s bed needs well under ten
 *  to cover a three-minute devotional; anything approaching this means the bed
 *  is not what we think it is, and thousands of ffmpeg inputs is not a failure
 *  mode worth waiting out. */
const MUSIC_MAX_COPIES = 64

/**
 * The music bed must cover the whole devotional. Two steps:
 *
 * 1. STRIP head + trailing silence. Generated tracks (ElevenLabs) carry ~1-3s of
 *    silence at each end; when the bed is looped to fill the runtime, that
 *    silence lands at every seam — and near the end it falls in the narration-
 *    free closing dwell as an audible DEAD GAP (the music seems to stop before
 *    the video ends). Trimming both ends makes the loop seamless.
 * 2. LOOP the trimmed bed up to `needSec` so it never falls silent, joining
 *    every repeat with an `acrossfade` rather than butting them end-to-start.
 *    `-stream_loop` did the latter, and even after the silence trim the seam
 *    was audible as a pause in the music — the owner heard it most clearly in
 *    the closing stretch, where the narration has stopped and the bed is
 *    carrying the card alone. A trimmed track already >= needSec is used
 *    as-is.
 */
async function stageMusicLooped(srcName, manifestDir, publicDir, needSec) {
  if (!srcName) return false
  const src = path.join(manifestDir, srcName)
  const dest = path.join(publicDir, srcName)
  // Re-encode with a codec that matches the output container's extension
  // (AAC in an .mp3 file is invalid and makes ffmpeg exit 234).
  const ext = path.extname(dest).toLowerCase()
  const codecArgs =
    ext === ".mp3"
      ? ["-c:a", "libmp3lame", "-b:a", "192k"]
      : ["-c:a", "aac", "-b:a", "160k"]

  // Strip leading + trailing silence (trim leading, reverse, trim leading
  // again = trailing, reverse back). The HEAD keeps -50dB peak so a quiet
  // musical intro survives. The TAIL is cut harder, at -36dB RMS: the library
  // beds end in a fade-out, and at -50dB the last four seconds of a 30s bed
  // (-35 to -47 dB, not silence, not music either) stayed in every loop copy.
  // Looped, that put a dip every ~26 seconds; narration hid it until the
  // clip-first cut left it alone under the closing hold, where it read as the
  // music stopping for seven seconds. Cutting the decay makes the crossfade
  // land on audible music instead of on a fade.
  const trimmed = path.join(publicDir, `._trim_${srcName}`)
  const silHead =
    "silenceremove=start_periods=1:start_threshold=-50dB:detection=peak"
  const silTail =
    "silenceremove=start_periods=1:start_threshold=-36dB:start_duration=0.25:detection=rms"
  try {
    await runFfmpeg(
      [
        "-y",
        "-i",
        src,
        "-af",
        `${silHead},areverse,${silTail},areverse`,
        ...codecArgs,
        trimmed,
      ],
      "music trim",
    )
  } catch {
    // Trim failed — fall back to the untrimmed source so music still plays.
    await copyFile(src, dest)
    return true
  }
  const dur = await probeDuration(trimmed)

  if (dur == null || dur >= needSec) {
    await copyFile(dur == null ? src : trimmed, dest)
    await rm(trimmed, { force: true }).catch(() => {})
    if (dur != null)
      console.log(
        `🎵 music ${dur.toFixed(1)}s (trimmed) ≥ ${needSec.toFixed(1)}s — no loop`,
      )
    return true
  }
  // Each crossfade overlaps its two sides, so N copies joined by a d-second
  // fade run N*dur - (N-1)*d, not N*dur. Solve for the N that still covers
  // needSec, and never let the fade exceed half a copy.
  const xfade = Math.max(0.3, Math.min(MUSIC_SEAM_XFADE_SEC, dur / 2))
  // A bed shorter than twice the fade cannot be crossfaded with itself at all:
  // `dur - xfade` goes negative, the Math.max(0.01) guard below turns that into
  // a division by a hundredth, and a 0.2s bed asked for ~22,000 ffmpeg inputs.
  // ffmpeg would then fail on file descriptors or argv length, but only after
  // burning the whole 180s watchdog. Degrade immediately instead.
  const step = dur - xfade
  const copies =
    step <= 0
      ? 0
      : Math.min(
          MUSIC_MAX_COPIES,
          Math.max(2, Math.ceil((needSec - xfade) / step)),
        )
  if (copies === 0) {
    return await loopWithoutCrossfade(trimmed, dest, dur, needSec, codecArgs)
  }
  const args = ["-y"]
  for (let i = 0; i < copies; i++) args.push("-i", trimmed)
  const filters = []
  let label = "0:a"
  for (let i = 1; i < copies; i++) {
    const next = `ax${i}`
    filters.push(`[${label}][${i}:a]acrossfade=d=${xfade.toFixed(3)}[${next}]`)
    label = next
  }
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[${label}]`,
    "-t",
    needSec.toFixed(3), // then trim to exactly what's needed
    ...codecArgs,
    dest,
  )
  try {
    await runFfmpeg(args, "music loop")
  } catch {
    // Crossfaded join failed — fall back to the plain butt-joined loop rather
    // than shipping a devotional with no music at all.
    return await loopWithoutCrossfade(trimmed, dest, dur, needSec, codecArgs)
  }
  await rm(trimmed, { force: true }).catch(() => {})
  console.log(
    `🎵 music ${dur.toFixed(1)}s (silence-trimmed) ×${copies} joined with ` +
      `${xfade.toFixed(1)}s crossfades → ${needSec.toFixed(1)}s`,
  )
  return true
}

/**
 * The butt-joined loop: audible seams, but always available. Reached when the
 * crossfaded join fails, and directly when the bed is too short to crossfade
 * with itself at all.
 *
 * It degrades ONE more step rather than throwing. The crossfade's catch used to
 * call ffmpeg again with nothing around it, so a second failure — a bed that
 * breaks both paths, a full disk, another watchdog kill — propagated out of
 * staging and killed the whole run. The comment there said the point was to
 * avoid "a devotional with no music at all"; what it actually produced was no
 * devotional at all, after the film had already been downloaded, trimmed and
 * loudnorm'd. The composition tolerates a missing bed, so a silent devotional
 * is strictly better than a failed one.
 */
async function loopWithoutCrossfade(trimmed, dest, dur, needSec, codecArgs) {
  try {
    await runFfmpeg(
      [
        "-y",
        "-stream_loop",
        String(Math.ceil(needSec / dur)),
        "-i",
        trimmed,
        "-t",
        needSec.toFixed(3),
        ...codecArgs,
        dest,
      ],
      "music loop (fallback)",
    )
    console.log(
      `🎵 music ${dur.toFixed(1)}s looped WITHOUT crossfade → ${needSec.toFixed(1)}s`,
    )
    return true
  } catch (err) {
    console.warn(
      `⚠️  music could not be looped (${err instanceof Error ? err.message : err}) — ` +
        "rendering WITHOUT a bed rather than failing the devotional",
    )
    await rm(dest, { force: true }).catch(() => {})
    return false
  } finally {
    await rm(trimmed, { force: true }).catch(() => {})
  }
}

async function main() {
  const manifestPath = abs(
    arg("manifest", "devo/artifacts/design/manifest.json"),
  )
  const styleId = arg("style", "grain") // grain | bw | sepia
  // LAYOUT (arrangement) — independent of --style (color/filter). Omit to use
  // the filter's native layout. centered | editorial | classic
  const layout = arg("layout", "")
  // No baked mute icon — these are plain videos; the player (QuickTime, the
  // website, a social app) owns sound. Pass --mute-button=true only if you ever
  // need it baked in.
  const showMuteButton = arg("mute-button", "false") === "true"
  // Text entrance: "block" (fade/slide whole lines) or "letters" (smooth
  // letter-by-letter reveal). Content/voice/timing are identical either way.
  const textAnim = arg("anim", "block") // block | letters
  // Optional CSS grade for the video card's clip (cools warm source footage to
  // match the teal text cards). Natural color when unset.
  const videoCardFilter = arg("vfilter", "")
  // Override the final-card hold (seconds). Teasers pass a small value (~2).
  const outroHoldSec = arg("outro", "")
  // Override the opening pause before narration (seconds). Cover samples use
  // this to hit a fixed length while still fitting the full hook narration.
  const introHoldSec = arg("intro", "")
  // Hold the last frame clean instead of fading to black (cover-only samples).
  const noEndFade = arg("no-end-fade", "false") === "true"
  // Teasers: mute the clip audio + play the music bed straight through.
  const muteVideoAudio = arg("mute-video", "false") === "true"
  // Teasers: quiet clip audio (0–1) that fades in/out slowly under the music.
  const videoAudioLevel = arg("video-audio", "")
  // Teasers: cover text shown from frame 0 (no entrance animation).
  const staticCover = arg("static-cover", "false") === "true"
  // Social cover tests: skip the date entirely.
  const hideCoverDate = arg("hide-cover-date", "false") === "true"
  // Teasers: no brand mark on the cover, so the title sits alone in the middle
  // of the frame. Full devotionals keep the logo.
  const hideCoverLogo = arg("hide-cover-logo", "false") === "true"
  // Teasers: leave the footage sharp behind the cover title.
  const coverBgSharp = arg("cover-bg-sharp", "false") === "true"
  // Film treatment: halation, a heavier grain layer, deeper vignette, film edge.
  // The teaser wants the grain without the split-tone grade, which is why this
  // is separate from `--style`.
  const filmTreatment = arg("film-treatment", "false") === "true"
  // Teasers: let the BACKGROUND clip's own sound play under the text cards, at
  // half `--video-audio`, so the scene is audible from the first frame and
  // rises when the clip takes the frame. Without it the text cards are
  // music-only and the film's sound arrives abruptly on the video card.
  const bgAudio = arg("bg-audio", "false") === "true"
  // Teasers: the video card continues the shared take rather than restarting it.
  const continuousClip = arg("continuous-clip", "false") === "true"
  // Teasers: hold the verse on screen as the video comes up (seconds).
  const verseHoldIntoVideoSec = arg("verse-hold", "")
  // Social cover tests: title + attribution shown from frame 0, but (unlike
  // static-cover) the logo animation still plays.
  const coverTextStatic = arg("cover-text-static", "false") === "true"
  // Social cover tests: short line under the title, same font as the date.
  const coverSecondaryLine = arg("cover-secondary", "")
  // Shown in the date's slot instead of a date. A dated cover ages the video
  // the moment it is seen, which is wrong for a series watched whenever found.
  const coverDateLabel = arg("cover-date-label", "")
  // Title animates first from frame 0; the logo sequence starts ~2s in.
  const coverTitleFirst = arg("cover-title-first", "false") === "true"
  // Teasers: slower crossfade between non-video cards (seconds).
  const xfadeSec = arg("xfade", "")
  // Music bed level (0–1). Default matches the schema; raise for teasers where
  // music is the only audio.
  const musicVolume = arg("music-vol", "")
  // Optional CSS grade for the text cards' background footage (overrides the
  // style's own tint). Uses the style's mediaBase when unset.
  const mediaFilterOverride = arg("mfilter", "")
  // Cap parallel Chrome workers — lower avoids memory pressure / browser
  // crashes on a loaded machine (default lets Remotion decide).
  const concurrency = Number(arg("concurrency", "")) || null
  // GPU for the headless browser. Remotion's default on this machine is
  // SwiftShader (the CPU pretending to be a GPU), and nearly every devotional
  // frame carries a backdrop blur and soft text shadows, which is exactly what
  // SwiftShader is slowest at. `--gl=angle` hands them to Metal.
  const gl = arg("gl", "") || null
  const chromiumOptions = gl ? { gl } : {}
  // DRAFT: the same composition at a fraction of the pixels, for reviewing
  // motion and timing (owner: "even 240 would be enough to see what's what").
  // 0.25 of 1080p is 270p. Layout is identical; only the output is smaller.
  const scale = Number(arg("scale", "")) || null
  const outPath = abs(arg("out", "devo/artifacts/video/design-grain.mp4"))
  // Preview mode: render N evenly-spaced STILL frames instead of encoding the
  // whole video. Each still costs one frame of Chrome rasterization rather
  // than durationSec*fps of it, so this is the cheap way to see layout, cover,
  // and card design before paying for the real encode. Frame positions are
  // evenly spaced across the timeline, NOT snapped to card boundaries — an
  // approximation, not the exact per-card frame math the composition itself
  // does internally. Writes numbered PNGs next to `--out` (out-01.png, …).
  const stillsCount = Number(arg("stills", "")) || 0
  // Explicit frame numbers, for a caller that already knows per-card
  // boundaries (e.g. computed from the manifest) and wants to land INSIDE
  // each card's settled window rather than at an even fraction of the whole
  // timeline, which can catch a card mid-reveal or mid-crossfade.
  // "".split(",") is [""], and Number("") is 0 — a valid, non-negative finite
  // number — so parsing an UNSET flag the same way as a set one silently
  // produced a phantom single-frame list [0] on every normal render (no flag
  // passed at all). That replaced the real MP4 output with a single frame-0
  // PNG next to it, while the script still logged "DONE" and exited 0 — a
  // real full-narration render for ch5 silently produced no video because of
  // this. Guard on the flag actually being present before parsing it.
  // A SLICE of the timeline as a real MP4 ("first-N-seconds" review): stills
  // show layout but not motion, and the opening — logo stamp, the stepper's
  // light, a verse unfolding — is all motion. Rendering frames 0-520 costs a
  // twelfth of the full encode and answers the same question.
  const frameRangeArg = arg("frame-range", "")
  const frameRange = frameRangeArg
    ? frameRangeArg
        .split("-")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0)
    : []

  const stillsFramesArg = arg("stills-frames", "")
  const stillsFrames = stillsFramesArg
    ? stillsFramesArg
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0)
    : []

  // Public dir: Remotion's staticFile() resolves assets from here. The manifest
  // is self-contained — every referenced file sits beside it.
  const publicDir = await mkdtemp(path.join(tmpdir(), "devo-remotion-"))
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    const manifestDir = path.dirname(manifestPath)
    const stage = async (name) => {
      if (name)
        await copyFile(path.join(manifestDir, name), path.join(publicDir, name))
    }

    // Total on-screen runtime (matches the composition's timing: per-card audio +
    // holds, plus a front intro hold, a trailing outro hold, and a per-card tail).
    // Music is looped to at least this, with margin, so it never falls silent.
    const cards = manifest.cards ?? []
    // MUST mirror packages/shorts-compositions/src/devotional/timing.ts. These
    // were guessed (0.8s intro, 0.4s tail) and both were wrong: the real tail
    // is CARD_TAIL_FRAMES 24/30 = 0.8s and the real intro is 30/30 = 1.0s. The
    // 5s margin absorbed the error only while a devotional had fewer than
    // twelve cards; the stepper pushed it past twenty.
    //
    // The bed does not go silent when it falls short — the composition mounts
    // it with `loop`, so Remotion restarts the track from frame one, with no
    // crossfade. That is the seam this whole file crossfades away everywhere
    // else, reintroduced ~4s before the end of a 22-card devotional: inside the
    // 8s closing dwell, where the narration has stopped and there is nothing to
    // mask it. Covering the full runtime means the loop never wraps at all.
    const CARD_TAIL_SEC = 24 / 30
    const INTRO_HOLD_SEC = 30 / 30
    const OUTRO_HOLD_SEC = 240 / 30
    const needSec =
      cards.reduce(
        (s, c) => s + (c.durationSec ?? 0) + (c.holdSec ?? 0) + CARD_TAIL_SEC,
        0,
      ) +
      // The overrides the composition honours, honoured here too.
      (introHoldSec !== ""
        ? Number(introHoldSec)
        : manifest.introHoldSec != null
          ? Number(manifest.introHoldSec)
          : INTRO_HOLD_SEC) +
      (outroHoldSec !== ""
        ? Number(outroHoldSec)
        : manifest.outroHoldSec != null
          ? Number(manifest.outroHoldSec)
          : OUTRO_HOLD_SEC) +
      5 // margin ON TOP of the real length, not absorbing an error in it

    await stage(manifest.bgFile)
    const musicStaged = await stageMusicLooped(
      manifest.musicFile,
      manifestDir,
      publicDir,
      needSec,
    )
    // DESIGN TEST: an audio file that belongs to no card (the "Let's watch."
    // phrase cut out of the scripture segment).
    if (arg("demo-watch-audio", "")) await stage(arg("demo-watch-audio", ""))
    for (const c of manifest.cards) {
      await stage(c.audioFile)
      await stage(c.videoFile)
      await stage(c.bgFile)
      // The social opening's sounds (key clicks, transition whoosh).
      await stage(c.keySfx)
      await stage(c.transitionSfx)
    }

    const audioDurationSec = manifest.cards.reduce(
      (s, c) => s + (c.durationSec ?? 0),
      0,
    )
    const inputProps = {
      headerDate: manifest.headerDate ?? "Dec 25",
      ...(manifest.attribution ? { attribution: manifest.attribution } : {}),
      cards: manifest.cards,
      audioDurationSec,
      style: styleId,
      ...(layout ? { layout } : {}),
      showMuteButton,
      textAnim,
      ...(videoCardFilter ? { videoCardFilter } : {}),
      ...(arg("grain-size", "")
        ? { grainSizePx: Number(arg("grain-size", "")) }
        : {}),
      ...(arg("grain-filter", "")
        ? { grainFilter: arg("grain-filter", "") }
        : {}),
      ...(arg("grain-blend", "") ? { grainBlend: arg("grain-blend", "") } : {}),
      ...(arg("blur-scale", "")
        ? { blurScale: Number(arg("blur-scale", "")) }
        : {}),
      // CLI flag wins; otherwise the MANIFEST's holds. The manifest carried
      // `introHoldSec` for months and nothing here read it, so the clip-first
      // cut asked for no intro hold and got the composition's default second
      // anyway — a second of muted footage before the stepper.
      ...(outroHoldSec !== ""
        ? { outroHoldSec: Number(outroHoldSec) }
        : manifest.outroHoldSec != null
          ? { outroHoldSec: Number(manifest.outroHoldSec) }
          : {}),
      ...(introHoldSec !== ""
        ? { introHoldSec: Number(introHoldSec) }
        : manifest.introHoldSec != null
          ? { introHoldSec: Number(manifest.introHoldSec) }
          : {}),
      ...(noEndFade ? { noEndFade: true } : {}),
      ...(muteVideoAudio ? { muteVideoAudio: true } : {}),
      ...(videoAudioLevel !== ""
        ? { videoAudioLevel: Number(videoAudioLevel) }
        : {}),
      ...(staticCover ? { staticCover: true } : {}),
      ...(arg("text-font", "") ? { textFont: arg("text-font", "") } : {}),
      ...(hideCoverDate ? { hideCoverDate: true } : {}),
      ...(hideCoverLogo ? { hideCoverLogo: true } : {}),
      ...(coverBgSharp ? { coverBgSharp: true } : {}),
      ...(filmTreatment ? { filmTreatment: true } : {}),
      ...(bgAudio ? { bgAudio: true } : {}),
      ...(continuousClip ? { continuousClip: true } : {}),
      ...(verseHoldIntoVideoSec
        ? { verseHoldIntoVideoSec: Number(verseHoldIntoVideoSec) }
        : {}),
      ...(coverTextStatic ? { coverTextStatic: true } : {}),
      ...(coverSecondaryLine ? { coverSecondaryLine } : {}),
      ...(coverDateLabel ? { coverDateLabel } : {}),
      ...(coverTitleFirst ? { coverTitleFirst: true } : {}),
      ...(xfadeSec !== "" ? { xfadeSec: Number(xfadeSec) } : {}),
      ...(musicVolume !== "" ? { musicVolume: Number(musicVolume) } : {}),
      ...(mediaFilterOverride ? { mediaFilterOverride } : {}),
      ...(manifest.bgFile ? { bgFile: manifest.bgFile } : {}),
      ...(manifest.bgDurationSec
        ? { bgDurationSec: manifest.bgDurationSec }
        : {}),
      ...(manifest.stepRing ? { stepRing: true } : {}),
      ...(manifest.filmCaptionStyle
        ? { filmCaptionStyle: manifest.filmCaptionStyle }
        : {}),
      ...(manifest.markLayout ? { markLayout: manifest.markLayout } : {}),
      // Shorts (feat-573): credits and verse callout in 9:16.
      ...(manifest.portraitMarks ? { portraitMarks: true } : {}),
      ...(manifest.voiceVolume != null
        ? { voiceVolume: manifest.voiceVolume }
        : {}),
      ...(manifest.ctaMusicAtSec != null
        ? { ctaMusicAtSec: manifest.ctaMusicAtSec }
        : {}),
      ...(manifest.shortForm ? { shortForm: true } : {}),
      ...(manifest.shortFact ? { shortFact: manifest.shortFact } : {}),
      ...(manifest.shortCards ? { shortCards: manifest.shortCards } : {}),
      ...(manifest.stepProgress ? { stepProgress: manifest.stepProgress } : {}),
      ...(manifest.bgStartOffsetSec != null
        ? { bgStartOffsetSec: manifest.bgStartOffsetSec }
        : {}),
      ...(manifest.bgPlaybackRate
        ? { bgPlaybackRate: manifest.bgPlaybackRate }
        : {}),
      // Only name the bed if it was actually staged: `staticFile` on a file
      // that is not there fails the render, which would undo the degrade above.
      ...(manifest.musicFile && musicStaged
        ? { musicFile: manifest.musicFile }
        : {}),
      // DESIGN TEST only (--comp=stepper-test); ignored by the real compositions.
      ...(arg("stepper-variant", "")
        ? { stepperVariant: arg("stepper-variant", "") }
        : {}),
      ...(arg("stepper-mode", "")
        ? { stepperMode: arg("stepper-mode", "") }
        : {}),
      ...(arg("demo-watch-audio", "")
        ? {
            demoWatchAudio: arg("demo-watch-audio", ""),
            ...(arg("demo-watch-sec", "")
              ? { demoWatchAudioSec: Number(arg("demo-watch-sec", "")) }
              : {}),
          }
        : {}),
      ...(arg("demo-cues", "")
        ? {
            demoCues: arg("demo-cues", "")
              .split(",")
              .map((n) => Number(n.trim()))
              .filter((n) => Number.isFinite(n)),
          }
        : {}),
    }

    // A manifest may carry its own `render` block — the look this KIND of video
    // is supposed to have, as data rather than a line of flags someone has to
    // remember. Teasers use it: their recipe (no grade, no logo, sharp cover,
    // continuous take, verse hold, film sound at 10%) was settled once and now
    // travels with the manifest.
    //
    // These are DEFAULTS, not overrides: a flag passed explicitly on the command
    // line still wins, so one-off experiments do not require editing a manifest.
    // "Explicitly" means present in argv — checking the parsed value cannot tell
    // a passed `--style=grain` from the built-in default of the same name.
    const passedOnCli = (flag) =>
      process.argv.some((a) => a.startsWith(`--${flag}=`))
    /** prop name → the CLI flag that sets it, where one exists. */
    const CLI_FLAG_FOR = {
      style: "style",
      layout: "layout",
      textAnim: "anim",
      outroHoldSec: "outro",
      introHoldSec: "intro",
      hideCoverDate: "hide-cover-date",
      hideCoverLogo: "hide-cover-logo",
      coverBgSharp: "cover-bg-sharp",
      filmTreatment: "film-treatment",
      bgAudio: "bg-audio",
      continuousClip: "continuous-clip",
      verseHoldIntoVideoSec: "verse-hold",
      videoAudioLevel: "video-audio",
      muteVideoAudio: "mute-video",
      musicVolume: "music-vol",
      xfadeSec: "xfade",
    }
    for (const [key, value] of Object.entries(manifest.render ?? {})) {
      const flag = CLI_FLAG_FOR[key]
      if (flag && passedOnCli(flag)) continue
      inputProps[key] = value
    }
    if (manifest.render) {
      console.log(
        `manifest render block: ${Object.keys(manifest.render).join(", ")}`,
      )
    }

    console.log("Ensuring headless browser (first run downloads ~150MB)…")
    await ensureBrowser()
    console.log("Bundling composition…")
    const serveUrl = await bundle({
      entryPoint: ENTRY,
      publicDir,
      webpackOverride: (c) => c,
    })
    console.log("Selecting composition…")
    const composition = await selectComposition({
      serveUrl,
      chromiumOptions,
      // "devotional" (9:16 social) or "devotional-wide" (16:9 desktop/YouTube).
      id: arg("comp", "devotional"),
      inputProps,
    })
    await mkdir(path.dirname(outPath), { recursive: true })

    if (stillsCount > 0 || stillsFrames.length > 0) {
      const start = performance.now()
      const last = composition.durationInFrames - 1
      const frames =
        stillsFrames.length > 0
          ? stillsFrames.map((f) => Math.min(f, last))
          : Array.from({ length: stillsCount }, (_, i) =>
              stillsCount === 1
                ? 0
                : Math.round((i / (stillsCount - 1)) * last),
            )
      console.log(
        `Rendering ${frames.length} still(s) at frames [${frames.join(", ")}] of ${composition.durationInFrames}…`,
      )
      const outDir = path.dirname(outPath)
      const outBase = path.basename(outPath).replace(/\.mp4$/, "")
      for (let i = 0; i < frames.length; i++) {
        const stillPath = path.join(
          outDir,
          `${outBase}-still-${String(i + 1).padStart(2, "0")}.png`,
        )
        await renderStill({
          composition,
          serveUrl,
          chromiumOptions,
          output: stillPath,
          frame: frames[i],
          inputProps,
        })
        console.log(
          `  [${i + 1}/${frames.length}] frame ${frames[i]} → ${stillPath}`,
        )
      }
      console.log(`
🖼  ${frames.length} still(s) in ${((performance.now() - start) / 1000).toFixed(1)}s`)
      return
    }

    // Clamp to the composition, and keep it a real pair — a half-parsed range
    // silently rendering "frame 0 to 0" would look like a broken render rather
    // than a bad flag.
    const range =
      frameRange.length === 2
        ? [
            Math.min(frameRange[0], composition.durationInFrames - 1),
            Math.min(frameRange[1], composition.durationInFrames - 1),
          ]
        : null
    console.log(
      range
        ? `Rendering frames ${range[0]}-${range[1]} (${((range[1] - range[0] + 1) / composition.fps).toFixed(1)}s of ${(composition.durationInFrames / composition.fps).toFixed(1)}s)…`
        : `Rendering ${composition.durationInFrames} frames (${(composition.durationInFrames / composition.fps).toFixed(1)}s)…`,
    )
    await renderMedia({
      composition,
      serveUrl,
      chromiumOptions,
      codec: "h264",
      outputLocation: outPath,
      inputProps,
      // QUALITY. Two separate knobs, both left at Remotion's defaults before:
      //
      // `jpegQuality` is how OffthreadVideo hands each source frame to the
      // browser. The default 80 re-compresses the film BEFORE it is composited
      // and then h264 compresses the result again, which shows up as mush in
      // the dark, grainy interiors this series is full of. 95 is near-lossless
      // for that hand-off at a modest disk cost per frame.
      //
      // `crf` is the final h264 encode. 18 is Remotion's default; 16 gives the
      // text cards and the film grain more bitrate to sit in, which matters
      // because YouTube re-encodes whatever we upload.
      // A draft has nothing to preserve: default quality, and the smaller frame.
      jpegQuality: scale && scale < 1 ? 80 : 95,
      crf: scale && scale < 1 ? 23 : 16,
      ...(scale ? { scale } : {}),
      ...(range ? { frameRange: range } : {}),
      ...(concurrency ? { concurrency } : {}),
      onProgress: ({ progress }) => {
        if (Math.round(progress * 100) % 10 === 0)
          process.stdout.write(`\r  ${Math.round(progress * 100)}%   `)
      },
    })
    console.log(`\n🎬 done: ${outPath}`)
  } finally {
    // Remove staged assets on BOTH success and failure — a thrown render (browser
    // download stall, bundle error) used to leak the temp tree via main().catch.
    await rm(publicDir, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((err) => {
  console.error("render failed:", err)
  process.exitCode = 1
})
