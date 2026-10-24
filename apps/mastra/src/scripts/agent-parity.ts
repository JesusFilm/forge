/**
 * Before/after parity check for the Mastra-agent migration.
 *
 * BEFORE = the tuned service calling the raw OpenRouter llm (createDevotionalLlm).
 * AFTER  = the same service calling the same-model Mastra Agent via createAgentLlm.
 *
 * Runs the safety gate + scripture selection over the baseline devotionals in
 * devo/baseline/ and prints both results side by side. Results are also saved
 * to devo/baseline/parity-<agent>.json for the record.
 *
 *   pnpm --filter @forge/mastra exec tsx --env-file=.env.local \
 *     src/scripts/agent-parity.ts
 */
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { getDevotionalModel, getDevotionalSafetyModel } from "../config/env"
import { createAgentLlm } from "../mastra/agents/devotional/agent-llm"
import { safetyAgent } from "../mastra/agents/devotional/safety-agent"
import { scriptureAgent } from "../mastra/agents/devotional/scripture-agent"
import { setInstructionResolver } from "../mastra/agents/devotional/instruction-resolver"
import {
  DEVOTIONAL_AUTHORED_PATHS,
  loadPromptBundle,
  loadSafetyPolicy,
} from "../services/devotional/authored-data"
import { createDevotionalLlm } from "../services/devotional/llm"
import { evaluateSafety } from "../services/devotional/safety-gate"
import { selectScriptureForPassage } from "../services/devotional/passage-scripture"
import type { GeneratedDevotional } from "../services/devotional/generate-devotional"
import type { Devotional } from "../services/devotional/types"
import {
  lookupVerse,
  parseWebBibleDocument,
} from "../services/devotional/web-bible"
import {
  createExplicitInputsReader,
  readWorkspaceText,
  requiredArg,
} from "./devotional-authored-inputs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BASELINE_DIR = path.resolve(HERE, "../../../../devo/baseline")
const CASES = ["ch19-seq0", "ch33-seq1", "ch5-seq2"]

/** Map the video-first devotional onto the legacy shape the safety gate scores. */
function toLegacyDevotional(d: GeneratedDevotional): Devotional {
  return {
    date: d.date,
    hook: {
      type: "question",
      title: d.title,
      summary: d.conclusion,
      sourceUrl: null,
    },
    scripture: d.scripture,
    video: {
      videoId: d.clip.id,
      title: d.clip.title,
      url: d.clip.id,
      thumbnailUrl: null,
    },
    videoMatch: "search",
    reflection: d.reflection.text,
    questions: [d.question],
    prayer: d.prayer,
    furtherReading: null,
    blockOrder: ["hook", "scripture", "video", "reflection", "questions"],
  }
}

async function main() {
  const inputsRoot = requiredArg("workspace-inputs")
  const reader = createExplicitInputsReader(inputsRoot)
  const [prompts, safetyPolicy] = await Promise.all([
    loadPromptBundle(reader),
    loadSafetyPolicy(reader),
  ])
  const bible = parseWebBibleDocument({
    path: DEVOTIONAL_AUTHORED_PATHS.webBible,
    content: await readWorkspaceText(
      inputsRoot,
      DEVOTIONAL_AUTHORED_PATHS.webBible,
    ),
  })
  setInstructionResolver(
    async (agentId) =>
      ({
        devotionalSafety: safetyPolicy.prompt,
        devotionalScripture: prompts.prompts.scripture,
      })[agentId] ?? null,
  )
  const beforeLlm = createDevotionalLlm({ model: getDevotionalModel() })
  const beforeSafetyLlm = createDevotionalLlm({
    model: getDevotionalSafetyModel(),
  })
  const afterSafetyLlm = createAgentLlm(safetyAgent, getDevotionalSafetyModel())
  const afterScriptureLlm = createAgentLlm(scriptureAgent, getDevotionalModel())

  const record: Record<string, unknown>[] = []
  for (const name of CASES) {
    const devo = JSON.parse(
      await readFile(path.join(BASELINE_DIR, `${name}.json`), "utf8"),
    ) as GeneratedDevotional
    const legacy = toLegacyDevotional(devo)

    console.log(`\n━━ ${name}: "${devo.title}" ━━`)

    // SAFETY — highest stakes.
    const safetyBefore = await evaluateSafety({
      devotional: legacy,
      llm: beforeSafetyLlm,
      systemPrompt: safetyPolicy.prompt,
      minConfidence: safetyPolicy.effectiveMinimumConfidence,
    })
    const safetyAfter = await evaluateSafety({
      devotional: legacy,
      llm: afterSafetyLlm,
      systemPrompt: safetyPolicy.prompt,
      minConfidence: safetyPolicy.effectiveMinimumConfidence,
    })
    const fmt = (v: typeof safetyBefore) =>
      `${v.verdict}  doctrine=${v.scores.doctrine} tone=${v.scores.tone} sensitivity=${v.scores.sensitivity}${v.reasons.length ? `  reasons: ${v.reasons.join("; ").slice(0, 120)}` : ""}`
    console.log(`  safety BEFORE: ${fmt(safetyBefore)}`)
    console.log(`  safety AFTER : ${fmt(safetyAfter)}`)
    console.log(
      `  safety parity: ${safetyBefore.verdict === safetyAfter.verdict ? "✅ same verdict" : "❌ VERDICT DIFFERS"}`,
    )

    // SCRIPTURE.
    const ref = devo.passage.reference
    const scriptureBefore = await selectScriptureForPassage({
      reference: ref,
      llm: beforeLlm,
      systemPrompt: prompts.prompts.scripture,
      lookupVerse: (reference) => lookupVerse(reference, bible.verses),
    })
    const scriptureAfter = await selectScriptureForPassage({
      reference: ref,
      llm: afterScriptureLlm,
      systemPrompt: prompts.prompts.scripture,
      lookupVerse: (reference) => lookupVerse(reference, bible.verses),
    })
    console.log(
      `  scripture BEFORE: ${scriptureBefore.reference} — ${scriptureBefore.text.slice(0, 70)}…`,
    )
    console.log(
      `  scripture AFTER : ${scriptureAfter.reference} — ${scriptureAfter.text.slice(0, 70)}…`,
    )
    console.log(
      `  scripture parity: ${scriptureBefore.reference === scriptureAfter.reference ? "✅ same verse" : "⚠️ different verse pick"}`,
    )

    record.push({
      name,
      safetyBefore,
      safetyAfter,
      scriptureBefore,
      scriptureAfter,
    })
  }

  await writeFile(
    path.join(BASELINE_DIR, "parity-safety-scripture.json"),
    JSON.stringify(record, null, 2) + "\n",
  )
  console.log(`\nsaved → devo/baseline/parity-safety-scripture.json`)
}

main().catch((e) => {
  console.error("parity run failed:", e instanceof Error ? e.stack : e)
  process.exit(1)
})
