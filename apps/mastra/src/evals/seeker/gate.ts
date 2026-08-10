/**
 * Seeker eval — the delta-gate policy: compare a candidate run against the
 * committed baseline and decide green / red / refused. Pure module — the
 * `run-gate.ts` runner loads files, calls `evaluateGate`, prints, and sets
 * the exit code (the score.ts / run-score.ts split).
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
 *   2. ANY tool skip in the CURRENT run (pooled across models). Decision
 *      2026-08-04 (#5): unconditional — the production skip defect is the
 *      reason this eval exists, so a skip is a deterministic hard-fail
 *      regardless of prompt change. A BASELINE containing any skip REFUSES
 *      instead (see WHAT REFUSES) — a skipping run is not a valid
 *      known-good.
 *   3. A judge-verdict flip (baseline satisfied → current violated) on a
 *      GROUNDING-class criterion (weights.ts) WHEN THE PROMPT CHANGED — and
 *      only when CONFIRMED (decision 2026-08-04 #7): the SAME (question,
 *      model, criterion) flip must appear in a SECOND independent judged
 *      run (`--confirm-judged=<path>`) before it reds, because
 *      byte-identical-prompt reruns measured ~1 flip of pure sampling noise
 *      per run — red-on-one-flip breeds rerun-until-green, which passes
 *      real regressions. With flips and NO confirm run the gate REFUSES
 *      (nonzero exit — fail-safe for CI) and instructs the operator to
 *      rerun loop+judge. Flips that do not reproduce are surfaced as
 *      `unconfirmedGroundingFlips` — noise, never red, never dropped.
 *      Flips on tone/doctrine criteria, and any flip on a byte-identical
 *      prompt, are REPORTED for triage, not red.
 *
 * WHAT IS REPORTED, NEVER RED: score deltas beyond tolerance, carried
 * known-fails, format/length deltas, non-grounding verdict flips, invalid
 * judge cells, malformed-URL variants, query drift.
 *
 * WHAT REFUSES: any `identityMismatch(..., "gate")` — different questions,
 * models, decoding, corpus, criteria, or judge make the comparison
 * meaningless. The PROMPT is deliberately NOT a refusal dimension in this
 * scope — it is the subject under test; a prompt change is reported in the
 * gate output instead (types.ts documents the scope). Also refused: a judged
 * run that never graded the full questions × models grid (a judge outage
 * plus a regression must not gate green on zero evidence); a BASELINE
 * containing any tool skip (decision 2026-08-04 #5 — re-capture a clean
 * baseline; a skipping run is not a valid known-good); a fixture-world
 * run pair with no loadable fixture file (the citation lane would silently
 * vacate to not-applicable — fail closed, never green); and a fixture file
 * whose corpusSha256 differs from the runs' stamped corpus (grounded-ness
 * would be computed against a different world) unless the runner's
 * `--allow-corpus-mismatch` is passed for a deliberate legacy replay.
 */
import { hardFailViolations, runAnswerChecks } from "./checks"
import type { RagFixtureFile } from "./rag"
import { scoreJudgeRun } from "./score"
import {
  identityMismatch,
  stampedCorpusSha,
  type AnswerRun,
  type JudgeRun,
} from "./types"
import { classFor } from "./weights"

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
 *  between cells run to run on an UNCHANGED system (measured: one answering
 *  model skipped retrieval on ~3 of 10 questions EVERY run, but which
 *  questions varied — a per-cell delta reds that roulette forever). */
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
   *  at one sample per cell is noise (measured: an answering model went 0
   *  skips in three consecutive runs, then 2); the red condition is the
   *  pooled rule below. */
  toolSkipDeltas: GateCountDelta[]
  /** Pooled tool-skip totals across all models. Decision 2026-08-04 (#5):
   *  `regression` (→ red) fires on ANY current-run skip; a baseline with a
   *  nonzero count never reaches a green/red report — it REFUSES upstream
   *  (a skipping run is not a valid known-good). */
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
  /** ALL grounding-class verdict flips vs the baseline. On a byte-identical
   *  prompt these are sampling noise by construction (triage). On a CHANGED
   *  prompt they red ONLY when confirmed — see confirmedGroundingFlips. */
  groundingFlips: GateVerdictFlip[]
  triageFlips: GateVerdictFlip[]
  /** Decision 2026-08-04 (#7): grounding flips (prompt changed) that
   *  REPRODUCED — same (question, model, criterion) — in the independent
   *  confirmation run. This is the red set. */
  confirmedGroundingFlips: GateVerdictFlip[]
  /** Flips that did NOT reproduce in the confirmation run: sampling noise,
   *  surfaced for triage, never red, never silently dropped. */
  unconfirmedGroundingFlips: GateVerdictFlip[]
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

/** questionId|model → criterionId → verdict, over judged cells only. Used
 *  for both the baseline and the confirmation run's verdict lookups. */
