#!/usr/bin/env tsx
/**
 * Seeker eval — STEP 5. The delta gate: compare a candidate run against the
 * committed baseline and decide green / red / refused.
 *
 * WHAT REDS (deterministic-first, decision doc §3 "Delta gating"):
 *   1. A NEW per-cell ungrounded-citation violation (URL on a never-served
 *      host, or an invented source name) — a cell violated now that was not
 *      violated in the baseline. Violations present in BOTH runs are
 *      "carried known-fails": reported, never red, expiring structurally —
 *      a model-config change breaks identity, forcing a fresh baseline
 *      (the decision doc's expiry pin).
 *   2. ANY tool skip when the BASELINE was skip-free (pooled across models).
 *      While the baseline itself skips, skip magnitude is report-only —
 *      see the measured-counts comment at the rule.
 *   3. A judge-verdict flip (baseline satisfied → current violated) on a
 *      GROUNDING-class criterion (weights.ts) WHEN THE PROMPT CHANGED — the
 *      criteria the gate treats as load-bearing (the same set gate 2's
 *      repeatability milestone demands zero flips on). Flips on
 *      tone/doctrine criteria, and any flip on a byte-identical prompt, are
 *      REPORTED for triage, not red: under freshly sampled generation,
 *      red-on-any-flip would make the gate the flaky theater the design
 *      exists to avoid.
 *
 * WHAT IS REPORTED, NEVER RED: score deltas beyond tolerance, carried
 * known-fails, skip-count changes on a skipping baseline, format/length
 * deltas, non-grounding verdict flips, invalid judge cells, malformed-URL
 * variants, query drift.
 *
 * WHAT REFUSES: any `identityMismatch(..., "gate")` — different questions,
 * models, decoding, corpus, criteria, or judge make the comparison
 * meaningless. The PROMPT is deliberately NOT a refusal dimension in this
 * scope — it is the subject under test; a prompt change is reported in the
 * gate output instead (types.ts documents the scope).
 *
 *   pnpm --filter @forge/mastra eval:seeker:gate
 *   pnpm --filter @forge/mastra eval:seeker:gate -- --baseline-dir=apps/mastra/evals/results/seeker-baseline
 */
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { hardFailViolations, runAnswerChecks } from "./checks"
import { loadableFixtureFile, type RagFixtureFile } from "./rag"
import { scoreJudgeRun } from "./score"
import {
  coerceAnswerRun,
  identityMismatch,
  JUDGE_RUN_KIND,
  type AnswerRun,
  type JudgeRun,
} from "./types"
import { classFor } from "./weights"

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_RUNS_DIR = resolve(MODULE_DIR, "../../../eval-runs/seeker")
const DEFAULT_BASELINE_DIR = resolve(
  MODULE_DIR,
  "../../../evals/results/seeker-baseline",
)
const DEFAULT_FIXTURES = resolve(MODULE_DIR, "fixtures/rag-fixtures.json")

/** Absolute run-score drop tolerated before the delta is flagged for triage. */
export const DEFAULT_SCORE_TOLERANCE = 0.05

export type GateHardFail = {
  questionId: string
  model: string
  checkId: string
  details: string[]
}

export type GateVerdictFlip = {
  questionId: string
  model: string
  criterionId: string
  criterionClass: string
  /** The current judge's stated basis, for triage. */
  reasoning: string
}

/** Per-model violation-count comparison for checks whose violations move
 *  between cells run to run on an UNCHANGED system (measured: gemma-26b
 *  skips retrieval on ~3 of 10 questions EVERY run, but which questions
 *  varies — a per-cell delta reds that roulette forever). */
export type GateCountDelta = {
  model: string
  checkId: string
  baselineCount: number
  currentCount: number
  currentCells: string[]
  /** True when currentCount exceeds baselineCount — a real regression. */
  regression: boolean
}

