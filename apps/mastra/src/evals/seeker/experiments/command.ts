#!/usr/bin/env tsx
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { experimentCommandArgs } from "../cli"
import { resolveExactManagedPrompt } from "../../../services/langfuse-prompt-client"
import { ResolvedIdentitySchema, type ResolvedIdentity } from "./types"
import type { RunIdentity } from "../types"
import { runExperiment, type GeneratedEvidence } from "./runner"

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const MASTRA_ROOT = resolve(MODULE_DIR, "../../../..")
const REPO_ROOT = resolve(MASTRA_ROOT, "../..")
const DEFAULT_EXPERIMENTS_ROOT = resolve(MASTRA_ROOT, "evals/experiments")
const DEFAULT_FIXTURES = resolve(MODULE_DIR, "../fixtures/rag-fixtures.json")

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"))
}

export async function loadBenchmarkIdentity(
  path: string,
): Promise<ResolvedIdentity> {
  const value = await loadJson(resolve(REPO_ROOT, path))
  const candidate = (value as { identity?: unknown }).identity ?? value
  return ResolvedIdentitySchema.parse(candidate)
}

export function serializeSupportedModelRoutes(
  routes: ResolvedIdentity["model"]["routes"],
): string {
  for (const route of routes) {
    if (
      route.provider !== "openrouter" ||
      route.endpoint !== "model-router" ||
      route.baseUrl != null ||
      route.timeoutMs != null ||
      route.configurationHash != null
    )
      throw new Error(
        `unsupported model route identity: ${route.provider}/${route.endpoint}`,
      )
  }
  return JSON.stringify(routes)
}

const LEAF_TIMEOUT_MS = 30 * 60_000
const LEAF_TERMINATION_GRACE_MS = 5_000

function stopChild(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
): void {
  if (child.pid != null && process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // Fall through to the direct child when process-group signalling fails.
    }
  }
  child.kill(signal)
}

export async function runLeaf(
  script: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv
    accepted?: number[]
    timeoutMs?: number
    terminationGraceMs?: number
  } = {},
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      "pnpm",
      [
        "--dir",
        REPO_ROOT,
        "exec",
        "tsx",
        resolve(MASTRA_ROOT, script),
        ...args,
      ],
      {
        stdio: "inherit",
        env: { ...process.env, ...options.env },
        detached: process.platform !== "win32",
      },
    )
    let settled = false
    let timedOut = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      clearTimeout(escalation)
      if (error) reject(error)
      else resolvePromise()
    }
    let escalation: NodeJS.Timeout | undefined
    const deadline = setTimeout(() => {
      timedOut = true
      stopChild(child, "SIGTERM")
      escalation = setTimeout(() => {
        stopChild(child, "SIGKILL")
        finish(new Error(`${script} exceeded its overall deadline`))
      }, options.terminationGraceMs ?? LEAF_TERMINATION_GRACE_MS)
    }, options.timeoutMs ?? LEAF_TIMEOUT_MS)
    child.once("error", (cause) => finish(cause))
    child.once("exit", (code) => {
      if (timedOut) finish(new Error(`${script} exceeded its overall deadline`))
      else if ((options.accepted ?? [0]).includes(code ?? -1)) finish()
      else finish(new Error(`${script} exited with ${code ?? "no status"}`))
    })
  })
}

