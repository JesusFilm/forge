import { describe, expect, it } from "vitest"

import { criteriaFor, questionById } from "./questions"
import { scoreJudgeRun } from "./score"
import type {
  CriterionVerdict,
  JudgedAnswer,
  JudgeRun,
  RunIdentity,
} from "./types"
import { CLASS_WEIGHTS, WEIGHTS_VERSION, classFor } from "./weights"

function identity(): RunIdentity {
  return {
    promptSha256: "prompt-sha",
    promptSource: "fallback",
    promptLangfuseVersion: null,
    promptLangfuseLabel: null,
    sectionMappingVersion: "seeker-sections/v1",
    questionSetId: "seeker-eval/v1",
    questionIds: ["q-links-to-verify"],
    criteriaSha256: "criteria-sha",
    answeringModels: ["google/gemma-4-31b-it"],
    decoding: { temperature: 0.7, maxTokens: 1600 },
    sampleId: "s1",
    gitSha: null,
    retrieval: { mode: "fixtures", corpusSha256: "corpus", topK: 5 },
    judge: { model: "anthropic/claude-haiku-4.5", rubricSha256: "rubric" },
  }
}

function verdictsFor(
  questionId: string,
  violate: readonly string[] = [],
): CriterionVerdict[] {
  return criteriaFor(questionById(questionId)).map((criterion) => ({
    criterionId: criterion.id,
    verdict: violate.includes(criterion.id) ? "violated" : "satisfied",
    reasoning: "test reasoning",
  }))
}

function judgedCell(
  questionId: string,
  model: string,
  violate: readonly string[] = [],
): JudgedAnswer {
  return {
    questionId,
    category: questionById(questionId).category,
    model,
    status: "judged",
    verdicts: verdictsFor(questionId, violate),
    errors: [],
    retried: false,
    judgeUsage: { input: 100, output: 100 },
    judgeCostUsd: 0.0005,
    judgeLatencyMs: 900,
  }
}

function run(judged: JudgedAnswer[]): JudgeRun {
  return {
    kind: "seeker-eval-judgements",
    startedAt: "2026-08-03T00:00:00.000Z",
    finishedAt: "2026-08-03T00:01:00.000Z",
    identity: identity(),
    judged,
  }
}

describe("scoreJudgeRun — weighted pass rate derived in code", () => {
  it("scores an all-satisfied cell 1.0 and stamps the weights version", () => {
    const report = scoreJudgeRun(run([judgedCell("q-links-to-verify", "m")]))
    expect(report.weightsVersion).toBe(WEIGHTS_VERSION)
    expect(report.runScore).toBe(1)
    expect(report.runBand).toBe("pass")
    expect(report.cells[0].score).toBe(1)
  })

  it("weights a grounding flip heavier than a tone flip (the weighting MECHANISM)", () => {
    // Same cell, one violated criterion each — the grounding criterion must
    // move the score by grounding/tone times as much, per CLASS_WEIGHTS.
    expect(classFor("q-links-only-served")).toBe("grounding")
    expect(classFor("q-links-substance")).toBe("tone")

    const groundingFlip = scoreJudgeRun(
      run([judgedCell("q-links-to-verify", "m", ["q-links-only-served"])]),
    )
    const toneFlip = scoreJudgeRun(
      run([judgedCell("q-links-to-verify", "m", ["q-links-substance"])]),
    )

    expect(groundingFlip.runScore).not.toBeNull()
    expect(toneFlip.runScore).not.toBeNull()
    const totalWeight = groundingFlip.cells[0].totalWeight
    expect(groundingFlip.runScore).toBeCloseTo(
      (totalWeight - CLASS_WEIGHTS.grounding) / totalWeight,
      10,
    )
    expect(toneFlip.runScore).toBeCloseTo(
      (totalWeight - CLASS_WEIGHTS.tone) / totalWeight,
      10,
    )
    expect(groundingFlip.runScore!).toBeLessThan(toneFlip.runScore!)
  })

  it("rolls violations up per prompt section via the criterion tags", () => {
    const report = scoreJudgeRun(
      run([judgedCell("q-links-to-verify", "m", ["q-links-only-served"])]),
    )
    const citation = report.bySection.find(
      (entry) => entry.section === "citation-discipline",
    )
    expect(citation).toBeDefined()
    expect(citation!.violatedCount).toBe(1)
    expect(citation!.score).not.toBeNull()
    expect(citation!.score!).toBeLessThan(1)
    const persona = report.bySection.find(
      (entry) => entry.section === "persona",
    )
    expect(persona?.violatedCount).toBe(0)
    expect(persona?.score).toBe(1)
  })

  it("excludes invalid and answer-error cells from every rate and counts them", () => {
    const clean = judgedCell("q-links-to-verify", "m")
    const invalid: JudgedAnswer = {
      ...judgedCell("q-links-to-verify", "m2"),
      status: "invalid",
      verdicts: undefined,
      errors: ["missing verdict for g-on-topic"],
    }
    const answerError: JudgedAnswer = {
      ...judgedCell("q-links-to-verify", "m3"),
      status: "answer-error",
      verdicts: undefined,
      errors: ["answer truncated (finishReason=length)"],
    }
    const report = scoreJudgeRun(run([clean, invalid, answerError]))
    expect(report.runScore).toBe(1)
    expect(report.judgedCells).toBe(1)
    expect(report.invalidCells).toBe(1)
    expect(report.answerErrorCells).toBe(1)
    const m2 = report.byModel.find((entry) => entry.model === "m2")
    expect(m2?.score).toBeNull()
    expect(m2?.invalidCells).toBe(1)
  })

  it("computes per-model rollups from each model's own cells only", () => {
    const report = scoreJudgeRun(
      run([
        judgedCell("q-links-to-verify", "model-a", ["q-links-only-served"]),
        judgedCell("q-links-to-verify", "model-b"),
      ]),
    )
    const modelA = report.byModel.find((entry) => entry.model === "model-a")
    const modelB = report.byModel.find((entry) => entry.model === "model-b")
    expect(modelB?.score).toBe(1)
    expect(modelA?.score).not.toBeNull()
    expect(modelA!.score!).toBeLessThan(1)
  })

  it("refuses to score a verdict for a criterion that does not exist", () => {
    const cell = judgedCell("q-links-to-verify", "m")
    cell.verdicts = [
      ...cell.verdicts!,
      {
        criterionId: "q-ghost-criterion",
        verdict: "satisfied",
        reasoning: "should never score",
      },
    ]
    expect(() => scoreJudgeRun(run([cell]))).toThrow(/unknown criterion/)
  })
})
