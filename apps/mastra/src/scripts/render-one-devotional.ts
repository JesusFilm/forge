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
  const { devotional, videoPath } = await prepareAndRenderDevotional({
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
    approveText: process.argv.includes("--approve"),
    // Try a scene with a different commentator without editing the passage
    // table — the two read the same scene differently often enough to be worth
    // comparing before committing a choice to the data.
    bgExtendPastEpisode: process.argv.includes("--bg-extend"),
    coverOnly: process.argv.includes("--cover-only"),
    ...(arg("music-file") ? { musicFile: arg("music-file") } : {}),
    ...(arg("settle-line") ? { settleLine: arg("settle-line") } : {}),
    coverTitleFirst: process.argv.includes("--cover-title-first"),
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
    console.log(
      `\n⏸  STOPPED FOR REVIEW: "${devotional.title}" [${devotional.reflection.flavor}, voice ${devotional.voice}, ${devotional.mood}]\n   No audio was synthesized, so nothing was billed beyond the LLM calls.`,
    )
    return
  }
  console.log(
    `\n✅ DONE (${aspect}): "${devotional.title}" [${devotional.reflection.flavor}, voice ${devotional.voice}, ${devotional.mood}]\n   ${videoPath}`,
  )
}

main().catch((e) => {
  console.error(
    "render-one-devotional failed:",
    e instanceof Error ? e.stack : e,
  )
  process.exit(1)
})
