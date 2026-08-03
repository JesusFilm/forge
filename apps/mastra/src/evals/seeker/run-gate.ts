#!/usr/bin/env tsx
/**
 * Seeker eval — STEP 5. The delta gate: compare a candidate run against the
 * committed baseline and decide green / red / refused.
 *
 * WHAT REDS (deterministic-first, decision doc §3 "Delta gating"):
 *   1. A NEW per-cell ungrounded-citation violation (URL on a never-served
 *      host, or an invented source name) — an offending detail present now
 *      that was not present in the baseline cell for the same check. Matching
 *      is by VIOLATION IDENTITY (the normalized offending URL/source-name
 *      string), never by checkId alone — a cell that carries one accepted
 *      citation pin still reds on a different invented source. Details
 *      present in BOTH runs are "carried known-fails": reported, never red,
 *      expiring structurally — a model-config change breaks identity,
 *      forcing a fresh baseline (the decision doc's expiry pin).
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
 * gate output instead (types.ts documents the scope). Also refused: a judged
 * run that never graded the full questions × models grid (a judge outage
 * plus a regression must not gate green on zero evidence); a fixture-world
 * run pair with no loadable fixture file (the citation lane would silently
 * vacate to not-applicable — fail closed, never green); and a fixture file
 * whose corpusSha256 differs from the runs' stamped corpus (grounded-ness
 * would be computed against a different world) unless
 * `--allow-corpus-mismatch` is passed for a deliberate legacy replay.
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
  type RunIdentity,
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
  /** Cells the judge could not grade because the ANSWER was unusable —
   *  surfaced beside invalidCells so a collapsed run is visible in the
   *  report, not just in the coverage refusal. */
  answerErrorCells: { baseline: number; current: number }
  /** corpusSha256 of the fixture file the citation lane actually graded
   *  against; null only for mode-"none" run pairs (no fixtures loaded). */
  fixturesCorpusSha256: string | null
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
  /** null is legal ONLY for mode-"none" run pairs; a fixture-world pair
   *  with null fixtures REFUSES (the citation lane must not silently
   *  vacate — review finding #4). */
  fixtures: RagFixtureFile | null
  /** Explicit escape hatch for deliberate legacy replays whose stamped
   *  corpus predates the current fixture capture (review finding #11). */
  allowCorpusMismatch?: boolean
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
    answerErrorCells: { baseline: 0, current: 0 },
    fixturesCorpusSha256: fixtures?.corpusSha256 ?? null,
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

  // Fixture-world integrity (findings #4 + #11). Both runs share a retrieval
  // mode and corpus at this point (the cross-run check above refused any
  // disagreement). For a fixture-world pair the citation checks are computed
  // FROM the fixture file, so (a) a missing file must refuse — with null
  // fixtures both grounded-citation checks return not-applicable for every
  // cell and newHardFails is empty BY CONSTRUCTION, exactly the lane the
  // gate exists to hold; and (b) the file's corpus stamp must match what
  // BOTH runs generated against, or "grounded" means a different world.
  const retrievalMode = current.judged.identity.retrieval?.mode ?? "unstamped"
  if (retrievalMode !== "none") {
    if (!fixtures) {
      return {
        ...empty,
        refusedOn: [
          `fixtures: retrieval mode "${retrievalMode}" requires the RAG fixture file for the grounded-citation lane, and none was loaded`,
        ],
      }
    }
    if (input.allowCorpusMismatch !== true) {
      const stampedCorpus = (identity: RunIdentity): string | null => {
        const retrieval = identity.retrieval
        return retrieval != null && retrieval.mode !== "none"
          ? retrieval.corpusSha256
          : null
      }
      const corpusProblems: string[] = []
      for (const [label, identity] of [
        ["current", current.judged.identity],
        ["baseline", baseline.judged.identity],
      ] as const) {
        const stamped = stampedCorpus(identity)
        if (stamped !== fixtures.corpusSha256) {
          corpusProblems.push(
            `fixtures corpus ${fixtures.corpusSha256.slice(0, 12)}… does not match the ${label} run's stamped corpus ${stamped?.slice(0, 12) ?? "(unstamped)"}… — pass --allow-corpus-mismatch only for a deliberate legacy replay`,
          )
        }
      }
      if (corpusProblems.length > 0) {
        return { ...empty, refusedOn: corpusProblems }
      }
    }
  }

  // Coverage refusal: a judged run that never graded the full
  // questionIds × answeringModels grid certifies nothing about the missing
  // cells — invalid/answer-error cells carry zero verdict weight, so without
  // this check a judge outage plus a prompt regression gates green on zero
  // evidence. Refused, never green.
  const gridKeys = new Set(
    current.judged.identity.questionIds.flatMap((questionId) =>
      current.judged.identity.answeringModels.map((model) =>
        cellKey(questionId, model),
      ),
    ),
  )
  const cellStats = (run: JudgeRun) => {
    const judgedKeys = new Set<string>()
    let invalid = 0
    let answerError = 0
    for (const cell of run.judged) {
      const key = cellKey(cell.questionId, cell.model)
      if (cell.status === "judged" && cell.verdicts && gridKeys.has(key)) {
        judgedKeys.add(key)
      } else if (cell.status === "invalid") invalid += 1
      else if (cell.status === "answer-error") answerError += 1
    }
    return { judgedCount: judgedKeys.size, invalid, answerError }
  }
  const currentStats = cellStats(current.judged)
  const baselineStats = cellStats(baseline.judged)
  const observedCells = {
    invalidCells: {
      baseline: baselineStats.invalid,
      current: currentStats.invalid,
    },
    answerErrorCells: {
      baseline: baselineStats.answerError,
      current: currentStats.answerError,
    },
  }
  const coverageProblems: string[] = []
  for (const [label, stats] of [
    ["current", currentStats],
    ["baseline", baselineStats],
  ] as const) {
    if (stats.judgedCount < gridKeys.size) {
      coverageProblems.push(
        `${label} coverage: only ${stats.judgedCount}/${gridKeys.size} grid cells judged (${stats.invalid} invalid, ${stats.answerError} answer-error) — cannot gate on partial evidence`,
      )
    }
  }
  if (coverageProblems.length > 0) {
    return { ...empty, ...observedCells, refusedOn: coverageProblems }
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

  // 1. Deterministic lane. Citation checks compare per (cell, check,
  // VIOLATION IDENTITY): a current offending detail (the normalized invented
  // URL / source-name string) counts as carried ONLY when the SAME detail
  // appears in the baseline cell for the same check — so a NEW ungrounded
  // citation reds even if another disappeared, and even when the cell
  // already carried a different accepted pin. tool-called and the format
  // checks compare per-model COUNTS (see GateCountDelta).
  const CELL_RED_CHECKS = new Set([
    "cited-urls-grounded",
    "cited-source-names-grounded",
  ])
  const COUNT_CHECKS = ["tool-called", "word-count", "prose-format"] as const
  const baselineFails = hardFailsByCell(baseline.answers, fixtures)
  const currentFails = hardFailsByCell(current.answers, fixtures)
  const newHardFails: GateHardFail[] = []
  const carriedKnownFails: GateHardFail[] = []
  const normalizeDetail = (detail: string): string =>
    detail.trim().toLowerCase()
  for (const [key, fails] of currentFails) {
    const baselineCell = baselineFails.get(key) ?? []
    for (const fail of fails) {
      if (!CELL_RED_CHECKS.has(fail.checkId)) continue
      const baselineDetails = new Set(
        baselineCell
          .filter((candidate) => candidate.checkId === fail.checkId)
          .flatMap((candidate) => candidate.details.map(normalizeDetail)),
      )
      // The citation checks always name their offenders, so an empty details
      // array is unreachable for CELL_RED_CHECKS today; if a future check
      // joins the set without details, fall back to checkId matching rather
      // than silently dropping the violation.
      if (fail.details.length === 0) {
        const baselineHasCheck = baselineCell.some(
          (candidate) => candidate.checkId === fail.checkId,
        )
        if (baselineHasCheck) carriedKnownFails.push(fail)
        else newHardFails.push(fail)
        continue
      }
      const carriedDetails = fail.details.filter((detail) =>
        baselineDetails.has(normalizeDetail(detail)),
      )
      const newDetails = fail.details.filter(
        (detail) => !baselineDetails.has(normalizeDetail(detail)),
      )
      if (newDetails.length > 0) {
        newHardFails.push({ ...fail, details: newDetails })
      }
      if (carriedDetails.length > 0) {
        carriedKnownFails.push({ ...fail, details: carriedDetails })
      }
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
    answerErrorCells: {
      baseline: baselineScore.answerErrorCells,
      current: currentScore.answerErrorCells,
    },
    fixturesCorpusSha256: fixtures?.corpusSha256 ?? null,
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

/**
 * Fail-closed fixtures load (review finding #4). With null fixtures both
 * grounded-citation checks return not-applicable for every cell, so a
 * swallowed load failure silently vacates the exact lane the gate exists to
 * hold. Absence and corruption throw DISTINCT messages — they have different
 * fixes — and main() maps any throw to a nonzero exit. Exported for tests.
 */
export async function loadFixtures(path: string): Promise<RagFixtureFile> {
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code
    if (code === "ENOENT") {
      throw new Error(
        `fixtures file not found at ${path} — run eval:seeker:capture-rag against a live RAG, or pass --fixtures=<path>`,
      )
    }
    throw new Error(
      `fixtures file at ${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(
      `fixtures file at ${path} is not valid JSON — restore or re-capture it`,
    )
  }
  const file = loadableFixtureFile(parsed)
  if (!file) {
    throw new Error(`${path} is not a chat-eval RAG fixture file (wrong kind)`)
  }
  return file
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
  // Deliberate legacy-replay escape only (finding #11) — without it a
  // fixture file whose corpus differs from the runs' stamp REFUSES.
  const allowCorpusMismatch = argv.includes("--allow-corpus-mismatch")

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
    allowCorpusMismatch,
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
