/**
 * End-to-end CLI: generate ONE video-first devotional and render it to an MP4.
 * Thin wrapper over prepareAndRenderDevotional (shared with the Mastra workflow).
 *
 *   pnpm --filter @forge/mastra exec tsx --env-file=.env.local \
 *     src/scripts/render-one-devotional.ts --chapter=19 --seq=0
 */
import { homedir } from "node:os"
import path from "node:path"

import {
  getDevotionalModel,
  getDevotionalTranslateModel,
} from "../config/env"
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
    log: (m) => console.log(m),
  })
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
