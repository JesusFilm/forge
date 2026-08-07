#!/usr/bin/env tsx
/**
 * Seeker eval — STEP 1 (THE GATING MODE). Drive the REAL agent through
 * Mastra's tool loop against the frozen fixtures.
 *
 * This is Approach 2, "Real Agent, Frozen World" (decision doc §2/§6): the
 * production agent is constructed through `buildSeekerAgent` with exactly
 * three substitutions — the RAG search client frozen to committed fixtures
 * (`fixture-rag.ts`), the answering model pinned per cell to a PAID
 * production-equivalent, and memory swapped to a per-cell in-memory store.
 * Instructions resolve through the agent's OWN path (`getManagedPrompt` →
 * fallback), so the run measures the prompt production would serve. The model
 * decides for itself whether to call `retrieveAnswer` — the tool-skipping
 * defect class that decided the whole design is observable ONLY here.
 *
 * KEY HYGIENE (decision doc §3 "Spend hygiene" + PR C step 2), BEFORE the
 * agent module is imported: Mastra's `openrouter/...` model router reads
 * `OPENROUTER_API_KEY` from ambient process env, so this runner (a) requires
 * `CHAT_EVAL_OPENROUTER_API_KEY` and exits before any model call if absent;
 * (b) refuses to run if `OPENROUTER_API_PAID_KEY` is set; (c) overwrites
 * `process.env.OPENROUTER_API_KEY` with the eval key in-process so no ambient
 * dev/prod key can be billed. `pinEvalKey` is exported and unit-tested
 * (run-loop.test.ts) — the mechanism, not just the happy path. The
 * before-any-agent-import ordering is REAL, not aspirational: the agent
 * module (the one static dependency whose top level evaluates the model
 * router) loads via dynamic import() after the pin; the prompt constants
 * come from the dependency-FREE `seeker-prompt` leaf, so the static import
 * block never reaches the agent chain. run-loop.test.ts pins both the
 * static import block and the leaf's import-freeness (finding #13).
 *
 *   pnpm --filter @forge/mastra eval:seeker:loop
 *   pnpm --filter @forge/mastra eval:seeker:loop -- --limit=1
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  SEEKER_SYSTEM_PROMPT_FALLBACK,
  SEEKER_SYSTEM_PROMPT_NAME,
} from "../../mastra/agents/seeker-prompt"
import { TIME_BUDGET_MS } from "../../mastra/budgets"
import { csv, flag, loadFixtures } from "./cli"
import { KEY_VARIABLE, keyHelpText, loadEnvFiles } from "./env"
import { criteriaHash, gitSha, sha256 } from "./hashes"
import { answeringModelsByIds, costUsd, type AnsweringModel } from "./models"
import { SECTION_MAPPING_VERSION } from "./prompt-sections"
import { QUESTIONS, QUESTION_SET_ID, type Question } from "./questions"
import type { RagFixture } from "./rag"
import {
  ANSWER_RUN_KIND,
  type AnswerRecord,
  type AnswerRun,
  type RunIdentity,
  type ToolCallRecord,
} from "./types"
import type { FixtureSearchCall } from "./fixture-rag"

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_RUNS_DIR = resolve(MODULE_DIR, "../../../eval-runs/seeker")
const DEFAULT_FIXTURES = resolve(MODULE_DIR, "fixtures/rag-fixtures.json")

/** Wall-clock ceiling per cell — the same 90s budget `/forge-seeker` runs
 *  under, imported from the route's own constant (budgets.ts has zero
 *  imports, so this is spend-guard-safe) — a hung provider cannot wedge a
 *  run, and the eval can never drift from the route's real budget. */
const CELL_TIMEOUT_MS = TIME_BUDGET_MS.chatTurn

/**
 * The key-hygiene mechanism, factored for direct unit testing. Operates on an
 * injected env record; the CLI passes `process.env`. Order matters: the
 * PAID-key refusal fires even when the eval key is present, because a run
 * that COULD bill the wrong credential must stop, not proceed on good luck.
 */