function verdictsByCell(run: JudgeRun): Map<string, Map<string, string>> {
  const byCell = new Map<string, Map<string, string>>()
  for (const cell of run.judged) {
    if (cell.status !== "judged" || !cell.verdicts) continue
    byCell.set(
      cellKey(cell.questionId, cell.model),
      new Map(cell.verdicts.map((v) => [v.criterionId, v.verdict])),
    )
  }
  return byCell
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
 * Pure gate evaluation — the run-gate.ts CLI only loads files and prints.
 * Exported so the red/green mechanics are unit-testable without any run
 * artifacts.
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
  /** A second, independent judged run of the SAME candidate (decision
   *  2026-08-04 #7). Required whenever the prompt changed AND grounding
   *  flips exist — without it the gate refuses rather than guessing. */
  confirmJudged?: JudgeRun | null
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
    confirmedGroundingFlips: [],
    unconfirmedGroundingFlips: [],
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
      const corpusProblems: string[] = []
      for (const [label, identity] of [
        ["current", current.judged.identity],
        ["baseline", baseline.judged.identity],
      ] as const) {
        const stamped = stampedCorpusSha(identity)
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
  const FORMAT_CHECKS = ["word-count", "prose-format"] as const
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
  // Decision 2026-08-04 (#5), superseding the earlier known-fail pin: the
  // measured pooled skip counts on the UNCHANGED system (3, 2, 3, 3, 4, 6,
  // 5, 5, 4 across nine 20-cell runs) falsified every magnitude threshold —
  // no count separates signal from single-sample binomial noise while a
  // baseline itself skips. The only sound policy is zero on BOTH sides:
  // ANY current-run skip is red (the production defect class this eval
  // exists for), and a baseline with any skip is REFUSED below — it cannot
  // serve as a known-good, so the fix is the §6 production skip fix plus
  // ONE clean re-capture/rebaseline, not a tolerance.
  const toolSkipPooled = {
    baselineCount: toolSkipPooledBaseline,
    currentCount: toolSkipPooledCurrent,
    regression: toolSkipPooledCurrent > 0,
  }
  if (toolSkipPooledBaseline > 0) {
    return {
      ...empty,
      ...observedCells,
      refusedOn: [
        `baseline contains ${toolSkipPooledBaseline} tool skip(s) — re-capture a clean baseline; a skipping run is not a valid known-good`,
      ],
      toolSkipDeltas,
      toolSkipPooled,
    }
  }
  const formatDeltas = FORMAT_CHECKS.flatMap((checkId) => countDelta(checkId))

  // 2. Judge verdict flips (baseline satisfied → current violated).
  const baselineVerdicts = verdictsByCell(baseline.judged)
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

  // 2b. Confirmation of grounding flips (decision 2026-08-04 #7). A single
  // flip after a prompt change is indistinguishable from sampling noise
  // (byte-identical-prompt reruns measured ~1 flip per run), so it must
  // NEVER green silently and must NEVER final-red alone: red requires the
  // SAME (question, model, criterion) flip in a second independent judged
  // run; with flips and no confirm run the gate REFUSES (fail-safe for CI);
  // unreproduced flips surface as unconfirmedGroundingFlips.
  const flipsNeedConfirmation =
    promptChanged != null && groundingFlips.length > 0
  const confirmedGroundingFlips: GateVerdictFlip[] = []
  const unconfirmedGroundingFlips: GateVerdictFlip[] = []
  let confirmationProblems: string[] = []
  if (flipsNeedConfirmation) {
    const confirm = input.confirmJudged ?? null
    if (confirm == null) {
      confirmationProblems = [
        `${groundingFlips.length} grounding flip(s) on a changed prompt require independent confirmation — rerun eval:seeker:loop + eval:seeker:judge into a second directory and pass --confirm-judged=<judged.json>`,
      ]
    } else {
      // The confirm run must be the SAME candidate — full-scope identity
      // (prompt included; sampleId is deliberately not a dimension) — and
      // must itself have graded the full grid, or it cannot confirm.
      const pairing = identityMismatch(
        confirm.identity,
        current.judged.identity,
        "full",
      )
      const confirmStats = cellStats(confirm)
      if (pairing.length > 0) {
        confirmationProblems = pairing.map(
          (problem) => `confirm run: ${problem}`,
        )
      } else if (confirmStats.judgedCount < gridKeys.size) {
        confirmationProblems = [
          `confirm run coverage: only ${confirmStats.judgedCount}/${gridKeys.size} grid cells judged (${confirmStats.invalid} invalid, ${confirmStats.answerError} answer-error) — cannot confirm flips on partial evidence`,
        ]
      } else {
        const confirmVerdicts = verdictsByCell(confirm)
        for (const flip of groundingFlips) {
          const reproduced =
            confirmVerdicts
              .get(cellKey(flip.questionId, flip.model))
              ?.get(flip.criterionId) === "violated"
          if (reproduced) confirmedGroundingFlips.push(flip)
          else unconfirmedGroundingFlips.push(flip)
        }
      }
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

  // Verdict precedence: a deterministic red stands regardless of flip
  // confirmation (the operator must fix it either way — the flip demand
  // fires on the rerun); otherwise an unresolved confirmation refuses;
  // otherwise a confirmed flip reds.
  const deterministicRed = newHardFails.length > 0 || toolSkipPooled.regression
  const verdict: GateReport["verdict"] = deterministicRed
    ? "red"
    : confirmationProblems.length > 0
      ? "refused"
      : confirmedGroundingFlips.length > 0
        ? "red"
        : "green"

  return {
    kind: "seeker-eval-gate-report",
    verdict,
    refusedOn: verdict === "refused" ? confirmationProblems : [],
    promptChanged,
    newHardFails,
    carriedKnownFails,
    toolSkipDeltas,
    toolSkipPooled,
    formatDeltas,
    groundingFlips,
    triageFlips,
    confirmedGroundingFlips,
    unconfirmedGroundingFlips,
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
