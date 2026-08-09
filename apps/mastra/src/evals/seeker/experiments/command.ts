#!/usr/bin/env tsx
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { experimentCommandArgs } from "../cli"
import { resolveExactManagedPrompt } from "../../../services/langfuse-prompt-client"
import { ResolvedIdentitySchema, type ResolvedIdentity } from "./types"
import { runExperiment } from "./runner"

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const MASTRA_ROOT = resolve(MODULE_DIR, "../../../..")
const REPO_ROOT = resolve(MASTRA_ROOT, "../..")
const DEFAULT_EXPERIMENTS_ROOT = resolve(
  REPO_ROOT,
  "docs/seeker-eval-experiments",
)
const DEFAULT_FIXTURES = resolve(MODULE_DIR, "../fixtures/rag-fixtures.json")

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"))
}

async function loadBenchmarkIdentity(path: string): Promise<ResolvedIdentity> {
  const value = await loadJson(resolve(REPO_ROOT, path))
  const candidate = (value as { identity?: unknown }).identity ?? value
  return ResolvedIdentitySchema.parse(candidate)
}

async function runLeaf(
  script: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; accepted?: number[] } = {},
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
      { stdio: "inherit", env: { ...process.env, ...options.env } },
    )
    child.once("error", reject)
    child.once("exit", (code) => {
      if ((options.accepted ?? [0]).includes(code ?? -1)) resolvePromise()
      else reject(new Error(`${script} exited with ${code ?? "no status"}`))
    })
  })
}

async function generateEvidence(
  input: Parameters<
    NonNullable<Parameters<typeof runExperiment>[0]["generate"]>
  >[0],
): Promise<Record<string, unknown | string>> {
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
    const baselineDir = baselinePath.endsWith(".json")
      ? dirname(baselinePath)
      : baselinePath

    for (const candidate of input.manifest.candidates) {
      const candidateDir = join(scratch, candidate.id)
      const prompt = candidate.identity.prompt
      const promptText = input.resolvedPromptTexts[candidate.id]
      if (promptText == null)
        throw new Error(`resolved prompt text missing for ${candidate.id}`)
      const models = candidate.identity.model.routes
        .map((route) => route.model)
        .join(",")
      await runLeaf(
        "src/evals/seeker/run-loop.ts",
        [
          `--out=${join(candidateDir, "answers.json")}`,
          `--transcripts=${join(candidateDir, "transcripts.json")}`,
          `--fixtures=${DEFAULT_FIXTURES}`,
          `--models=${models}`,
          `--prompt-version=${prompt.revision}`,
          `--prompt-hash=${prompt.contentHash}`,
        ],
        { env: { SEEKER_EVAL_RESOLVED_PROMPT: promptText } },
      )
      await runLeaf("src/evals/seeker/run-judge.ts", [
        `--in=${join(candidateDir, "answers.json")}`,
        `--out=${join(candidateDir, "judged.json")}`,
        `--fixtures=${DEFAULT_FIXTURES}`,
      ])
      await runLeaf("src/evals/seeker/run-score.ts", [
        `--in=${join(candidateDir, "judged.json")}`,
        `--out=${join(candidateDir, "score.json")}`,
      ])
      await runLeaf(
        "src/evals/seeker/run-gate.ts",
        [
          `--current-dir=${candidateDir}`,
          `--baseline-dir=${baselineDir}`,
          `--out=${join(candidateDir, "gate-report.json")}`,
          `--fixtures=${DEFAULT_FIXTURES}`,
        ],
        { accepted: [0, 1, 2] },
      )

      answers[candidate.id] = await loadJson(join(candidateDir, "answers.json"))
      const transcript = (await loadJson(
        join(candidateDir, "transcripts.json"),
      )) as { resolvedPrompt?: Record<string, unknown> }
      if (transcript.resolvedPrompt) delete transcript.resolvedPrompt.text
      transcripts[candidate.id] = transcript
      judged[candidate.id] = await loadJson(join(candidateDir, "judged.json"))
      scores[candidate.id] = await loadJson(join(candidateDir, "score.json"))
      gates[candidate.id] = await loadJson(
        join(candidateDir, "gate-report.json"),
      )
    }
    const rows = input.manifest.candidates.map((candidate) => {
      const gate = gates[candidate.id] as { verdict?: string }
      return `| ${candidate.id} | ${gate.verdict ?? "unknown"} |`
    })
    return {
      "answers.json": {
        schemaVersion: "seeker-experiment-answers/v1",
        candidates: answers,
      },
      "transcripts.json": {
        schemaVersion: "seeker-experiment-transcripts/v1",
        candidates: transcripts,
      },
      "judged.json": {
        schemaVersion: "seeker-experiment-judged/v1",
        candidates: judged,
      },
      "score.json": {
        schemaVersion: "seeker-experiment-scores/v1",
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
