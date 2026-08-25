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

/**
 * The music bed must cover the whole devotional. Two steps:
 *
 * 1. STRIP head + trailing silence. Generated tracks (ElevenLabs) carry ~1-3s of
 *    silence at each end; when the bed is looped to fill the runtime, that
 *    silence lands at every seam — and near the end it falls in the narration-
 *    free closing dwell as an audible DEAD GAP (the music seems to stop before
 *    the video ends). Trimming both ends makes the loop seamless.
 * 2. LOOP the trimmed bed (ffmpeg -stream_loop) up to `needSec` so it never
 *    falls silent. A trimmed track already >= needSec is used as-is.
 */
async function stageMusicLooped(srcName, manifestDir, publicDir, needSec) {
  if (!srcName) return
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
  // again = trailing, reverse back). -50dB peak so only true silence goes, not
  // a quiet musical intro.
  const trimmed = path.join(publicDir, `._trim_${srcName}`)
  const sil =
    "silenceremove=start_periods=1:start_threshold=-50dB:detection=peak"
  try {
    await runFfmpeg(
      [
        "-y",
        "-i",
        src,
        "-af",
        `${sil},areverse,${sil},areverse`,
        ...codecArgs,
        trimmed,
      ],
      "music trim",
    )
  } catch {
    // Trim failed — fall back to the untrimmed source so music still plays.
    await copyFile(src, dest)
    return
  }
  const dur = await probeDuration(trimmed)

  if (dur == null || dur >= needSec) {
    await copyFile(dur == null ? src : trimmed, dest)
    await rm(trimmed, { force: true }).catch(() => {})
    if (dur != null)
      console.log(
        `🎵 music ${dur.toFixed(1)}s (trimmed) ≥ ${needSec.toFixed(1)}s — no loop`,
      )
    return
  }
  const loops = Math.ceil(needSec / dur)
  await runFfmpeg(
    [
      "-y",
      "-stream_loop",
      String(loops), // loop the trimmed input enough times
      "-i",
      trimmed,
      "-t",
      needSec.toFixed(3), // then trim to exactly what's needed
      ...codecArgs,
      dest,
    ],
    "music loop",
  )
  await rm(trimmed, { force: true }).catch(() => {})
  console.log(
    `🎵 music ${dur.toFixed(1)}s (silence-trimmed) looped ×${loops + 1} → ${needSec.toFixed(1)}s`,
  )
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
  const outPath = abs(arg("out", "devo/artifacts/video/design-grain.mp4"))

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
    const needSec =
      cards.reduce((s, c) => s + (c.durationSec ?? 0) + (c.holdSec ?? 0), 0) +
      0.8 + // intro hold
      8 + // outro hold
      0.4 * cards.length + // per-card tail
      5 // safety margin (covers crossfade extensions)

    await stage(manifest.bgFile)
    await stageMusicLooped(manifest.musicFile, manifestDir, publicDir, needSec)
    for (const c of manifest.cards) {
      await stage(c.audioFile)
      await stage(c.videoFile)
      await stage(c.bgFile)
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
      ...(outroHoldSec !== "" ? { outroHoldSec: Number(outroHoldSec) } : {}),
      ...(introHoldSec !== "" ? { introHoldSec: Number(introHoldSec) } : {}),
      ...(noEndFade ? { noEndFade: true } : {}),
      ...(muteVideoAudio ? { muteVideoAudio: true } : {}),
      ...(videoAudioLevel !== ""
        ? { videoAudioLevel: Number(videoAudioLevel) }
        : {}),
      ...(staticCover ? { staticCover: true } : {}),
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
      ...(manifest.bgPlaybackRate
        ? { bgPlaybackRate: manifest.bgPlaybackRate }
        : {}),
      ...(manifest.musicFile ? { musicFile: manifest.musicFile } : {}),
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
      // "devotional" (9:16 social) or "devotional-wide" (16:9 desktop/YouTube).
      id: arg("comp", "devotional"),
      inputProps,
    })
    await mkdir(path.dirname(outPath), { recursive: true })
    console.log(
      `Rendering ${composition.durationInFrames} frames (${(composition.durationInFrames / composition.fps).toFixed(1)}s)…`,
    )
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outPath,
      inputProps,
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
