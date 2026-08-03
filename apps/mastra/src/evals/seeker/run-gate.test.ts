import { describe, expect, it } from "vitest"

import { criteriaFor, questionById } from "./questions"
import type { RagFixtureFile } from "./rag"
import { evaluateGate } from "./run-gate"
import {
  ANSWER_RUN_KIND,
  JUDGE_RUN_KIND,
  type AnswerRecord,
  type AnswerRun,
  type CriterionVerdict,
  type JudgeRun,
  type JudgedAnswer,
  type RunIdentity,
} from "./types"

const MODEL = "google/gemma-4-31b-it"
const QUESTION_ID = "q-suffering"
const SECOND_QUESTION_ID = "q-grief-father"

const SERVED_URL = "https://sightlineministry.org/why-suffering"

const FIXTURES: RagFixtureFile = {
  kind: "chat-eval-rag-fixtures",
  capturedAt: "2026-08-03T00:00:00.000Z",
  baseUrl: "http://localhost:8080",
  topK: 5,
  corpusSha256: "corpus-1",
  fixtures: [
    {
      questionId: QUESTION_ID,
      query: "test",
      capturedAt: "2026-08-03T00:00:00.000Z",
      result: {
        status: "ok",
        sources: [
          {
            text: "Passage text.",
            sourceName: "Sightline Ministry",
            title: "Why Suffering?",
            url: SERVED_URL,
            score: 0.9,
          },
        ],
      },
    },
  ],
}

function makeIdentity(overrides: Partial<RunIdentity> = {}): RunIdentity {
  return {
    promptSha256: "prompt-sha-1",
    promptSource: "fallback",
    promptLangfuseVersion: null,
    promptLangfuseLabel: null,
    sectionMappingVersion: "seeker-sections/v1",
    questionSetId: "seeker-eval/v1",
    questionIds: [QUESTION_ID],
    criteriaSha256: "criteria-sha-1",
    answeringModels: [MODEL],
    decoding: { temperature: 0.7, maxTokens: 1_600 },
    sampleId: "s1",
    gitSha: null,
    retrieval: { mode: "tool-loop", corpusSha256: "corpus-1", topK: 5 },
    judge: null,
    ...overrides,
  }
}

function makeAnswer(overrides: Partial<AnswerRecord> = {}): AnswerRecord {
  return {
    questionId: QUESTION_ID,
    category: "intellectual-doubt",
    model: MODEL,
    ok: true,
    text: "A plain conversational answer with no citations at all.",
    finishReason: "stop",
    usage: { input: 500, output: 200 },
    costUsd: 0.0002,
    latencyMs: 3_000,
    toolCalls: [
      {
        name: "retrieveAnswer",
        arguments: JSON.stringify({ query: "why does God allow suffering" }),
        servedFrom: "fixture-fallback",
      },
    ],
    skippedTool: false,
    ...overrides,
  }
}

/** A full protocol-clean verdict set for the question, all satisfied except
 *  the ids in `violated`. */
function makeVerdicts(
  violated: readonly string[] = [],
  questionId = QUESTION_ID,
): CriterionVerdict[] {
  return criteriaFor(questionById(questionId)).map((criterion) => ({
    criterionId: criterion.id,
    verdict: violated.includes(criterion.id) ? "violated" : "satisfied",
    reasoning: "test reasoning",
  }))
}

function makeJudgedCell(overrides: Partial<JudgedAnswer> = {}): JudgedAnswer {
  return {
    questionId: QUESTION_ID,
    category: "intellectual-doubt",
    model: MODEL,
    status: "judged",
    verdicts: makeVerdicts(),
    errors: [],
    retried: false,
    judgeUsage: { input: 1_000, output: 300 },
    judgeCostUsd: 0.002,
    judgeLatencyMs: 2_000,
    ...overrides,
  }
}

