/**
 * Seeker eval — score derivation. THE CODE DECIDES, NEVER THE JUDGE.
 *
 * The judge returns per-criterion binary verdicts; this module turns them
 * into a weighted pass rate using `weights.ts`, with per-model and
 * per-prompt-section rollups. Invalid cells (judge protocol failure after
 * the one retry) and answer-error cells are EXCLUDED from every rate and
 * surfaced as counts — an infrastructure failure must never read as a
 * quality signal.
 */
import type { PromptSectionId } from "./prompt-sections"
import { criteriaFor, questionById, type Criterion } from "./questions"
import { bandFor, type Band, type JudgeRun, type RunIdentity } from "./types"
import { WEIGHTS_VERSION, classFor, weightFor } from "./weights"

export type CellScore = {
  questionId: string
  model: string
  status: "judged" | "answer-error" | "invalid"
  /** Weighted pass rate for the cell; null when not judged. */
  score: number | null
  band: Band | null
  satisfiedWeight: number
  totalWeight: number
}

export type ModelRollup = {
  model: string
  /** Pooled weighted pass rate over the model's judged cells. */
  score: number | null
  band: Band | null
  judgedCells: number
  invalidCells: number
  answerErrorCells: number
}

export type SectionRollup = {
  section: PromptSectionId
  /** Pooled weighted pass rate over verdicts whose criterion carries this
   *  section tag. A criterion tagged with two sections counts fully toward
   *  both — attribution by tag, deliberately, not a partition. */
  score: number | null
  satisfiedCount: number
  violatedCount: number
}

export type ScoreReport = {
  kind: "seeker-eval-score"
  weightsVersion: string
  identity: RunIdentity
  /** Pooled weighted pass rate over every judged verdict in the run. */
  runScore: number | null
  runBand: Band | null
  cells: CellScore[]
  byModel: ModelRollup[]
  bySection: SectionRollup[]
  judgedCells: number
  invalidCells: number
  answerErrorCells: number
}

function criterionById(questionId: string): Map<string, Criterion> {
  const question = questionById(questionId)
  return new Map(
    criteriaFor(question).map((criterion) => [criterion.id, criterion]),
  )
}

export function scoreJudgeRun(run: JudgeRun): ScoreReport {
  const cells: CellScore[] = []
  const sectionTallies = new Map<
    PromptSectionId,
    {
      satisfiedWeight: number
      totalWeight: number
      satisfied: number
      violated: number
    }
  >()
  const modelTallies = new Map<
    string,
    {
      satisfiedWeight: number
      totalWeight: number
      judged: number
      invalid: number
      answerError: number
    }
  >()

  let runSatisfiedWeight = 0
  let runTotalWeight = 0

  for (const judged of run.judged) {
    const modelTally = modelTallies.get(judged.model) ?? {
      satisfiedWeight: 0,
      totalWeight: 0,
      judged: 0,
      invalid: 0,
      answerError: 0,
    }
    modelTallies.set(judged.model, modelTally)

    if (judged.status !== "judged" || !judged.verdicts) {
      if (judged.status === "invalid") modelTally.invalid += 1
      else modelTally.answerError += 1
      cells.push({
        questionId: judged.questionId,
        model: judged.model,
        status: judged.status,
        score: null,
        band: null,
        satisfiedWeight: 0,
        totalWeight: 0,
      })
      continue
    }

    const criteria = criterionById(judged.questionId)
    let satisfiedWeight = 0
    let totalWeight = 0
    for (const verdict of judged.verdicts) {
      const criterion = criteria.get(verdict.criterionId)
      if (!criterion) {
        // Protocol validation at judge time makes this unreachable; refuse
        // loudly rather than silently skew the score if a file was edited.
        throw new Error(
          `verdict for unknown criterion ${verdict.criterionId} in ${judged.questionId} — cannot score`,
        )
      }
      // classFor() is consulted so an unclassified criterion fails scoring
      // loudly (weights.ts completeness), not just the weights test.
      classFor(verdict.criterionId)
      const weight = weightFor(verdict.criterionId)
      totalWeight += weight
      const satisfied = verdict.verdict === "satisfied"
      if (satisfied) satisfiedWeight += weight

      for (const section of criterion.promptSections) {
        const tally = sectionTallies.get(section) ?? {
          satisfiedWeight: 0,
          totalWeight: 0,
          satisfied: 0,
          violated: 0,
        }
        sectionTallies.set(section, tally)
        tally.totalWeight += weight
        if (satisfied) {
          tally.satisfiedWeight += weight
          tally.satisfied += 1
        } else {
          tally.violated += 1
        }
      }
    }

    modelTally.judged += 1
    modelTally.satisfiedWeight += satisfiedWeight
    modelTally.totalWeight += totalWeight
    runSatisfiedWeight += satisfiedWeight
    runTotalWeight += totalWeight

    const score = totalWeight > 0 ? satisfiedWeight / totalWeight : null
    cells.push({
      questionId: judged.questionId,
      model: judged.model,
      status: "judged",
      score,
      band: score == null ? null : bandFor(score),
      satisfiedWeight,
      totalWeight,
    })
  }

  const byModel: ModelRollup[] = [...modelTallies.entries()].map(
    ([model, tally]) => {
      const score =
        tally.totalWeight > 0 ? tally.satisfiedWeight / tally.totalWeight : null
      return {
        model,
        score,
        band: score == null ? null : bandFor(score),
        judgedCells: tally.judged,
        invalidCells: tally.invalid,
        answerErrorCells: tally.answerError,
      }
    },
  )

  const bySection: SectionRollup[] = [...sectionTallies.entries()]
    .map(([section, tally]) => ({
      section,
      score:
        tally.totalWeight > 0
          ? tally.satisfiedWeight / tally.totalWeight
          : null,
      satisfiedCount: tally.satisfied,
      violatedCount: tally.violated,
    }))
    .sort((left, right) => left.section.localeCompare(right.section))

  const runScore =
    runTotalWeight > 0 ? runSatisfiedWeight / runTotalWeight : null

  return {
    kind: "seeker-eval-score",
    weightsVersion: WEIGHTS_VERSION,
    identity: run.identity,
    runScore,
    runBand: runScore == null ? null : bandFor(runScore),
    cells,
    byModel,
    bySection,
    judgedCells: cells.filter((cell) => cell.status === "judged").length,
    invalidCells: cells.filter((cell) => cell.status === "invalid").length,
    answerErrorCells: cells.filter((cell) => cell.status === "answer-error")
      .length,
  }
}
