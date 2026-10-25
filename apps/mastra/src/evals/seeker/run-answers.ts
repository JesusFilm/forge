#!/usr/bin/env tsx
/**
 * Seeker eval — STEP 1 (NON-GATING FAST MODE). Capture answers with the
 * retrieval exchange INJECTED.
 *
 * Runs every question through every answering model with the production
 * system prompt, handing each model a pre-completed `retrieveAnswer`
 * exchange built from the committed fixtures. Deterministic and cheap — the
 * developer loop for prompt-wording iteration (decision doc §1 carve-out).
 *
 * THE GATE IS NOT THIS FILE. The gating run drives the REAL agent through
 * Mastra's tool loop (`run-loop.ts`, built on the `buildSeekerAgent` /
 * `buildRetrieveAnswerTool` seams — PR C); only that mode can observe
 * tool-skipping. This mode stamps `retrieval.mode: "fixtures"` so the two
 * can never be compared as if they were the same measurement.
 *
 * The prompt under test is the production fallback constant, imported via
 * `prompt-sections.ts` — NEVER a hand-copied prompt string (the prototype's
 * copy is retired with it).
 *
 *   pnpm --filter @forge/mastra eval:seeker:answers
 *   pnpm --filter @forge/mastra eval:seeker:answers -- --limit=1
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { csv, flag, loadFixtures } from "./cli"
import { requireOpenRouterKey } from "./env"
import { criteriaHash, gitSha } from "./hashes"
import { answeringModelsByIds, costUsd } from "./models"
import {
  ANSWER_DECODING,
  completeWithInjectedTool,
  EvalLlmError,
} from "./openrouter"
import {
  PROMPT_UNDER_TEST,
  promptSha256,
  SECTION_MAPPING_VERSION,
} from "./prompt-sections"
import { QUESTIONS, QUESTION_SET_ID } from "./questions"
import { RETRIEVE_ANSWER_TOOL_SPEC, type RagFixture } from "./rag"
import { ANSWER_RUN_KIND, type AnswerRecord, type AnswerRun } from "./types"

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_RUNS_DIR = resolve(MODULE_DIR, "../../../eval-runs/seeker")
const DEFAULT_FIXTURES = resolve(MODULE_DIR, "fixtures/rag-fixtures.json")

/**
 * Injected mode shares the frozen-world invariant fixture-rag.ts's
 * `fixtureResultToClientResult` enforces for the tool loop (finding #15): a
 * fixture that encodes a retrieval OUTAGE must never be served as if
 * retrieval had run — capture-rag refuses to write one, and a hand-edited
 * file must fail the cell loudly here, not measure the unavailable path.
 * Exported for tests.
 */
export function assertServableFixture(
  fixture: RagFixture,
  questionId: string,
): void {
  if (fixture.result.status === "unavailable") {
    throw new Error(
      `fixture for ${questionId} encodes status 'unavailable' — re-capture it; the injected exchange must serve real passages or a real empty result`,
    )
  }
}