export function pinEvalKey(env: Record<string, string | undefined>): {
  key: string
} {
  const paid = env.OPENROUTER_API_PAID_KEY
  if (paid != null && paid.trim().length > 0) {
    throw new Error(
      "OPENROUTER_API_PAID_KEY is set in this environment — refusing to run. " +
        "Mastra's model router reads ambient OpenRouter keys, and the eval " +
        "must never be able to bill a production credential. Unset it (or run " +
        "in a shell without it) and retry.",
    )
  }
  const key = env[KEY_VARIABLE]?.trim()
  if (key == null || key.length === 0) {
    throw new Error(keyHelpText())
  }
  // The pin: Mastra's `openrouter/...` provider reads OPENROUTER_API_KEY, so
  // it is OVERWRITTEN with the eval key — an ambient dev key in .env.local
  // can no longer be what the router bills.
  env.OPENROUTER_API_KEY = key
  return { key }
}

/** One cell's full transcript — the run's raw observable record. */
export type LoopTranscriptCell = {
  questionId: string
  model: string
  sampleId: string
  toolCalls: Array<
    FixtureSearchCall & {
      /** Exactly what the tool served for this call — the frozen passages. */
      servedPassages: RagFixture["result"]
    }
  >
  text: string | null
  finishReason: string | null
  usage: { input: number; output: number } | null
  costUsd: number | null
  latencyMs: number
  error?: string
}

export type LoopTranscriptFile = {
  kind: "seeker-eval-transcripts"
  startedAt: string
  finishedAt: string
  /** The RESOLVED prompt this run generated under, verbatim + provenance. */
  resolvedPrompt: {
    text: string
    sha256: string
    source: "langfuse" | "fallback"
    langfuseVersion: number | null
    langfuseLabel: string | null
  }
  identity: RunIdentity
  cells: LoopTranscriptCell[]
}

async function runCell(input: {
  agent: {
    generate: (
      message: string,
      options: {
        memory: { thread: string; resource: string }
        abortSignal: AbortSignal
      },
    ) => Promise<{
      text: string
      finishReason?: string
      totalUsage?: { inputTokens?: number; outputTokens?: number }
      error?: Error | undefined
    }>
  }
  question: Question
  model: AnsweringModel
  sampleId: string
  calls: Array<FixtureSearchCall>
  fixture: RagFixture
}): Promise<{ record: AnswerRecord; transcript: LoopTranscriptCell }> {
  const { agent, question, model, sampleId, calls, fixture } = input
  const startedAt = Date.now()

  let outcome:
    | {
        ok: true
        text: string
        finishReason: string | null
        usage: { input: number; output: number }
      }
    | { ok: false; error: string }
  try {
    // Decision 2026-08-04 (#14): NO decoding pin here — the gating run must
    // sample exactly the distribution production serves, and nothing on the
    // production chain sets temperature or token caps. Run identity stamps
    // `decoding: null` (provider defaults) so pinned-era artifacts refuse to
    // compare against these runs.
    const result = await agent.generate(question.text, {
      memory: {
        thread: `seeker-eval-${sampleId}-${question.id}-${model.label}`,
        resource: "seeker-eval",
      },
      abortSignal: AbortSignal.timeout(CELL_TIMEOUT_MS),
    })
    if (result.error) throw result.error
    outcome = {
      ok: true,
      text: result.text,
      finishReason: result.finishReason ?? null,
      usage: {
        input: result.totalUsage?.inputTokens ?? 0,
        output: result.totalUsage?.outputTokens ?? 0,
      },
    }
  } catch (cause) {
    outcome = {
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    }
  }
  const latencyMs = Date.now() - startedAt

  // `calls` is filled by the tool recorder DURING generate, so these
  // projections must run after it settles — shared by both outcomes.
  const toolCalls: ToolCallRecord[] = calls.map((call) => ({
    name: call.name,
    arguments: call.arguments,
    servedFrom: call.servedFrom,
    queryDrift: call.queryDrift,
  }))
  const transcriptToolCalls = calls.map((call) => ({
    ...call,
    servedPassages: fixture.result,
  }))

  const base = {
    questionId: question.id,
    category: question.category,
    model: model.id,
  }
  const record: AnswerRecord = outcome.ok
    ? {
        ...base,
        ok: true,
        text: outcome.text,
        finishReason: outcome.finishReason,
        usage: outcome.usage,
        costUsd: costUsd(model.id, outcome.usage),
        latencyMs,
        toolCalls,
        // THE measurement injected mode cannot make: did the model, free to
        // choose, actually retrieve?
        skippedTool: calls.length === 0,
      }
    : {
        ...base,
        ok: false,
        text: null,
        finishReason: null,
        usage: null,
        costUsd: null,
        latencyMs,
        error: outcome.error,
        toolCalls,
        skippedTool: calls.length === 0,
      }
  return {
    record,
    transcript: {
      questionId: question.id,
      model: model.id,
      sampleId,
      toolCalls: transcriptToolCalls,
      text: outcome.ok ? outcome.text : null,
      finishReason: outcome.ok ? outcome.finishReason : null,
      usage: outcome.ok ? outcome.usage : null,
      costUsd: record.costUsd,
      latencyMs,
      ...(outcome.ok ? {} : { error: outcome.error }),
    },
  }
}

