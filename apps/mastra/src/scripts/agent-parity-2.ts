/**
 * Before/after parity for the remaining 4 agents: modernizer, copy,
 * highlighter, spurgeon-ranker. BEFORE = raw OpenRouter llm; AFTER = Mastra
 * Agent via createAgentLlm. Note: modernizer (t=0.3) and copy (t=0.6) have
 * natural run-to-run wording variance — so alongside the side-by-side text we
 * check the STRUCTURAL contract each service enforces. Highlighter (t=0.2) and
 * ranker (t=0) should be near-deterministic.
 *
 *   pnpm --filter @forge/mastra exec tsx --env-file=.env.local \
 *     src/scripts/agent-parity-2.ts
 */
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { getDevotionalModel } from "../config/env"
import { createAgentLlm } from "../mastra/agents/devotional/agent-llm"
import { copyAgent } from "../mastra/agents/devotional/copy-agent"
import { highlighterAgent } from "../mastra/agents/devotional/highlighter-agent"
import { modernizerAgent } from "../mastra/agents/devotional/modernizer-agent"
import { spurgeonRankerAgent } from "../mastra/agents/devotional/spurgeon-ranker-agent"
import { writeDevotionalCopy } from "../services/devotional/devotional-copy"
import type { GeneratedDevotional } from "../services/devotional/generate-devotional"
import { passageForChapter } from "../services/devotional/jesus-film-passages"
import { createDevotionalLlm } from "../services/devotional/llm"
import {
  findReflection,
  loadReflectionCorpora,
  shortlistSpurgeonByTheme,
} from "../services/devotional/reflection-corpus"
import { pickReflectionHighlights } from "../services/devotional/reflection-highlighter"
import { modernizeReflection } from "../services/devotional/reflection-modernizer"
import { splitReflection } from "../services/devotional/reflection-split"
import { pickBestSpurgeon } from "../services/devotional/spurgeon-ranker"

const HERE = path.dirname(new URL(import.meta.url).pathname)
const BASELINE_DIR = path.resolve(HERE, "../../../../devo/baseline")

async function main() {
  const before = createDevotionalLlm({ model: getDevotionalModel() })
  const record: Record<string, unknown> = {}

  const storm = JSON.parse(
    await readFile(path.join(BASELINE_DIR, "ch19-seq0.json"), "utf8"),
  ) as GeneratedDevotional
  const chapter = passageForChapter(19)!

  // ── MODERNIZER (Henry on Luke 8 → ~170-word insight-only reflection) ──
  const source = findReflection(chapter.osisRef)!
  const modInput = {
    sourceText: source.text,
    focusReference: chapter.reference,
    sourceName: source.source,
  }
  const modBefore = await modernizeReflection({ ...modInput, llm: before })
  const modAfter = await modernizeReflection({
    ...modInput,
    llm: createAgentLlm(modernizerAgent, getDevotionalModel()),
  })
  const words = (s: string) => s.split(/\s+/).length
  const paras = (s: string) => s.split(/\n\n/).length
  console.log("━━ MODERNIZER ━━")
  console.log(
    `BEFORE (${words(modBefore.adapted)}w, ${paras(modBefore.adapted)} paras):\n${modBefore.adapted}\n`,
  )
  console.log(
    `AFTER  (${words(modAfter.adapted)}w, ${paras(modAfter.adapted)} paras):\n${modAfter.adapted}\n`,
  )
  record.modernizer = { before: modBefore, after: modAfter }

  // ── COPY (hook · conclusion · question · prayer from the baseline reflection) ──
  const copyInput = {
    sceneTitle: storm.clip.title,
    reference: storm.scripture.reference,
    scriptureText: storm.scripture.text,
    reflection: storm.reflection.text,
  }
  const copyBefore = await writeDevotionalCopy({ ...copyInput, llm: before })
  const copyAfter = await writeDevotionalCopy({
    ...copyInput,
    llm: createAgentLlm(copyAgent, getDevotionalModel()),
  })
  console.log("━━ COPY ━━")
  for (const [tag, c] of [
    ["BEFORE", copyBefore],
    ["AFTER ", copyAfter],
  ] as const) {
    console.log(`${tag}: hook="${c.title}"`)
    console.log(`        conclusion="${c.conclusion}"`)
    console.log(`        question="${c.question}"`)
    console.log(`        prayer="${c.prayer}"`)
  }
  record.copy = { before: copyBefore, after: copyAfter }

  // ── HIGHLIGHTER (top-3 verbatim phrases from the baseline reflection) ──
  const chunks = splitReflection(storm.reflection.text)
  const hlBefore = await pickReflectionHighlights({ chunks, llm: before })
  const hlAfter = await pickReflectionHighlights({
    chunks,
    llm: createAgentLlm(highlighterAgent, getDevotionalModel()),
  })
  console.log("\n━━ HIGHLIGHTER ━━")
  console.log(`BEFORE: ${JSON.stringify(hlBefore.filter(Boolean))}`)
  console.log(`AFTER : ${JSON.stringify(hlAfter.filter(Boolean))}`)
  record.highlighter = { before: hlBefore, after: hlAfter }

  // ── SPURGEON RANKER (storm themes; -1/null = "none fits" quality gate) ──
  const corpora = loadReflectionCorpora()
  const shortlist = shortlistSpurgeonByTheme(chapter.themes, corpora.spurgeon)
  const rankInput = {
    sceneTitle: storm.clip.title,
    reference: chapter.reference,
    candidates: shortlist,
  }
  const rankBefore = await pickBestSpurgeon({ ...rankInput, llm: before })
  const rankAfter = await pickBestSpurgeon({
    ...rankInput,
    llm: createAgentLlm(spurgeonRankerAgent, getDevotionalModel()),
  })
  console.log("\n━━ SPURGEON RANKER ━━")
  console.log(
    `BEFORE: ${rankBefore ? rankBefore.reference : "none fits → commentary fallback"}`,
  )
  console.log(
    `AFTER : ${rankAfter ? rankAfter.reference : "none fits → commentary fallback"}`,
  )
  console.log(
    `parity: ${(rankBefore?.reference ?? null) === (rankAfter?.reference ?? null) ? "✅ same pick" : "⚠️ differs"}`,
  )
  record.ranker = {
    before: rankBefore?.reference ?? null,
    after: rankAfter?.reference ?? null,
  }

  await writeFile(
    path.join(BASELINE_DIR, "parity-content-agents.json"),
    JSON.stringify(record, null, 2) + "\n",
  )
  console.log(`\nsaved → devo/baseline/parity-content-agents.json`)
}

main().catch((e) => {
  console.error("parity-2 failed:", e instanceof Error ? e.stack : e)
  process.exit(1)
})