function makeRunPair(input: {
  identity?: Partial<RunIdentity>
  answer?: Partial<AnswerRecord>
  judgedCell?: Partial<JudgedAnswer>
  answers?: AnswerRecord[]
  judgedCells?: JudgedAnswer[]
}): { answers: AnswerRun; judged: JudgeRun } {
  const identity = makeIdentity(input.identity)
  return {
    answers: {
      kind: ANSWER_RUN_KIND,
      startedAt: "2026-08-03T00:00:00.000Z",
      finishedAt: "2026-08-03T00:05:00.000Z",
      identity,
      answers: input.answers ?? [makeAnswer(input.answer)],
    },
    judged: {
      kind: JUDGE_RUN_KIND,
      startedAt: "2026-08-03T00:05:00.000Z",
      finishedAt: "2026-08-03T00:06:00.000Z",
      identity: {
        ...identity,
        judge: {
          model: "anthropic/claude-haiku-4.5",
          rubricSha256: "rubric-1",
        },
      },
      judged: input.judgedCells ?? [makeJudgedCell(input.judgedCell)],
    },
  }
}

describe("evaluateGate", () => {
  it("is green when current matches baseline", () => {
    const report = evaluateGate({
      current: makeRunPair({}),
      baseline: makeRunPair({}),
      fixtures: null,
    })
    expect(report.verdict).toBe("green")
    expect(report.newHardFails).toEqual([])
    expect(report.groundingFlips).toEqual([])
    expect(report.promptChanged).toBeNull()
  })

  it("REFUSES cross-identity comparison (different models)", () => {
    const report = evaluateGate({
      current: makeRunPair({
        identity: { answeringModels: ["anthropic/claude-sonnet-5"] },
      }),
      baseline: makeRunPair({}),
      fixtures: null,
    })
    expect(report.verdict).toBe("refused")
    expect(report.refusedOn).toContain("answering models")
  })

  it("does NOT refuse on a prompt change — the prompt is the subject under test", () => {
    const report = evaluateGate({
      current: makeRunPair({
        identity: {
          promptSha256: "prompt-sha-2-softened",
          sectionMappingVersion: "seeker-sections/v2",
        },
      }),
      baseline: makeRunPair({}),
      fixtures: null,
    })
    expect(report.verdict).toBe("green")
    expect(report.promptChanged).toEqual({
      baselineSha256: "prompt-sha-1",
      currentSha256: "prompt-sha-2-softened",
      baselineSource: "fallback",
      currentSource: "fallback",
    })
  })

  it("goes RED on a NEW invented-citation hard-fail (per-cell)", () => {
    const report = evaluateGate({
      current: makeRunPair({
        answer: {
          text: "See this source (Invented Institute, https://invented.example.com/page).",
        },
      }),
      baseline: makeRunPair({}),
      fixtures: FIXTURES,
    })
    expect(report.verdict).toBe("red")
    expect(report.newHardFails).toEqual([
      expect.objectContaining({ checkId: "cited-urls-grounded" }),
      expect.objectContaining({ checkId: "cited-source-names-grounded" }),
    ])
  })

  it("does NOT red a TYPO'D variant of a served URL — reported, not gated", () => {
    const typod = SERVED_URL.replace("ministry", "miristry")
    const report = evaluateGate({
      current: makeRunPair({
        answer: { text: `As Sightline Ministry explains (${typod}).` },
      }),
      baseline: makeRunPair({}),
      fixtures: FIXTURES,
    })
    expect(report.verdict).toBe("green")
    expect(report.newHardFails).toEqual([])
  })

  it("goes RED on ANY skip when the baseline was CLEAN — zero is an absorbing state", () => {
    const report = evaluateGate({
      current: makeRunPair({ answer: { skippedTool: true, toolCalls: [] } }),
      baseline: makeRunPair({}),
      fixtures: null,
    })
    expect(report.verdict).toBe("red")
    expect(report.toolSkipPooled).toEqual({
      baselineCount: 0,
      currentCount: 1,
      regression: true,
    })
  })

  it("never reds on skip MAGNITUDE while the baseline itself skips — the known-fail pin (measured counts 3,2,3,3,4,6)", () => {
    const identity = { questionIds: [QUESTION_ID, SECOND_QUESTION_ID] }
    const cells = (skips: readonly string[]) => ({
      identity,
      answers: [QUESTION_ID, SECOND_QUESTION_ID].map((questionId) =>
        makeAnswer({
          questionId,
          ...(skips.includes(questionId)
            ? { skippedTool: true, toolCalls: [] }
            : {}),
        }),
      ),
      judgedCells: [QUESTION_ID, SECOND_QUESTION_ID].map((questionId) =>
        makeJudgedCell({
          questionId,
          verdicts: makeVerdicts([], questionId),
        }),
      ),
    })
    const report = evaluateGate({
      current: makeRunPair(cells([QUESTION_ID, SECOND_QUESTION_ID])),
      baseline: makeRunPair(cells([QUESTION_ID])),
      fixtures: null,
    })
    expect(report.verdict).toBe("green")
    expect(report.toolSkipPooled).toEqual({
      baselineCount: 1,
      currentCount: 2,
      regression: false,
    })
  })

  it("carries an EQUAL tool-skip count even when the skipped QUESTION moved (the roulette case)", () => {
    const identity = {
      questionIds: [QUESTION_ID, SECOND_QUESTION_ID],
    }
    const baseline = makeRunPair({
      identity,
      answers: [
        makeAnswer({ skippedTool: true, toolCalls: [] }),
        makeAnswer({
          questionId: SECOND_QUESTION_ID,
          category: "pastoral-grief",
        }),
      ],
      judgedCells: [
        makeJudgedCell(),
        makeJudgedCell({
          questionId: SECOND_QUESTION_ID,
          category: "pastoral-grief",
          verdicts: makeVerdicts([], SECOND_QUESTION_ID),
        }),
      ],
    })
    const current = makeRunPair({
      identity,
      answers: [
        makeAnswer(),
        makeAnswer({
          questionId: SECOND_QUESTION_ID,
          category: "pastoral-grief",
          skippedTool: true,
          toolCalls: [],
        }),
      ],
      judgedCells: [
        makeJudgedCell(),
        makeJudgedCell({
          questionId: SECOND_QUESTION_ID,
          category: "pastoral-grief",
          verdicts: makeVerdicts([], SECOND_QUESTION_ID),
        }),
      ],
    })
    const report = evaluateGate({ current, baseline, fixtures: null })
    expect(report.verdict).toBe("green")
    expect(report.toolSkipDeltas).toEqual([
      expect.objectContaining({
        baselineCount: 1,
        currentCount: 1,
        currentCells: [SECOND_QUESTION_ID],
        regression: false,
      }),
    ])
  })

  it("carries tool skips that MOVED between models when the pooled total held (measured stability)", () => {
    const SECOND_MODEL = "google/gemma-4-26b-a4b-it"
    const identity = { answeringModels: [MODEL, SECOND_MODEL] }
    const baseline = makeRunPair({
      identity,
      answers: [
        makeAnswer({ skippedTool: true, toolCalls: [] }),
        makeAnswer({ model: SECOND_MODEL }),
      ],
      judgedCells: [makeJudgedCell(), makeJudgedCell({ model: SECOND_MODEL })],
    })
    const current = makeRunPair({
      identity,
      answers: [
        makeAnswer(),
        makeAnswer({ model: SECOND_MODEL, skippedTool: true, toolCalls: [] }),
      ],
      judgedCells: [makeJudgedCell(), makeJudgedCell({ model: SECOND_MODEL })],
    })
    const report = evaluateGate({ current, baseline, fixtures: null })
    expect(report.verdict).toBe("green")
    expect(report.toolSkipPooled).toEqual({
      baselineCount: 1,
      currentCount: 1,
      regression: false,
    })
    // The per-model breakdown still shows the movement, for the report.
    expect(
      report.toolSkipDeltas.find((delta) => delta.model === SECOND_MODEL)
        ?.regression,
    ).toBe(true)
  })

  it("reports word-count/prose-format count changes without gating on them", () => {
    const bulleted = "* a bullet\n* another bullet"
    const report = evaluateGate({
      current: makeRunPair({ answer: { text: bulleted } }),
      baseline: makeRunPair({}),
      fixtures: null,
    })
    expect(report.verdict).toBe("green")
    expect(
      report.formatDeltas.find((delta) => delta.checkId === "prose-format"),
    ).toEqual(
      expect.objectContaining({
        baselineCount: 0,
        currentCount: 1,
        regression: true,
      }),
    )
  })

  it("goes RED on a grounding-criterion flip WHEN the prompt changed", () => {
    const report = evaluateGate({
      current: makeRunPair({
        identity: { promptSha256: "prompt-sha-2-softened" },
        judgedCell: { verdicts: makeVerdicts(["g-no-invented-citation"]) },
      }),
      baseline: makeRunPair({}),
      fixtures: null,
    })
    expect(report.verdict).toBe("red")
    expect(report.groundingFlips).toEqual([
      expect.objectContaining({
        criterionId: "g-no-invented-citation",
        criterionClass: "grounding",
      }),
    ])
  })

  it("routes a grounding flip on an UNCHANGED prompt to reporting — sampling noise, not a red", () => {
    const report = evaluateGate({
      current: makeRunPair({
        judgedCell: { verdicts: makeVerdicts(["g-no-invented-citation"]) },
      }),
      baseline: makeRunPair({}),
      fixtures: null,
    })
    expect(report.verdict).toBe("green")
    expect(report.groundingFlips).toHaveLength(1)
  })

  it("routes a tone-criterion flip to triage, never red", () => {
    const report = evaluateGate({
      current: makeRunPair({
        identity: { promptSha256: "prompt-sha-2-softened" },
        judgedCell: { verdicts: makeVerdicts(["q-suffering-serious"]) },
      }),
      baseline: makeRunPair({}),
      fixtures: null,
    })
    expect(report.verdict).toBe("green")
    expect(report.groundingFlips).toEqual([])
    expect(report.triageFlips).toEqual([
      expect.objectContaining({
        criterionId: "q-suffering-serious",
        criterionClass: "tone",
      }),
    ])
  })

  it("does not count a violation already violated in the baseline as a flip", () => {
    const violated = {
      identity: { promptSha256: "prompt-sha-2-softened" },
      judgedCell: { verdicts: makeVerdicts(["g-no-invented-citation"]) },
    }
    const report = evaluateGate({
      current: makeRunPair(violated),
      baseline: makeRunPair({
        judgedCell: { verdicts: makeVerdicts(["g-no-invented-citation"]) },
      }),
      fixtures: null,
    })
    expect(report.verdict).toBe("green")
    expect(report.groundingFlips).toEqual([])
  })

  it("reports a beyond-tolerance score drop for triage without going red", () => {
    const report = evaluateGate({
      current: makeRunPair({
        judgedCell: {
          verdicts: makeVerdicts([
            "q-suffering-serious",
            "q-suffering-substance",
            "q-suffering-limits",
          ]),
        },
      }),
      baseline: makeRunPair({}),
      fixtures: null,
      scoreTolerance: 0.05,
    })
    expect(report.verdict).toBe("green")
    expect(report.scoreDelta.beyondTolerance).toBe(true)
    expect(report.scoreDelta.delta).not.toBeNull()
    expect(report.scoreDelta.delta!).toBeLessThan(-0.05)
  })

  it("REFUSES when a judged file does not belong to its answers file", () => {
    const current = makeRunPair({})
    current.judged.identity.answeringModels = ["anthropic/claude-sonnet-5"]
    const report = evaluateGate({
      current,
      baseline: makeRunPair({}),
      fixtures: null,
    })
    expect(report.verdict).toBe("refused")
    expect(report.refusedOn.join(";")).toContain("current answers↔judged")
  })
})
