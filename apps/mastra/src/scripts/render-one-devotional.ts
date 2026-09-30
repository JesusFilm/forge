/**
 * End-to-end CLI: generate ONE video-first devotional and render it to an MP4.
 * Thin wrapper over prepareAndRenderDevotional (shared with the Mastra workflow).
 *
 *   pnpm --filter @forge/mastra exec tsx --env-file=.env.local \
 *     src/scripts/render-one-devotional.ts --chapter=19 --seq=0
 */
import { homedir } from "node:os"
import path from "node:path"

import { getDevotionalModel, getDevotionalTranslateModel } from "../config/env"
import { prepareAndRenderDevotional } from "../services/devotional/devotional-render"
import {
  listVideoSources,
  videoSource,
} from "../services/devotional/video-sources"
import { createDevotionalLlm } from "../services/devotional/llm"

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

async function main() {
  // A registered film other than JESUS (`--source=lumo-matt-20`). It brings its
  // own clip, window, corner mark and grade; the chapter number is its cache
  // key.
  const sourceKey = arg("source")
  const source = sourceKey ? videoSource(sourceKey) : undefined
  if (sourceKey && !source) {
    const known = listVideoSources()
      .map((s) => s.key)
      .join(", ")
    throw new Error(`unknown --source=${sourceKey}; known: ${known}`)
  }
  const chapterIndex = source ? source.index : Number(arg("chapter", "19"))
  const sequence = Number(arg("seq", "0"))
  const style = arg("style", source?.style ?? "restored")
  const layout = arg("layout", "grounded")
  const aspect = arg("aspect", "portrait") as "portrait" | "wide"
  const lang = arg("lang", "en") as "en" | "ru" | "es"
  const voiceOverride = arg("voice") // experiment: force a specific voice id
  const clipFirst = arg("structure") === "clip-first"
  const outDir = arg(
    "out",
    path.join(homedir(), "Desktop", "Devos", "Devotionals"),
  )!
  const date = arg("date", new Date().toISOString().slice(0, 10))!

  const llm = createDevotionalLlm({ model: getDevotionalModel() })
  const translateLlm = createDevotionalLlm({
    model: getDevotionalTranslateModel(),
  })
  const { devotional, videoPath, previewStageDir } =
    await prepareAndRenderDevotional({
      chapterIndex,
      sequence,
      date,
      llm,
      translateLlm,
      lang,
      ...(voiceOverride ? { voiceOverride } : {}),
      outDir,
      style,
      layout,
      aspect,
      regenerate: process.argv.includes("--regenerate"),
      regenerateAudio: process.argv.includes("--regenerate-audio"),
      ignoreQualityGate: process.argv.includes("--ignore-quality"),
      reviewOnly: process.argv.includes("--review"),
      silentPreview: process.argv.includes("--silent-preview"),
      // Stops after the manifest + staged clip/background are written, before the
      // Remotion encode. The manifest carries the real per-card timings, which is
      // the only honest way to answer "how long does the music play alone at the
      // end" — the constants in timing.ts are only part of the sum.
      stopBeforeRender: process.argv.includes("--stop-before-render"),
      // THE SERIES LOOK IS THE DEFAULT. Every one of these used to be opt-in
      // and each fails silently when forgotten: the three YouTube cuts of
      // 2026-09-15 went out with a five-second empty cover and no voice-synced
      // text because the flags were not on the command line. Opt OUT instead.
      wordTimings: !process.argv.includes("--no-word-timings"),
      faceCrop: !process.argv.includes("--no-face-crop"),
      // Hard cuts between cards (owner rule). `--card-xfade=0.85` restores the
      // old dissolve.
      cardXfadeSec: Number(arg("card-xfade", "0")),
      ...(arg("video-speed") ? { videoSpeed: Number(arg("video-speed")) } : {}),
      // Clip-first opens on the owner's cover intro over a three-second lead
      // (film heard from the first frame), with the step clock in the corner
      // and the spoken word lifting in the captions. Opt out per piece.
      ...(clipFirst && !process.argv.includes("--no-intro")
        ? { intro: "cover" as const, mutedLeadSec: 3 }
        : {}),
      ...(clipFirst && !process.argv.includes("--no-step-ring")
        ? { stepRing: true }
        : {}),
      ...(clipFirst ? { clipCaptionStyle: "words-lift" as const } : {}),
      ...(arg("muted-lead") ? { mutedLeadSec: Number(arg("muted-lead")) } : {}),
      showSettleLine: process.argv.includes("--show-settle-line"),
      textFont: arg("text-font", "serif") as "sans" | "serif",
      ...(arg("video-filter") ? { videoFilter: arg("video-filter") } : {}),
      // Screenshots instead of an encode, for reviewing layout/type/colour
      // before paying for the full render.
      ...(arg("stills") ? { stills: Number(arg("stills")) } : {}),
      ...(arg("stills-frames") ? { stillsFrames: arg("stills-frames") } : {}),
      ...(arg("frame-range") ? { frameRange: arg("frame-range") } : {}),
      // Quarter-size review render (270p), written as `…-draft.mp4`.
      ...(process.argv.includes("--draft") ? { draft: true } : {}),
      ...(arg("grain-size") ? { grainSizePx: Number(arg("grain-size")) } : {}),
      ...(arg("grain-filter") ? { grainFilter: arg("grain-filter") } : {}),
      ...(arg("grain-blend") ? { grainBlend: arg("grain-blend") } : {}),
      ...(arg("blur-scale") ? { blurScale: Number(arg("blur-scale")) } : {}),
      steps: !process.argv.includes("--no-steps"),
      // A/B: `--structure=clip-first` opens on the film (see RenderOptions).
      ...(process.argv.includes("--step-ring") ? { stepRing: true } : {}),
      ...(arg("mark-layout")
        ? { markLayout: arg("mark-layout") as "above" | "side" }
        : {}),
      ...(arg("film-caption-style")
        ? {
            filmCaptionStyle: arg("film-caption-style") as
              | "karaoke"
              | "typewriter"
              | "ghost"
              | "scroll",
          }
        : {}),
      ...(process.argv.includes("--step-bar")
        ? { stepRing: true, stepProgress: "bar" as const }
        : {}),
      ...(arg("intro")
        ? {
            intro: arg("intro") as
              | "cover"
              | "bands"
              | "hook"
              | "watch"
              | "opening"
              | "montage",
          }
        : {}),
      // YouTube opening (`--intro=hook --hook="..."`): the voice asks the
      // devotional's question over the film's first seconds. Its recorded
      // length sets the lead, so nothing here is timed by hand.
      ...(arg("hook") ? { hookLine: arg("hook") } : {}),
      // The voice may say more than the screen shows ("Welcome to Daily Bible
      // Pause." before the question); `--hook-title` is what is drawn.
      ...(arg("hook-title") ? { hookTitle: arg("hook-title") } : {}),
      // Borrow the opening's extra footage from this point in the film rather
      // than slowing the scene's own run-up.
      ...(arg("hook-bg") ? { hookBgStartSec: Number(arg("hook-bg")) } : {}),
      // `--intro=montage`: one shot of the film per spoken line of --hook,
      // cut on the line's first word. `--intro-shots` is a source time (s) per
      // line, in order; the last --hook line ("Let's watch.") has no shot, the
      // scene itself starts there. `--intro-captions` puts a caption on chosen
      // lines, by 0-based line number: "1=THEY WORKED ALL DAY;2=ONE HOUR".
      ...(arg("hook-gap") ? { hookGapSec: Number(arg("hook-gap")) } : {}),
      ...(arg("intro-focus")
        ? { introFocus: arg("intro-focus")!.split(",").map(Number) }
        : {}),
      ...(arg("intro-shots")
        ? { introShots: arg("intro-shots")!.split(",").map(Number) }
        : {}),
      ...(arg("intro-captions")
        ? {
            introCaptions: Object.fromEntries(
              arg("intro-captions")!
                .split(";")
                .map((kv) => kv.split("="))
                .filter((kv) => kv.length === 2)
                .map(([k, v]) => [Number(k), v.trim()]),
            ),
          }
        : {}),
      // `--intro-kinetic`: kinetic captions for the montage (the "stack"
      // layout), per 0-based line: "0=outside/faithful/left;1=the best
      // robe/squandered/right". Hero phrase, accent words (comma-separated),
      // the open side of the shot.
      ...(arg("intro-kinetic")
        ? {
            introKinetic: arg("intro-kinetic")!
              .split(";")
              .map((kv) => kv.split("="))
              .filter((kv) => kv.length === 2)
              .map(([k, v]) => {
                const [hero = "", accents = "", side = "left"] = v.split("/")
                return {
                  line: Number(k),
                  hero: hero.trim(),
                  accents: accents
                    .split(",")
                    .map((a) => a.trim())
                    .filter(Boolean),
                  side:
                    side.trim() === "right"
                      ? ("right" as const)
                      : ("left" as const),
                }
              }),
          }
        : {}),
      // `--teaser-intro`: render ONLY the opening, ending on `--cta`.
      introTeaser: process.argv.includes("--teaser-intro"),
      // The teaser closes on one quiet centred line by default (owner picked
      // it over the kinetic close, 2026-09-30); `--cta-style=kinetic` for the
      // other look.
      introCtaStyle:
        arg("cta-style") === "kinetic"
          ? ("kinetic" as const)
          : ("calm" as const),
      // Social opening: `--quote-a/--quote-b` (+ `--quote-a-strong`, etc.).
      ...(arg("quote-a") && arg("quote-b")
        ? {
            quoteIntro: {
              quoteA: arg("quote-a")!,
              quoteB: arg("quote-b")!,
              ...(arg("quote-a-strong")
                ? { quoteAStrong: arg("quote-a-strong") }
                : {}),
              ...(arg("quote-b-strong")
                ? { quoteBStrong: arg("quote-b-strong") }
                : {}),
              ...(arg("quote-sec")
                ? { durationSec: Number(arg("quote-sec")) }
                : {}),
              ...(arg("quote-bg")
                ? { bgStartSec: Number(arg("quote-bg")) }
                : {}),
              ...(arg("quote-rate")
                ? { bgRate: Number(arg("quote-rate")) }
                : {}),
              ...(arg("questions")
                ? { questions: arg("questions")!.split("|") }
                : {}),
              ...(arg("cta") ? { ctaLine: arg("cta") } : {}),
              ...(arg("cta-label") != null
                ? { ctaLabel: arg("cta-label") }
                : {}),
            },
          }
        : {}),
      ...(arg("theme-word") ? { clipThemeWord: arg("theme-word") } : {}),
      ...(process.argv.includes("--split-panels")
        ? { clipSplitPanels: true }
        : {}),
      ...(arg("clip-trim-end")
        ? { clipTrimEndSec: Number(arg("clip-trim-end")) }
        : {}),
      ...(arg("clip-captions")
        ? {
            clipCaptionStyle: arg("clip-captions") as
              | "words"
              | "words-lift"
              | "phrase",
          }
        : {}),
      ...(arg("structure") === "clip-first"
        ? { structure: "clip-first" as const }
        : {}),
      ...(arg("silent-wps")
        ? { silentPreviewWordsPerSec: Number(arg("silent-wps")) }
        : {}),
      approveText: process.argv.includes("--approve"),
      // Try a scene with a different commentator without editing the passage
      // table — the two read the same scene differently often enough to be worth
      // comparing before committing a choice to the data.
      bgExtendPastEpisode: process.argv.includes("--bg-extend"),
      coverOnly: process.argv.includes("--cover-only"),
      ...(arg("music-file") ? { musicFile: arg("music-file") } : {}),
      ...(arg("settle-line") ? { settleLine: arg("settle-line") } : {}),
      // Title leads the cover, the mark follows two seconds later (owner rule).
      coverTitleFirst: !process.argv.includes("--no-cover-title-first"),
      // The kicker beside the mark once the lockup collapses ("TODAY'S
      // DEVOTIONAL"), the quiet line under the title, and a cover that leaves
      // the footage sharp and carries only a light scrim (owner, 2026-09-25).
      ...(arg("cover-date-label")
        ? { coverDateLabel: arg("cover-date-label") }
        : {}),
      ...(arg("cover-line") ? { coverSecondaryLine: arg("cover-line") } : {}),
      ...(process.argv.includes("--cover-sharp") ? { coverBgSharp: true } : {}),
      // Play a different film than the chapter's own (LUMO, say). The window
      // has to come with it: the catalog knows nothing about a non-JESUS clip.
      ...(arg("film-mark") ? { filmMark: arg("film-mark") as "lumo" } : {}),
      ...(arg("clip-id")
        ? {
            clipOverride: {
              id: arg("clip-id")!,
              startSec: Number(arg("clip-start", "0")),
              lengthSec: Number(arg("clip-len", "60")),
              ...(arg("clip-title") ? { title: arg("clip-title") } : {}),
            },
          }
        : {}),
      suppressOccasion: process.argv.includes("--no-occasion"),
      ...(arg("caption-offset")
        ? { captionOffsetSec: Number(arg("caption-offset")) }
        : {}),
      ...(arg("music-volume")
        ? { musicVolume: Number(arg("music-volume")) }
        : {}),
      ...(arg("voice-level")
        ? { videoAudioLevel: Number(arg("voice-level")) }
        : {}),
      ...(arg("words") ? { approxWords: Number(arg("words")) } : {}),
      ...(arg("commentary")
        ? { commentaryOverride: arg("commentary") as "ryle" | "henry" }
        : {}),
      ...(arg("episode") ? { episode: Number(arg("episode")) } : {}),
      log: (m) => console.log(m),
    })
  if (videoPath === null) {
    // Two different stops land here, and saying the wrong one is not harmless:
    // --review really does stop before any TTS, while --stop-before-render
    // stops AFTER it. Printing "no audio was synthesized" for the second is
    // exactly the sort of confident-but-wrong log line that hid a cache full of
    // silence for a whole session.
    console.log(
      previewStageDir
        ? `\n⏸  STOPPED BEFORE RENDER: "${devotional.title}" [voice ${devotional.voice}]\n   Narration WAS produced (and cached). Staged files: ${previewStageDir}`
        : `\n⏸  STOPPED FOR REVIEW: "${devotional.title}" [${devotional.reflection.flavor}, voice ${devotional.voice}, ${devotional.mood}]\n   No audio was synthesized, so nothing was billed beyond the LLM calls.`,
    )
    return
  }
  // Stills mode never writes the MP4, so naming it here would repeat the exact
  // failure this pipeline already shipped once: a "DONE" line pointing at a
  // video file that was never encoded.
  const stills = process.argv.some(
    (a) => a.startsWith("--stills=") || a.startsWith("--stills-frames="),
  )
  console.log(
    `\n✅ DONE (${aspect}${stills ? ", stills only" : ""}): "${devotional.title}" ` +
      `[${devotional.reflection.flavor}, voice ${devotional.voice}, ${devotional.mood}]\n   ` +
      (stills
        ? `${videoPath.replace(/\.mp4$/, "")}-still-NN.png (no video rendered)`
        : videoPath),
  )
}

main().catch((e) => {
  console.error(
    "render-one-devotional failed:",
    e instanceof Error ? e.stack : e,
  )
  process.exit(1)
})