function expectedAnsweringModels(identity: ResolvedIdentity): string[] {
  return [
    identity.model.routes
      .map((route) => route.model.replace(/^openrouter\//, ""))
      .join(" -> "),
  ]
}

export function assertExecutedIdentity(
  actual: RunIdentity,
  expected: ResolvedIdentity,
  includeJudge: boolean,
): void {
  const mismatches: string[] = []
  if (
    actual.promptSource !== "langfuse" ||
    actual.promptLangfuseVersion !== Number(expected.prompt.revision) ||
    actual.promptSha256 !== expected.prompt.contentHash
  )
    mismatches.push("prompt")
  if (
    actual.questionSetId !== expected.questionSet.id ||
    actual.questionIds.join(",") !== expected.questionSet.questionIds.join(",")
  )
    mismatches.push("question set")
  if (
    actual.answeringModels.join(",") !==
    expectedAnsweringModels(expected).join(",")
  )
    mismatches.push("model routes")
  const expectedDecoding =
    expected.decoding.mode === "provider-default"
      ? null
      : {
          temperature: expected.decoding.temperature,
          maxTokens: expected.decoding.maxTokens,
        }
  if (
    JSON.stringify(actual.decoding ?? null) !== JSON.stringify(expectedDecoding)
  )
    mismatches.push("decoding")
  const retrieval = actual.retrieval
  if (
    retrieval.mode !== expected.retrieval.mode ||
    (retrieval.mode !== "none" &&
      expected.retrieval.mode !== "none" &&
      (retrieval.corpusSha256 !== expected.retrieval.corpusHash ||
        retrieval.topK !== expected.retrieval.topK))
  )
    mismatches.push("retrieval")
  if (actual.runtimeConfigurationHash !== expected.runtime.configurationHash)
    mismatches.push("runtime")
  if (includeJudge) {
    if (actual.criteriaSha256 !== expected.criteria.contentHash)
      mismatches.push("criteria")
    if (
      actual.judge?.model !== expected.judge.model ||
      actual.judge?.rubricSha256 !== expected.judge.rubricHash
    )
      mismatches.push("judge")
  }
  if (mismatches.length > 0)
    throw new Error(
      `executed evidence identity does not match manifest: ${mismatches.join(", ")}`,
    )
}

export async function generateEvidence(
  input: Parameters<
    NonNullable<Parameters<typeof runExperiment>[0]["generate"]>
  >[0],
  dependencies: { runLeaf?: typeof runLeaf } = {},
): Promise<GeneratedEvidence> {
  const executeLeaf = dependencies.runLeaf ?? runLeaf
  if (input.reuseAttemptDir != null) {
    return Object.fromEntries(
      await Promise.all(
        [
          "answers.json",
          "transcripts.json",
          "judged.json",
          "score.json",
          "comparison.md",
          "gate-report.json",
        ].map(async (path) => [
          path,
          path.endsWith(".json")
            ? await loadJson(join(input.reuseAttemptDir!, path))
            : await readFile(join(input.reuseAttemptDir!, path), "utf8"),
        ]),
      ),
    )
  }
  const scratch = await mkdtemp(join(tmpdir(), "seeker-official-attempt-"))
  try {
    const answers: Record<string, unknown> = {}
    const transcripts: Record<string, unknown> = {}
    const judged: Record<string, unknown> = {}
    const scores: Record<string, unknown> = {}
    const gates: Record<string, unknown> = {}
    const baselinePath = resolve(
      REPO_ROOT,
      input.manifest.productionBenchmark.path,
    )
    let baselineDir = baselinePath.endsWith(".json")
      ? dirname(baselinePath)
      : baselinePath

    let capturedBaseline:
      | {
          answers: unknown
          transcripts: unknown
          judged: unknown
          score: unknown
        }
      | undefined
    if (input.manifest.productionBenchmark.captureExactManaged) {
      const promptText = input.resolvedProductionPromptText
      if (promptText == null)
        throw new Error("resolved production benchmark prompt text missing")
      baselineDir = join(scratch, "production-benchmark")
      const prompt = input.manifest.productionBenchmark.identity.prompt
      const modelRoutes = serializeSupportedModelRoutes(
        input.manifest.productionBenchmark.identity.model.routes,
      )
      await executeLeaf(
        "src/evals/seeker/run-loop.ts",
        [
          `--out=${join(baselineDir, "answers.json")}`,
          `--transcripts=${join(baselineDir, "transcripts.json")}`,
          `--fixtures=${DEFAULT_FIXTURES}`,
          `--model-routes=${modelRoutes}`,
          `--prompt-version=${prompt.revision}`,
          `--prompt-hash=${prompt.contentHash}`,
          `--runtime-hash=${input.manifest.productionBenchmark.identity.runtime.configurationHash}`,
        ],
        { env: { SEEKER_EVAL_RESOLVED_PROMPT: promptText } },
      )
      await executeLeaf("src/evals/seeker/run-judge.ts", [
        `--in=${join(baselineDir, "answers.json")}`,
        `--out=${join(baselineDir, "judged.json")}`,
        `--fixtures=${DEFAULT_FIXTURES}`,
      ])
      await executeLeaf("src/evals/seeker/run-score.ts", [
        `--in=${join(baselineDir, "judged.json")}`,
        `--out=${join(baselineDir, "score.json")}`,
      ])
      capturedBaseline = {
        answers: await loadJson(join(baselineDir, "answers.json")),
        transcripts: await loadJson(join(baselineDir, "transcripts.json")),
        judged: await loadJson(join(baselineDir, "judged.json")),
        score: await loadJson(join(baselineDir, "score.json")),
      }
      assertExecutedIdentity(
        (capturedBaseline.answers as { identity: RunIdentity }).identity,
        input.manifest.productionBenchmark.identity,
        false,
      )
      assertExecutedIdentity(
        (capturedBaseline.judged as { identity: RunIdentity }).identity,
        input.manifest.productionBenchmark.identity,
        true,
      )
    }

    for (const candidate of input.manifest.candidates) {
      const candidateDir = join(scratch, candidate.id)
      const prompt = candidate.identity.prompt
      const promptText = input.resolvedPromptTexts[candidate.id]
      if (promptText == null)
        throw new Error(`resolved prompt text missing for ${candidate.id}`)
      const modelRoutes = serializeSupportedModelRoutes(
        candidate.identity.model.routes,
      )
      await executeLeaf(
        "src/evals/seeker/run-loop.ts",
        [
          `--out=${join(candidateDir, "answers.json")}`,
          `--transcripts=${join(candidateDir, "transcripts.json")}`,
          `--fixtures=${DEFAULT_FIXTURES}`,
          `--model-routes=${modelRoutes}`,
          `--prompt-version=${prompt.revision}`,
          `--prompt-hash=${prompt.contentHash}`,
          `--runtime-hash=${candidate.identity.runtime.configurationHash}`,
        ],
        { env: { SEEKER_EVAL_RESOLVED_PROMPT: promptText } },
      )
      await executeLeaf("src/evals/seeker/run-judge.ts", [
        `--in=${join(candidateDir, "answers.json")}`,
        `--out=${join(candidateDir, "judged.json")}`,
        `--fixtures=${DEFAULT_FIXTURES}`,
      ])
      await executeLeaf("src/evals/seeker/run-score.ts", [
        `--in=${join(candidateDir, "judged.json")}`,
        `--out=${join(candidateDir, "score.json")}`,
      ])
      await executeLeaf(
        "src/evals/seeker/run-gate.ts",
        [
          `--current-dir=${candidateDir}`,
          `--baseline-dir=${baselineDir}`,
          `--out=${join(candidateDir, "gate-report.json")}`,
          `--fixtures=${DEFAULT_FIXTURES}`,
          `--experiment-axis=${input.manifest.comparisonAxis}`,
        ],
        { accepted: [0, 1, 2] },
      )

      answers[candidate.id] = await loadJson(join(candidateDir, "answers.json"))
      transcripts[candidate.id] = await loadJson(
        join(candidateDir, "transcripts.json"),
      )
      judged[candidate.id] = await loadJson(join(candidateDir, "judged.json"))
      scores[candidate.id] = await loadJson(join(candidateDir, "score.json"))
      gates[candidate.id] = await loadJson(
        join(candidateDir, "gate-report.json"),
      )
      assertExecutedIdentity(
        (answers[candidate.id] as { identity: RunIdentity }).identity,
        candidate.identity,
        false,
      )
      assertExecutedIdentity(
        (judged[candidate.id] as { identity: RunIdentity }).identity,
        candidate.identity,
        true,
      )
    }
    const rows = input.manifest.candidates.map((candidate) => {
      const gate = gates[candidate.id] as { verdict?: string }
      return `| ${candidate.id} | ${gate.verdict ?? "unknown"} |`
    })
    return {
      "answers.json": {
        schemaVersion: "seeker-experiment-answers/v1",
        ...(capturedBaseline
          ? { productionBenchmark: capturedBaseline.answers }
          : {}),
        candidates: answers,
      },
      "transcripts.json": {
        schemaVersion: "seeker-experiment-transcripts/v1",
        ...(capturedBaseline
          ? { productionBenchmark: capturedBaseline.transcripts }
          : {}),
        candidates: transcripts,
      },
      "judged.json": {
        schemaVersion: "seeker-experiment-judged/v1",
        ...(capturedBaseline
          ? { productionBenchmark: capturedBaseline.judged }
          : {}),
        candidates: judged,
      },
      "score.json": {
        schemaVersion: "seeker-experiment-scores/v1",
        ...(capturedBaseline
          ? { productionBenchmark: capturedBaseline.score }
          : {}),
        candidates: scores,
      },
      "gate-report.json": {
        schemaVersion: "seeker-experiment-gates/v1",
        candidates: gates,
      },
      "comparison.md": [
        "# Experiment comparison",
        "",
        "| candidate | gate |",
        "| --- | --- |",
        ...rows,
        "",
      ].join("\n"),
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = experimentCommandArgs(argv)
  const experimentDir = resolve(process.cwd(), args.experimentDir)
  const experimentsRoot = resolve(
    process.cwd(),
    args.experimentsRoot ?? DEFAULT_EXPERIMENTS_ROOT,
  )
  const result = await runExperiment({
    experimentsRoot,
    experimentDir,
    attemptId: args.attemptId,
    ...(args.reuseAttemptId ? { reuseAttemptId: args.reuseAttemptId } : {}),
    loadBenchmarkIdentity,
    resolvePrompt: async (prompt) => {
      if (prompt.provider !== "langfuse")
        return {
          ok: false,
          reason: `unsupported prompt provider ${prompt.provider}`,
        }
      const version = Number(prompt.revision)
      const resolved = await resolveExactManagedPrompt({
        name: prompt.name,
        version,
        expectedContentHash: prompt.contentHash,
      })
      return resolved.ok
        ? {
            ok: true,
            revision: resolved.identity.revision,
            contentHash: resolved.identity.contentHash,
            text: resolved.text,
          }
        : {
            ok: false,
            reason: `${resolved.reason}${resolved.detail ? `/${resolved.detail}` : ""}`,
          }
    },
    generate: generateEvidence,
  })
  console.log(`completed immutable experiment attempt at ${result.attemptDir}`)
}

if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exitCode = 1
  })
}
