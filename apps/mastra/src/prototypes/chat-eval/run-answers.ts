#!/usr/bin/env tsx
/**
 * PROTOTYPE — STEP 1. Capture answers.
 *
 * Runs every question through every answering model with the system prompt
 * under test, and writes the answers to disk. No judging happens here. That
 * separation is the point: this step is the slow, paid one, so it runs once and
 * step 2 replays against its output for cents.
 *
 *   pnpm --filter @forge/mastra proto:answers
 *   pnpm --filter @forge/mastra proto:answers -- --limit=1 --models=google/gemma-4-31b-it
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { requireOpenRouterKey } from "./env"
import { answeringModelsByIds, costUsd } from "./models"
import { completeText, PrototypeLlmError } from "./openrouter"
import { promptVariantById, PROMPT_NO_RETRIEVAL } from "./prompt"
import {
  criteriaFor,
  QUESTIONS,
  QUESTION_SET_ID,
  type Question,
} from "./questions"
import type { AnswerRecord, AnswerRun } from "./types"

function gitSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim()
  } catch {
    return null
  }
}

/** Hash the exact criteria under test — editing a rubric breaks comparability. */
function criteriaHash(questions: readonly Question[]): string {
  const material = questions
    .map((question) =>
      criteriaFor(question)
        .map((c) => `${question.id}|${c.id}|${c.polarity}|${c.text}`)
        .join("\n"),
    )
    .join("\n")
  return createHash("sha256").update(material).digest("hex")
}

const DEFAULT_OUT = "prototype-runs/chat-eval/answers.json"

function flag(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function csv(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

async function main(): Promise<void> {
  // Before anything paid or slow. A missing key must not become 18 identical
  // failure rows and an output file that looks like a run happened.
  requireOpenRouterKey()

  const argv = process.argv.slice(2)

  const promptId = flag(argv, "prompt") ?? PROMPT_NO_RETRIEVAL.id
  const prompt = promptVariantById(promptId)
  const models = answeringModelsByIds(csv(flag(argv, "models")))
  const limitRaw = flag(argv, "limit")
  const limit = limitRaw ? Number(limitRaw) : QUESTIONS.length
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error("--limit must be a positive number")
  }
  const questions = QUESTIONS.slice(0, limit)
  const outPath = resolve(process.cwd(), flag(argv, "out") ?? DEFAULT_OUT)

  const promptSha256 = createHash("sha256").update(prompt.text).digest("hex")

  console.log(`prompt   : ${prompt.id} (${prompt.description})`)
  console.log(`questions: ${questions.length} of ${QUESTIONS.length}`)
  console.log(`models   : ${models.map((model) => model.id).join(", ")}`)
  console.log(`cells    : ${questions.length * models.length}`)
  console.log("")

  const startedAt = new Date().toISOString()
  const answers: AnswerRecord[] = []

  for (const question of questions) {
    for (const model of models) {
      process.stdout.write(`  ${question.id} x ${model.label} ... `)
      try {
        const completion = await completeText({
          model: model.id,
          system: prompt.text,
          user: question.text,
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
        }
        answers.push(record)
        const truncated =
          completion.finishReason === "length" ? " TRUNCATED" : ""
        console.log(
          `${completion.text.length} chars, ${completion.latencyMs}ms${truncated}`,
        )
      } catch (cause) {
        const message =
          cause instanceof PrototypeLlmError
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
    kind: "chat-eval-answers",
    startedAt,
    finishedAt: new Date().toISOString(),
    identity: {
      promptId: prompt.id,
      promptSha256,
      questionSetId: QUESTION_SET_ID,
      questionIds: questions.map((question) => question.id),
      criteriaSha256: criteriaHash(questions),
      answeringModels: models.map((model) => model.id),
      gitSha: gitSha(),
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
    console.log("(failed cells are recorded, not fatal — step 2 skips them)")
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
