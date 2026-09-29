/**
 * Run the narrative editor on a cached devotional and print what it finds,
 * with each fix applied to a copy of the text so the diff can be read.
 *
 *   pnpm exec tsx --env-file=.env.local src/scripts/review-devotional-narrative.ts \
 *     --devo=../../devo/cache/ch1001-seq0/devo.json [--evidence-from=<devo.json>]
 *
 * `--evidence-from` borrows the source evidence from another copy of the same
 * devotional (by credit), for a text saved before evidence was recorded.
 * Read-only: it never writes the devotional.
 */
import { readFile } from "node:fs/promises"

import { createAgentLlm } from "../mastra/agents/devotional/agent-llm"
import { narrativeEditorAgent } from "../mastra/agents/devotional/narrative-editor-agent"
import { narrativeEditorModel } from "../services/devotional/devotional-models"
import type {
  GeneratedDevotional,
  ReflectionParagraph,
} from "../services/devotional/generate-devotional"
import {
  applyNarrativeFixes,
  narrativeParagraphs,
  reviewNarrative,
} from "../services/devotional/narrative-editor"

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

async function main() {
  const devoPath = arg("devo")
  if (!devoPath) throw new Error("--devo=<path to devo.json> is required")
  const d = JSON.parse(await readFile(devoPath, "utf8")) as GeneratedDevotional
  const raw: ReflectionParagraph[] = d.reflection.paragraphs?.length
    ? d.reflection.paragraphs
    : d.reflection.text.split(/\n{2,}/).map((text) => ({ text }))
  const from = arg("evidence-from")
  if (from) {
    const other = JSON.parse(
      await readFile(from, "utf8"),
    ) as GeneratedDevotional
    const byPortrait = new Map(
      (other.reflection.paragraphs ?? [])
        .filter((p) => p.mark?.evidence)
        .map((p) => [p.mark!.portrait ?? p.mark!.source, p.mark!.evidence!]),
    )
    for (const p of raw) {
      if (p.mark && !p.mark.evidence) {
        const e = byPortrait.get(p.mark.portrait ?? p.mark.source)
        if (e) p.mark = { ...p.mark, evidence: e }
      }
    }
  }
  const paragraphs = narrativeParagraphs(raw)
  const review = await reviewNarrative({
    sceneTitle: d.clip.title,
    scripture: { reference: d.scripture.reference, text: d.scripture.text },
    paragraphs,
    conclusion: d.conclusion,
    question: d.question,
    prayer: d.prayer,
    llm: createAgentLlm(narrativeEditorAgent, narrativeEditorModel()),
  })
  console.log(`LINE: ${review.throughline}`)
  console.log(`SUMMARY: ${review.summary}${review.skipped ? " (SKIPPED)" : ""}`)
  for (const i of review.issues) {
    console.log(
      `\n[${i.severity}/${i.kind}] ¶${i.paragraph}: “${i.quote}”\n  → ${i.fix === "cut" ? "CUT" : `“${i.replacement}”`}\n  why: ${i.why}`,
    )
  }
  const applied = applyNarrativeFixes(
    paragraphs.map((p) => p.text),
    review.issues,
  )
  console.log("\n=== WITH FIXES APPLIED (changed paragraphs only) ===")
  applied.paragraphs.forEach((p, i) => {
    if (p !== paragraphs[i].text) console.log(`\n¶${i}: ${p}`)
  })
  if (applied.unapplied.length) {
    console.log(
      `\n(${applied.unapplied.length} fix(es) could not be placed: quote not found verbatim)`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
