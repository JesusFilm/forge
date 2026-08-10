#!/usr/bin/env tsx
/**
 * Seeker eval — STEP 5. The delta-gate runner: parse flags, load the run
 * artifacts, call `evaluateGate` (gate.ts — the policy and what reds /
 * reports / refuses live there), print the verdict, and set the exit code
 * (0 green, 1 red, 2 refused).
 *
 *   pnpm --filter @forge/mastra eval:seeker:gate
 *   pnpm --filter @forge/mastra eval:seeker:gate -- --baseline-dir=apps/mastra/evals/results/seeker-baseline
 *   pnpm --filter @forge/mastra eval:seeker:gate -- --confirm-judged=apps/mastra/eval-runs/seeker-confirm/judged.json
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { flag, loadAnswersFile, loadFixtures, loadJudgedFile } from "./cli"
import { DEFAULT_SCORE_TOLERANCE, evaluateGate } from "./gate"

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_RUNS_DIR = resolve(MODULE_DIR, "../../../eval-runs/seeker")
const DEFAULT_BASELINE_DIR = resolve(
  MODULE_DIR,
  "../../../evals/results/seeker-baseline",
)
const DEFAULT_FIXTURES = resolve(MODULE_DIR, "fixtures/rag-fixtures.json")

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const currentDir = resolve(
    process.cwd(),
    flag(argv, "current-dir") ?? DEFAULT_RUNS_DIR,
  )
  const baselineDir = resolve(
    process.cwd(),
    flag(argv, "baseline-dir") ?? DEFAULT_BASELINE_DIR,
  )
  const toleranceRaw = flag(argv, "tolerance")
  const tolerance = toleranceRaw
    ? Number(toleranceRaw)
    : DEFAULT_SCORE_TOLERANCE
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error("--tolerance must be a non-negative number")
  }
  const outPath = resolve(
    process.cwd(),
    flag(argv, "out") ?? resolve(DEFAULT_RUNS_DIR, "gate-report.json"),
  )
  // Deliberate legacy-replay escape only (finding #11) — without it a
  // fixture file whose corpus differs from the runs' stamp REFUSES.
  const allowCorpusMismatch = argv.includes("--allow-corpus-mismatch")
  const experimentAxis = flag(argv, "experiment-axis")
  if (
    experimentAxis != null &&
    experimentAxis !== "prompt" &&
    experimentAxis !== "model"
  )
    throw new Error("--experiment-axis must be prompt or model")

  const [
    currentAnswers,
    currentJudged,
    baselineAnswers,
    baselineJudged,
    fixtures,
  ] = await Promise.all([
    loadAnswersFile(resolve(currentDir, "answers.json")),
    loadJudgedFile(resolve(currentDir, "judged.json")),
    loadAnswersFile(resolve(baselineDir, "answers.json")),
    loadJudgedFile(resolve(baselineDir, "judged.json")),
    loadFixtures(
      resolve(process.cwd(), flag(argv, "fixtures") ?? DEFAULT_FIXTURES),
    ),
  ])

  // Second independent judged run for flip confirmation (decision #7).
  const confirmPath = flag(argv, "confirm-judged")
  const confirmJudged = confirmPath
    ? await loadJudgedFile(resolve(process.cwd(), confirmPath))
    : null

  const report = evaluateGate({
    current: { answers: currentAnswers, judged: currentJudged },
    baseline: { answers: baselineAnswers, judged: baselineJudged },
    fixtures,
    allowCorpusMismatch,
    confirmJudged,
    scoreTolerance: tolerance,
    ...(experimentAxis ? { experimentAxis } : {}),
  })

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")

  console.log(`gate    : ${report.verdict.toUpperCase()}`)
  if (report.refusedOn.length > 0) {
    console.log(`refused : ${report.refusedOn.join("; ")}`)
  }
  if (report.promptChanged) {
    console.log(
      `prompt  : CHANGED ${report.promptChanged.baselineSha256.slice(0, 12)} → ${report.promptChanged.currentSha256.slice(0, 12)} (the subject under test)`,
    )
  }
  for (const fail of report.newHardFails) {
    console.log(
      `RED     : ${fail.questionId} x ${fail.model} — ${fail.checkId}${fail.details.length > 0 ? ` (${fail.details.join("; ")})` : ""}`,
    )
  }
  if (report.toolSkipPooled.regression) {
    console.log(
      `RED     : ${report.toolSkipPooled.currentCount} tool skip(s) in the current run — any skip is a hard fail (decision 2026-08-04)`,
    )
  }
  for (const delta of report.toolSkipDeltas) {
    if (delta.currentCount > 0 || delta.baselineCount > 0) {
      console.log(
        `skips   : ${delta.model} — ${delta.baselineCount} → ${delta.currentCount}${delta.currentCells.length > 0 ? ` (${delta.currentCells.join(", ")})` : ""}`,
      )
    }
  }
  for (const flip of report.confirmedGroundingFlips) {
    console.log(
      `RED     : ${flip.questionId} x ${flip.model} — grounding criterion ${flip.criterionId} flipped violated in BOTH runs (confirmed)`,
    )
  }
  for (const flip of report.unconfirmedGroundingFlips) {
    console.log(
      `noise   : ${flip.questionId} x ${flip.model} — grounding criterion ${flip.criterionId} flipped in the first run only (unconfirmed — not gated)`,
    )
  }
  if (report.promptChanged == null) {
    for (const flip of report.groundingFlips) {
      console.log(
        `triage  : ${flip.questionId} x ${flip.model} — grounding criterion ${flip.criterionId} flipped violated (prompt unchanged — sampling noise, not gated)`,
      )
    }
  }
  for (const fail of report.carriedKnownFails) {
    console.log(
      `carried : ${fail.questionId} x ${fail.model} — ${fail.checkId} (known-fail, also in baseline)`,
    )
  }
  for (const delta of report.formatDeltas) {
    if (delta.currentCount > 0 || delta.baselineCount > 0) {
      console.log(
        `format  : ${delta.model} — ${delta.checkId} ${delta.baselineCount} → ${delta.currentCount}${delta.currentCells.length > 0 ? ` (${delta.currentCells.join(", ")})` : ""}`,
      )
    }
  }
  for (const flip of report.triageFlips) {
    console.log(
      `triage  : ${flip.questionId} x ${flip.model} — ${flip.criterionClass} criterion ${flip.criterionId} flipped violated`,
    )
  }
  if (report.scoreDelta.delta != null) {
    console.log(
      `score   : ${report.scoreDelta.baseline?.toFixed(4)} → ${report.scoreDelta.current?.toFixed(4)} (Δ ${report.scoreDelta.delta.toFixed(4)}${report.scoreDelta.beyondTolerance ? " — BEYOND TOLERANCE, triage" : ""})`,
    )
  }
  console.log(`wrote ${outPath}`)

  if (report.verdict === "refused") process.exitCode = 2
  else if (report.verdict === "red") process.exitCode = 1
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
