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
import { createDevotionalLlm } from "../services/devotional/llm"

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

async function main() {
  const chapterIndex = Number(arg("chapter", "19"))
  const sequence = Number(arg("seq", "0"))
  const style = arg("style", "splittone")
  const layout = arg("layout", "grounded")
  const aspect = arg("aspect", "portrait") as "portrait" | "wide"
  const lang = arg("lang", "en") as "en" | "ru"
  const voiceOverride = arg("voice") // experiment: force a specific voice id
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
      ...(arg("muted-lead") ? { mutedLeadSec: Number(arg("muted-lead")) } : {}),
      showSettleLine: process.argv.includes("--show-settle-line"),
      textFont: arg("text-font", "serif") as "sans" | "serif",
      ...(arg("video-filter") ? { videoFilter: arg("video-filter") } : {}),
      // Screenshots instead of an encode, for reviewing layout/type/colour
      // before paying for the full render.
      ...(arg("stills") ? { stills: Number(arg("stills")) } : {}),
      ...(arg("stills-frames") ? { stillsFrames: arg("stills-frames") } : {}),
      ...(arg("frame-range") ? { frameRange: arg("frame-range") } : {}),
      ...(arg("grain-size") ? { grainSizePx: Number(arg("grain-size")) } : {}),
      ...(arg("grain-filter") ? { grainFilter: arg("grain-filter") } : {}),
      ...(arg("grain-blend") ? { grainBlend: arg("grain-blend") } : {}),
      ...(arg("blur-scale") ? { blurScale: Number(arg("blur-scale")) } : {}),
      steps: !process.argv.includes("--no-steps"),
      // A/B: `--structure=clip-first` opens on the film (see RenderOptions).
      ...(arg("clip-captions")
        ? {
            clipCaptionStyle: arg("clip-captions") as
              | "words"
              | "words-lift"
              | "typewriter"
              | "typewriter-cursor"
              | "pop"
              | "pop-settle",
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