async function main(): Promise<void> {
  // Key hygiene FIRST — before the agent module (and with it Mastra's model
  // router) is ever imported. loadEnvFiles() never overwrites existing env.
  loadEnvFiles()
  pinEvalKey(process.env)

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
  const transcriptsPath = resolve(
    process.cwd(),
    flag(argv, "transcripts") ?? resolve(DEFAULT_RUNS_DIR, "transcripts.json"),
  )

  // A gating run with a fixture hole is a setup fault, not a finding.
  const missing = questions.filter(
    (question) =>
      !fixtures.fixtures.some((fixture) => fixture.questionId === question.id),
  )
  if (missing.length > 0) {
    throw new Error(
      `no RAG fixture for ${missing.map((q) => q.id).join(", ")} — run eval:seeker:capture-rag against a live RAG first`,
    )
  }

  // Import the production seam ONLY after the key pin above — the agent
  // module's top level evaluates the whole Mastra model-router chain
  // (finding #13). Resolve instructions ONCE through the SAME helper the
  // agent's own resolver uses, then inject that exact whole prompt into every
  // cell. This is load-bearing: a run can cross the helper's TTL (or a label
  // can move) between cells, so resolving independently per fresh agent could
  // make identity stamp one prompt while later cells generate under another.
  // The prompt constants and section mapping are static imports: they come
  // from the dependency-free `seeker-prompt` leaf, never the agent chain.
  const [
    { buildSeekerAgent },
    langfuse,
    fixtureRag,
    memoryModule,
    storageModule,
  ] = await Promise.all([
    import("../../mastra/agents/seeker-agent"),
    import("../../services/langfuse-prompt-client"),
    import("./fixture-rag"),
    import("@mastra/memory"),
    import("@mastra/core/storage"),
  ])

  const resolvedPrompt = await langfuse.getManagedPrompt({
    name: SEEKER_SYSTEM_PROMPT_NAME,
    fallback: SEEKER_SYSTEM_PROMPT_FALLBACK,
  })

  const identity: RunIdentity = {
    promptSha256: sha256(resolvedPrompt.text),
    promptSource: resolvedPrompt.source,
    promptLangfuseVersion: resolvedPrompt.version ?? null,
    promptLangfuseLabel:
      resolvedPrompt.source === "langfuse"
        ? resolvedPrompt.resolvedLabel
        : null,
    sectionMappingVersion: SECTION_MAPPING_VERSION,
    questionSetId: QUESTION_SET_ID,
    questionIds: questions.map((question) => question.id),
    criteriaSha256: criteriaHash(questions),
    answeringModels: models.map((model) => model.id),
    // null = provider-default sampling (decision 2026-08-04 #14) — the same
    // distribution production serves. Legacy-tolerant refusal: types.ts
    // treats null-vs-pinned as a "decoding parameters" mismatch, so the
    // pinned 0.7/1600-era artifacts can never silently compare.
    decoding: null,
    sampleId,
    gitSha: gitSha(),
    retrieval: {
      mode: "tool-loop",
      corpusSha256: fixtures.corpusSha256,
      topK: fixtures.topK,
    },
    judge: null,
  }

  console.log(
    `prompt   : ${identity.promptSource} (${identity.promptSha256.slice(0, 12)})` +
      (identity.promptLangfuseVersion != null
        ? ` v${identity.promptLangfuseVersion} @${identity.promptLangfuseLabel}`
        : ""),
  )
  console.log(`sections : ${SECTION_MAPPING_VERSION}`)
  console.log(`questions: ${questions.length} of ${QUESTIONS.length}`)
  console.log(`models   : ${models.map((model) => model.id).join(", ")}`)
  console.log(`cells    : ${questions.length * models.length}`)
  console.log(
    `retrieval: REAL TOOL LOOP over frozen fixtures · corpus ${fixtures.corpusSha256.slice(0, 12)} · topK ${fixtures.topK}`,
  )
  console.log("")

  const startedAt = new Date().toISOString()
  const answers: AnswerRecord[] = []
  const transcriptCells: LoopTranscriptCell[] = []

  for (const question of questions) {
    const fixture = fixtures.fixtures.find(
      (candidate) => candidate.questionId === question.id,
    )
    if (!fixture) continue // unreachable — pre-checked above
    for (const model of models) {
      process.stdout.write(`  ${question.id} x ${model.label} ... `)
      const calls: FixtureSearchCall[] = []
      // A FRESH agent per cell: per-cell model pin, per-cell recorder, and a
      // fresh in-memory store so no thread state leaks between cells.
      const agent = buildSeekerAgent({
        ragSearch: fixtureRag.buildFixtureSearch({
          fixture,
          questionText: question.text,
          onCall: (call) => calls.push(call),
        }),
        models: [{ model: `openrouter/${model.id}`, maxRetries: 1 }],
        memory: new memoryModule.Memory({
          storage: new storageModule.InMemoryStore(),
        }),
        instructions: resolvedPrompt.text,
      })
      const { record, transcript } = await runCell({
        agent,
        question,
        model,
        sampleId,
        calls,
        fixture,
      })
      answers.push(record)
      transcriptCells.push(transcript)
      if (record.ok) {
        const drift = calls.some((call) => call.queryDrift) ? " DRIFT" : ""
        const skipped = record.skippedTool ? " TOOL-SKIPPED" : ""
        const truncated = record.finishReason === "length" ? " TRUNCATED" : ""
        console.log(
          `${record.text?.length ?? 0} chars, ${calls.length} tool call(s), ${record.latencyMs}ms${skipped}${drift}${truncated}`,
        )
      } else {
        console.log(`FAILED — ${record.error}`)
      }
    }
  }

  const finishedAt = new Date().toISOString()
  const run: AnswerRun = {
    kind: ANSWER_RUN_KIND,
    startedAt,
    finishedAt,
    identity,
    answers,
  }
  const transcripts: LoopTranscriptFile = {
    kind: "seeker-eval-transcripts",
    startedAt,
    finishedAt,
    resolvedPrompt: {
      text: resolvedPrompt.text,
      sha256: identity.promptSha256,
      source: identity.promptSource,
      langfuseVersion: identity.promptLangfuseVersion,
      langfuseLabel: identity.promptLangfuseLabel,
    },
    identity,
    cells: transcriptCells,
  }

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(run, null, 2)}\n`, "utf8")
  await mkdir(dirname(transcriptsPath), { recursive: true })
  await writeFile(
    transcriptsPath,
    `${JSON.stringify(transcripts, null, 2)}\n`,
    "utf8",
  )

  const failed = answers.filter((answer) => !answer.ok).length
  const skipped = answers.filter((answer) => answer.skippedTool).length
  const drifted = transcriptCells.filter((cell) =>
    cell.toolCalls.some((call) => call.queryDrift),
  ).length
  const known = answers.filter((answer) => answer.costUsd != null)
  const totalUsd = known.reduce((sum, answer) => sum + (answer.costUsd ?? 0), 0)

  console.log("")
  console.log(`wrote ${outPath}`)
  console.log(`wrote ${transcriptsPath}`)
  console.log(
    `${answers.length} cells, ${failed} failed, ${skipped} tool-skipped, ${drifted} query-drift, ~$${totalUsd.toFixed(4)}`,
  )

  // Wholesale collapse is an infrastructure outage, not a measurement. The
  // artifacts stay on disk for debugging, but the exit code must stop a
  // pipeline from handing an all-error run to the judge and gate as if a run
  // had happened.
  if (answers.length > 0 && failed === answers.length) {
    console.error(
      "every cell failed — refusing to hand an all-error run downstream (exit 1)",
    )
    process.exitCode = 1
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