async function main(): Promise<void> {
  // Before anything paid or slow. A missing key must not become 30 identical
  // failure rows and an output file that looks like a run happened.
  requireOpenRouterKey()

  const argv = process.argv.slice(2)
  const fixtures = await loadFixtures(
    resolve(process.cwd(), flag(argv, "fixtures") ?? DEFAULT_FIXTURES),
  )
  const models = answeringModelsByIds(csv(flag(argv, "models")))
  const limitRaw = flag(argv, "limit")
  const limit = limitRaw ? Number(limitRaw) : QUESTIONS.length
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error("--limit must be a positive number")
  }
  const questions = QUESTIONS.slice(0, limit)
  const sampleId = flag(argv, "sample") ?? "s1"
  const outPath = resolve(
    process.cwd(),
    flag(argv, "out") ?? resolve(DEFAULT_RUNS_DIR, "answers.json"),
  )

  console.log(`prompt   : production fallback (${promptSha256().slice(0, 12)})`)
  console.log(`sections : ${SECTION_MAPPING_VERSION}`)
  console.log(`questions: ${questions.length} of ${QUESTIONS.length}`)
  console.log(`models   : ${models.map((model) => model.id).join(", ")}`)
  console.log(`cells    : ${questions.length * models.length}`)
  console.log(
    `retrieval: injected (deterministic) · corpus ${fixtures.corpusSha256.slice(0, 12)} · topK ${fixtures.topK}`,
  )
  console.log("")

  const startedAt = new Date().toISOString()
  const answers: AnswerRecord[] = []

  for (const question of questions) {
    const injected = fixtures.fixtures.find(
      (fixture) => fixture.questionId === question.id,
    )
    for (const model of models) {
      process.stdout.write(`  ${question.id} x ${model.label} ... `)
      try {
        if (!injected) {
          // Fail the CELL loudly rather than serving another question's
          // passages — the four extension questions have no fixtures until
          // eval:seeker:capture-rag is re-run against a live RAG.
          throw new Error(
            `no RAG fixture for ${question.id} — re-run eval:seeker:capture-rag`,
          )
        }
        assertServableFixture(injected, question.id)
        const completion = await completeWithInjectedTool({
          model: model.id,
          system: PROMPT_UNDER_TEST,
          user: question.text,
          toolSpec: RETRIEVE_ANSWER_TOOL_SPEC,
          // Query is OURS — the question verbatim. No model choice.
          query: question.text,
          toolResult: injected.result,
        })
        const record: AnswerRecord = {
          questionId: question.id,
          category: question.category,
          model: model.id,
          ok: true,
          text: completion.text,
          finishReason: completion.finishReason,
          usage: completion.usage,
          costUsd: costUsd(model.id, completion.usage),
          latencyMs: completion.latencyMs,
          toolCalls: [
            {
              name: RETRIEVE_ANSWER_TOOL_SPEC.function.name,
              arguments: JSON.stringify({ query: question.text }),
              servedFrom: "fixture",
            },
          ],
          // Scripted exchange — the model never had the choice, so this is
          // vacuously false here; only the tool-loop mode measures it.
          skippedTool: false,
        }
        answers.push(record)
        const truncated =
          completion.finishReason === "length" ? " TRUNCATED" : ""
        console.log(
          `${completion.text.length} chars, ${completion.latencyMs}ms${truncated}`,
        )
      } catch (cause) {
        const message =
          cause instanceof EvalLlmError
            ? `${cause.code}: ${cause.message}`
            : cause instanceof Error
              ? cause.message
              : String(cause)
        answers.push({
          questionId: question.id,
          category: question.category,
          model: model.id,
          ok: false,
          text: null,
          finishReason: null,
          usage: null,
          costUsd: null,
          latencyMs: 0,
          error: message,
        })
        console.log(`FAILED — ${message}`)
      }
    }
  }

  const run: AnswerRun = {
    kind: ANSWER_RUN_KIND,
    startedAt,
    finishedAt: new Date().toISOString(),
    identity: {
      promptSha256: promptSha256(),
      // This mode composes from the compiled-in fallback by construction —
      // it never fetches Langfuse. The loop runner resolves through the
      // agent's own path and stamps `langfuse` + version when served.
      promptSource: "fallback",
      promptLangfuseVersion: null,
      promptLangfuseLabel: null,
      sectionMappingVersion: SECTION_MAPPING_VERSION,
      questionSetId: QUESTION_SET_ID,
      questionIds: questions.map((question) => question.id),
      criteriaSha256: criteriaHash(questions),
      answeringModels: models.map((model) => model.id),
      decoding: {
        temperature: ANSWER_DECODING.temperature,
        maxTokens: ANSWER_DECODING.maxTokens,
      },
      sampleId,
      gitSha: gitSha(),
      retrieval: {
        mode: "fixtures",
        corpusSha256: fixtures.corpusSha256,
        topK: fixtures.topK,
      },
      judge: null,
    },
    answers,
  }

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(run, null, 2)}\n`, "utf8")

  const failed = answers.filter((answer) => !answer.ok).length
  const truncated = answers.filter(
    (answer) => answer.finishReason === "length",
  ).length
  const known = answers.filter((answer) => answer.costUsd != null)
  const totalUsd = known.reduce((sum, answer) => sum + (answer.costUsd ?? 0), 0)

  console.log("")
  console.log(`wrote ${outPath}`)
  console.log(
    `${answers.length} cells, ${failed} failed, ${truncated} truncated, ~$${totalUsd.toFixed(4)}`,
  )
  if (failed > 0) {
    console.log("(failed cells are recorded, not fatal — the judge skips them)")
  }
}

if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
