/**
 * Write a new spoken opening for a finished devotional, under the storyteller's
 * opening rules, without touching its reflection (owner, 2026-09-30). The
 * opening is checked in code, then the fact checker reads it with the whole
 * piece: its preview line must promise only what the reflection delivers.
 * Writes a VOICE / VISUAL / ON-SCREEN sheet; the devotional cache is not
 * changed unless --save is passed.
 *
 *   pnpm exec tsx --env-file=.env.local src/scripts/rewrite-opening.ts \
 *     --source=lumo-luke-15 --seq=0 --out=<dir> [--save]
 */
import { copyFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  cacheDirFor,
  loadCachedDevo,
  saveCachedDevo,
} from "../services/devotional/devotional-cache"
import { stripDashes } from "../services/devotional/generate-devotional"
import { createDevotionalLlm } from "../services/devotional/llm"
import {
  narrativeParagraphs,
  reviewNarrative,
} from "../services/devotional/narrative-editor"
import {
  openingProblems,
  writeOpening,
} from "../services/devotional/storyteller-writer"
import { videoSource } from "../services/devotional/video-sources"

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1]

const FACT_KINDS = new Set([
  "unsupported-claim",
  "contradicts-story",
  "misquote",
  "planted-association",
])

async function main() {
  const src = videoSource(arg("source") ?? "")
  if (!src) throw new Error("--source=<registered video source> is required")
  const dir = cacheDirFor(src.index, Number(arg("seq") ?? 0))
  const devo = await loadCachedDevo(dir)
  const paragraphs = devo?.reflection.paragraphs ?? []
  if (!devo || !paragraphs.length || !devo.message || !devo.clipTranscript)
    throw new Error("needs a cached storyteller devotional (message, passage)")
  const writer = createDevotionalLlm({
    model: arg("writer") ?? "anthropic/claude-fable-5.1",
    timeoutMs: 300_000,
  })
  const checker = createDevotionalLlm({
    model: arg("fact-check") ?? "anthropic/claude-opus-5.5",
    timeoutMs: 300_000,
  })
  const base = {
    passage: { reference: devo.passage.reference, text: devo.clipTranscript },
    message: { idea: devo.message.idea, tension: devo.message.tension },
    title: devo.title,
    paragraphs,
    takeaway: devo.conclusion,
    llm: writer,
  }
  const notes: string[] = []
  let draft = await writeOpening(base)
  // Up to two rounds: a shorter rewrite can trip a different rule.
  for (let round = 0; round < 2; round++) {
    const shape = openingProblems(draft.opening, paragraphs)
    if (!shape.length) break
    notes.push(`code checks: ${shape.map((p) => p.rule).join(", ")}`)
    draft = await writeOpening({
      ...base,
      revise: {
        opening: draft,
        problems: shape.map((p) => `${p.rule}: ${p.sentence} (${p.why})`),
      },
    })
  }
  const review = () =>
    reviewNarrative({
      sceneTitle: src.title,
      scripture: {
        reference: devo.scripture.reference,
        text: devo.scripture.text,
      },
      paragraphs: narrativeParagraphs(paragraphs),
      opening: draft.opening.flatMap((o) =>
        o.onScreen ? [o.line, `(on screen) ${o.onScreen}`] : [o.line],
      ),
      conclusion: devo.conclusion,
      question: devo.question,
      prayer: devo.prayer,
      message: base.message,
      llm: checker,
    })
  const lines = () =>
    draft.opening.flatMap((o) => (o.onScreen ? [o.line, o.onScreen] : [o.line]))
  const aboutOpening = (r: Awaited<ReturnType<typeof review>>) =>
    r.issues.filter((i) => {
      const q = i.quote.replace(/^\(on screen\)\s*/i, "")
      return FACT_KINDS.has(i.kind) && lines().some((l) => l.includes(q))
    })
  let checked = await review()
  let open = aboutOpening(checked)
  if (open.length) {
    notes.push(
      `fact check on the opening: ${open.map((i) => `“${i.quote}” (${i.why})`).join(" | ")}`,
    )
    draft = await writeOpening({
      ...base,
      revise: {
        opening: draft,
        problems: open.map(
          (i) =>
            `NOT SUPPORTED, must change: “${i.quote}”. ${i.fix === "cut" ? "Cut it" : `Replace with “${i.replacement}”`} (${i.why})`,
        ),
      },
    })
    checked = await review()
    open = aboutOpening(checked)
  }
  const remaining = openingProblems(draft.opening, paragraphs)
  notes.push(
    open.length || remaining.length
      ? `⛔ still open: ${[...open.map((i) => i.quote), ...remaining.map((p) => p.rule)].join(" | ")}`
      : "✅ opening passed the code checks and the fact check",
  )

  const sheet = [
    `${src.title}: new opening (the reflection is unchanged)`,
    "",
    `PROMISE (every title and cover variant expresses this):`,
    `  ${stripDashes(draft.promise)}`,
    "",
    ...draft.opening.flatMap((o) => [
      `VOICE:     ${stripDashes(o.line)}`,
      `VISUAL:    ${o.visual}`,
      ...(o.onScreen ? [`ON SCREEN: ${o.onScreen}`] : []),
      "",
    ]),
    "VOICE:     Let's watch.",
    "VISUAL:    WATCH and the passage over the muted last shot",
    "",
    "PREVIOUS OPENING:",
    ...(devo.openingLines ?? []).map((l) => `  ${l}`),
    "",
    "CHECKS:",
    ...notes.map((n) => `  ${n}`),
  ].join("\n")
  const out = arg("out")
  if (out) {
    await mkdir(out, { recursive: true })
    await writeFile(path.join(out, "opening.txt"), sheet + "\n")
    await writeFile(
      path.join(out, "opening.json"),
      JSON.stringify(draft, null, 2),
    )
  }
  console.log(sheet)
  if (process.argv.includes("--save")) {
    devo.promise = stripDashes(draft.promise)
    devo.openingPlan = draft.opening.map((o) => ({
      ...o,
      line: stripDashes(o.line),
    }))
    devo.openingLines = devo.openingPlan.map((o) => o.line)
    // Never overwrite: the previous text stays beside it.
    await copyFile(
      path.join(dir, "devo.json"),
      path.join(dir, `devo.before-${Date.now()}.json`),
    )
    await saveCachedDevo(dir, devo)
    console.log(`saved to ${dir}`)
  }
  if (open.length || remaining.length) process.exitCode = 2
}

main().catch((e) => {
  console.error("rewrite-opening failed:", e instanceof Error ? e.stack : e)
  process.exit(1)
})