export type GateReport = {
  kind: "seeker-eval-gate-report"
  verdict: "green" | "red" | "refused"
  /** Non-empty only when verdict is "refused". */
  refusedOn: string[]
  /** The subject under test — reported, never a refusal. */
  promptChanged: {
    baselineSha256: string
    currentSha256: string
    baselineSource: string
    currentSource: string
  } | null
  /** Per-cell NEW ungrounded-citation violations (URL or source name) —
   *  always red. */
  newHardFails: GateHardFail[]
  carriedKnownFails: GateHardFail[]
  /** tool-called, per model — informational breakdown. Per-model attribution
   *  at one sample per cell is noise (measured: gemma-31b went 0 skips in
   *  three consecutive runs, then 2); the red condition is the pooled rule
   *  below. */
  toolSkipDeltas: GateCountDelta[]
  /** Pooled tool-skip totals across all models. `regression` (→ red) fires
   *  ONLY when a CLEAN baseline gains any skip; while the baseline itself
   *  skips, magnitude is report-only (see the rule's comment in
   *  evaluateGate — measured counts 3, 2, 3, 3, 4, 6 on the unchanged
   *  system falsified every count threshold). */
  toolSkipPooled: {
    baselineCount: number
    currentCount: number
    regression: boolean
  }
  /** word-count / prose-format count deltas — informational, never red (the
   *  gate's red set is the spec's deterministic breaks: ungrounded citation
   *  + tool never called; format/length variance under sampled generation
   *  belongs in the report). */
  formatDeltas: GateCountDelta[]
  /** Grounding-class verdict flips. RED only when the prompt CHANGED — on a
   *  byte-identical prompt a flip is sampling noise by construction and goes
   *  to triage instead. */
  groundingFlips: GateVerdictFlip[]
  triageFlips: GateVerdictFlip[]
  scoreDelta: {
    baseline: number | null
    current: number | null
    delta: number | null
    tolerance: number
    beyondTolerance: boolean
  }
  invalidCells: { baseline: number; current: number }
}

function cellKey(questionId: string, model: string): string {
  return `${questionId}|${model}`
}

function hardFailsByCell(
  run: AnswerRun,
  fixtures: RagFixtureFile | null,
): Map<string, GateHardFail[]> {
  const byCell = new Map<string, GateHardFail[]>()
  for (const answer of run.answers) {
    const violations = hardFailViolations(runAnswerChecks(answer, fixtures))
    byCell.set(
      cellKey(answer.questionId, answer.model),
      violations.map((violation) => ({
        questionId: answer.questionId,
        model: answer.model,
        checkId: violation.checkId,
        details: violation.details,
      })),
    )
  }
  return byCell
}

/**
 * Pure gate evaluation — the CLI below only loads files and prints. Exported
 * so the red/green mechanics are unit-testable without any run artifacts.
 */
