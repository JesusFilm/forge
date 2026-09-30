/**
 * Blind fact-check comparison (owner, 2026-09-30): run the narrative editor
 * over ONE finished devotional with two different models and print what each
 * found, to see whether a checker from another model family catches what the
 * writer's family misses.
 *
 *   pnpm exec tsx --env-file=.env.local src/scripts/fact-check-ab.ts \
 *     --source=lumo-luke-15 --seq=0 \
 *     --models=anthropic/claude-opus-5.5,openai/gpt-6-astra --out=<dir>
 */
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  cacheDirFor,
  loadCachedDevo,
} from "../services/devotional/devotional-cache"
import { createDevotionalLlm } from "../services/devotional/llm"
import {
  narrativeParagraphs,
  reviewNarrative,
} from "../services/devotional/narrative-editor"
import { videoSource } from "../services/devotional/video-sources"

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1]

async function main() {
  const src = videoSource(arg("source") ?? "")
  if (!src) throw new Error("--source=<registered video source> is required")
  const devo = await loadCachedDevo(
    cacheDirFor(src.index, Number(arg("seq") ?? 0)),
  )
  if (!devo?.reflection.paragraphs?.length)
    throw new Error("no cached devotional with paragraphs for that source")
  const models = (arg("models") ?? "").split(",").filter(Boolean)
  const out = arg("out")
  const results = await Promise.all(
    models.map(async (model) => {
      const review = await reviewNarrative({
        sceneTitle: src.title,
        scripture: {
          reference: devo.scripture.reference,
          text: devo.scripture.text,
        },
        paragraphs: narrativeParagraphs(devo.reflection.paragraphs ?? []),
        conclusion: devo.conclusion,
        question: devo.question,
        prayer: devo.prayer,
        ...(devo.message
          ? {
              message: {
                idea: devo.message.idea,
                tension: devo.message.tension,
              },
            }
          : {}),
        llm: createDevotionalLlm({ model, timeoutMs: 300_000 }),
      })
      return { model, review }
    }),
  )
  for (const { model, review } of results) {
    console.log(`\n=== ${model} ===\n${review.summary}`)
    for (const i of review.issues)
      console.log(
        `  [${i.severity}/${i.kind}] ¶${i.paragraph + 1}: “${i.quote}” → ${i.fix === "cut" ? "cut" : `“${i.replacement}”`} (${i.why})`,
      )
    if (review.skipped) console.log("  (review could not run)")
  }
  if (out) {
    await mkdir(out, { recursive: true })
    await writeFile(
      path.join(out, "fact-check-ab.json"),
      JSON.stringify(results, null, 2),
    )
  }
}

main().catch((e) => {
  console.error("fact-check-ab failed:", e instanceof Error ? e.stack : e)
  process.exit(1)
})