export function evaluateGate(input: {
  current: { answers: AnswerRun; judged: JudgeRun }
  baseline: { answers: AnswerRun; judged: JudgeRun }
  fixtures: RagFixtureFile | null
  scoreTolerance?: number
}): GateReport {
  const tolerance = input.scoreTolerance ?? DEFAULT_SCORE_TOLERANCE
  const { current, baseline, fixtures } = input

  const empty: GateReport = {
    kind: "seeker-eval-gate-report",
    verdict: "refused",
    refusedOn: [],
    promptChanged: null,
    newHardFails: [],
    carriedKnownFails: [],
    toolSkipDeltas: [],
    toolSkipPooled: { baselineCount: 0, currentCount: 0, regression: false },
    formatDeltas: [],
    groundingFlips: [],
    triageFlips: [],
    scoreDelta: {
      baseline: null,
      current: null,
      delta: null,
      tolerance,
      beyondTolerance: false,
    },
    invalidCells: { baseline: 0, current: 0 },
  }

  // Each side's judged file must belong to its answers file ("generation"
  // scope — the judge stamps the current rubric, so criteria are excluded).
  const currentPairing = identityMismatch(
    current.answers.identity,
    current.judged.identity,
    "generation",
  )
  if (currentPairing.length > 0) {
    return {
      ...empty,
      refusedOn: currentPairing.map((p) => `current answers↔judged: ${p}`),
    }
  }
  const baselinePairing = identityMismatch(
    baseline.answers.identity,
    baseline.judged.identity,
    "generation",
  )
  if (baselinePairing.length > 0) {
    return {
      ...empty,
      refusedOn: baselinePairing.map((p) => `baseline answers↔judged: ${p}`),
    }
  }

  // Cross-run comparability — the prompt is exempt (it is the subject).
  const mismatch = identityMismatch(
    current.judged.identity,
    baseline.judged.identity,
    "gate",
  )
  if (mismatch.length > 0) {
    return { ...empty, refusedOn: mismatch }
  }

  const promptChanged =
    current.judged.identity.promptSha256 !==
    baseline.judged.identity.promptSha256
      ? {
          baselineSha256: baseline.judged.identity.promptSha256,
          currentSha256: current.judged.identity.promptSha256,
          baselineSource: baseline.judged.identity.promptSource,
          currentSource: current.judged.identity.promptSource,
        }
      : null

  // 1. Deterministic lane. Citation checks compare per (cell, check) — a
  // NEW ungrounded citation reds even if another disappeared. tool-called
  // and the format checks compare per-model COUNTS (see GateCountDelta).
  const CELL_RED_CHECKS = new Set([
    "cited-urls-grounded",
    "cited-source-names-grounded",
  ])
  const COUNT_CHECKS = ["tool-called", "word-count", "prose-format"] as const
  const baselineFails = hardFailsByCell(baseline.answers, fixtures)
  const currentFails = hardFailsByCell(current.answers, fixtures)
  const newHardFails: GateHardFail[] = []
  const carriedKnownFails: GateHardFail[] = []
  for (const [key, fails] of currentFails) {
    const baselineCell = baselineFails.get(key) ?? []
    for (const fail of fails) {
      if (!CELL_RED_CHECKS.has(fail.checkId)) continue
      const carried = baselineCell.some(
        (candidate) => candidate.checkId === fail.checkId,
      )
      if (carried) carriedKnownFails.push(fail)
      else newHardFails.push(fail)
    }
  }

  const countDelta = (checkId: string): GateCountDelta[] => {
    const models = current.judged.identity.answeringModels
    return models.map((model) => {
      const count = (fails: Map<string, GateHardFail[]>) =>
        [...fails.values()]
          .flat()
          .filter((fail) => fail.model === model && fail.checkId === checkId)
      const baselineCount = count(baselineFails).length
      const currentViolations = count(currentFails)
      return {
        model,
        checkId,
        baselineCount,
        currentCount: currentViolations.length,
        currentCells: currentViolations.map((fail) => fail.questionId),
        regression: currentViolations.length > baselineCount,
      }
    })
  }
  const toolSkipDeltas = countDelta("tool-called")
  const toolSkipPooledBaseline = toolSkipDeltas.reduce(
    (sum, delta) => sum + delta.baselineCount,
    0,
  )
  const toolSkipPooledCurrent = toolSkipDeltas.reduce(
    (sum, delta) => sum + delta.currentCount,
    0,
  )
  // Measured across nine 20-cell runs of the UNCHANGED system, the pooled
  // skip count was 3, 2, 3, 3, 4, 6, 5, 5, 4 — a +1 grace was falsified by
  // the sixth run, and no count threshold separates signal from
  // single-sample binomial noise while the baseline itself skips. So: a SKIPPING baseline
  // is the known-fail pin (decision doc §7 step 6) — its magnitude is
  // REPORT-ONLY until the §6 production model fix lands; a CLEAN baseline
  // (zero skips — what that fix buys) reds on ANY skip, because zero is an
  // absorbing state and leaving it is always signal. The skip counts stay
  // first-class in every gate report; the multi-sample nightly is the
  // instrument that resolves magnitude drift on a skipping baseline.
  const toolSkipPooled = {
    baselineCount: toolSkipPooledBaseline,
    currentCount: toolSkipPooledCurrent,
    regression: toolSkipPooledBaseline === 0 && toolSkipPooledCurrent > 0,
  }
  const formatDeltas = COUNT_CHECKS.slice(1).flatMap((checkId) =>
    countDelta(checkId),
  )

  // 2. Judge verdict flips (baseline satisfied → current violated).
  const baselineVerdicts = new Map<string, Map<string, string>>()
  for (const cell of baseline.judged.judged) {
    if (cell.status !== "judged" || !cell.verdicts) continue
    baselineVerdicts.set(
      cellKey(cell.questionId, cell.model),
      new Map(cell.verdicts.map((v) => [v.criterionId, v.verdict])),
    )
  }
  const groundingFlips: GateVerdictFlip[] = []
  const triageFlips: GateVerdictFlip[] = []
  for (const cell of current.judged.judged) {
    if (cell.status !== "judged" || !cell.verdicts) continue
    const baselineCell = baselineVerdicts.get(
      cellKey(cell.questionId, cell.model),
    )
    if (!baselineCell) continue
    for (const verdict of cell.verdicts) {
      if (verdict.verdict !== "violated") continue
      if (baselineCell.get(verdict.criterionId) !== "satisfied") continue
      const criterionClass = classFor(verdict.criterionId)
      const flip: GateVerdictFlip = {
        questionId: cell.questionId,
        model: cell.model,
        criterionId: verdict.criterionId,
        criterionClass,
        reasoning: verdict.reasoning,
      }
      if (criterionClass === "grounding") groundingFlips.push(flip)
      else triageFlips.push(flip)
    }
  }

  // 3. Score delta — triage-only, never red.
  const baselineScore = scoreJudgeRun(baseline.judged)
  const currentScore = scoreJudgeRun(current.judged)
  const delta =
    baselineScore.runScore != null && currentScore.runScore != null
      ? currentScore.runScore - baselineScore.runScore
      : null
  const scoreDelta = {
    baseline: baselineScore.runScore,
    current: currentScore.runScore,
    delta,
    tolerance,
    beyondTolerance: delta != null && delta < -tolerance,
  }

  const verdict: GateReport["verdict"] =
    newHardFails.length > 0 ||
    toolSkipPooled.regression ||
    (promptChanged != null && groundingFlips.length > 0)
      ? "red"
      : "green"

  return {
    kind: "seeker-eval-gate-report",
    verdict,
    refusedOn: [],
    promptChanged,
    newHardFails,
    carriedKnownFails,
    toolSkipDeltas,
    toolSkipPooled,
    formatDeltas,
    groundingFlips,
    triageFlips,
    scoreDelta,
    invalidCells: {
      baseline: baselineScore.invalidCells,
      current: currentScore.invalidCells,
    },
  }
}

function flag(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

async function loadAnswers(path: string): Promise<AnswerRun> {
  return coerceAnswerRun(JSON.parse(await readFile(path, "utf8")))
}

async function loadJudged(path: string): Promise<JudgeRun> {
  const run = JSON.parse(await readFile(path, "utf8")) as JudgeRun
  if (run.kind !== JUDGE_RUN_KIND) {
    throw new Error(`${path} is not a seeker-eval judgements file`)
  }
  return run
}

async function loadFixtures(path: string): Promise<RagFixtureFile | null> {
  try {
    return loadableFixtureFile(JSON.parse(await readFile(path, "utf8")))
  } catch {
    return null
  }
}

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

  const [
    currentAnswers,
    currentJudged,
    baselineAnswers,
    baselineJudged,
    fixtures,
  ] = await Promise.all([
    loadAnswers(resolve(currentDir, "answers.json")),
    loadJudged(resolve(currentDir, "judged.json")),
    loadAnswers(resolve(baselineDir, "answers.json")),
    loadJudged(resolve(baselineDir, "judged.json")),
    loadFixtures(
      resolve(process.cwd(), flag(argv, "fixtures") ?? DEFAULT_FIXTURES),
    ),
  ])

  const report = evaluateGate({
    current: { answers: currentAnswers, judged: currentJudged },
    baseline: { answers: baselineAnswers, judged: baselineJudged },
    fixtures,
    scoreTolerance: tolerance,
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
      `RED     : pooled tool-called skips rose ${report.toolSkipPooled.baselineCount} → ${report.toolSkipPooled.currentCount}`,
    )
  } else if (report.toolSkipPooled.currentCount > 0) {
    console.log(
      `carried : ${report.toolSkipPooled.currentCount} pooled tool skip(s) (baseline had ${report.toolSkipPooled.baselineCount})`,
    )
  }
  for (const delta of report.toolSkipDeltas) {
    if (delta.currentCount > 0 || delta.baselineCount > 0) {
      console.log(
        `skips   : ${delta.model} — ${delta.baselineCount} → ${delta.currentCount}${delta.currentCells.length > 0 ? ` (${delta.currentCells.join(", ")})` : ""}`,
      )
    }
  }
  for (const flip of report.groundingFlips) {
    console.log(
      `${report.promptChanged ? "RED    " : "triage "} : ${flip.questionId} x ${flip.model} — grounding criterion ${flip.criterionId} flipped violated${report.promptChanged ? "" : " (prompt unchanged — sampling noise, not gated)"}`,
    )
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
