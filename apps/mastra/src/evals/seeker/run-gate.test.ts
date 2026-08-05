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

const MODEL = "anthropic/claude-sonnet-5"
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
      fixtures: FIXTURES,
    })
    expect(report.verdict).toBe("green")
    expect(report.newHardFails).toEqual([])
    expect(report.groundingFlips).toEqual([])
    expect(report.promptChanged).toBeNull()
  })

  it("REFUSES cross-identity comparison (different models)", () => {
    const report = evaluateGate({
      current: makeRunPair({
        identity: { answeringModels: ["other/model"] },
      }),
      baseline: makeRunPair({}),
      fixtures: FIXTURES,
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
      fixtures: FIXTURES,
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

  it("goes RED on ANY current-run tool skip — decision 2026-08-04, unconditional", () => {
    const report = evaluateGate({
      current: makeRunPair({ answer: { skippedTool: true, toolCalls: [] } }),
      baseline: makeRunPair({}),
      fixtures: FIXTURES,
    })
    expect(report.verdict).toBe("red")
    expect(report.toolSkipPooled).toEqual({
      baselineCount: 0,
      currentCount: 1,
      regression: true,
    })
  })

  it("REFUSES a baseline containing any tool skip — a skipping run is not a valid known-good", () => {
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
      current: makeRunPair(cells([])),
      baseline: makeRunPair(cells([QUESTION_ID])),
      fixtures: FIXTURES,
    })
    expect(report.verdict).toBe("refused")
    expect(report.refusedOn.join(";")).toMatch(
      /baseline contains 1 tool skip.*re-capture a clean baseline/,
    )
    expect(report.toolSkipPooled).toEqual({
      baselineCount: 1,
      currentCount: 0,
      regression: false,
    })
  })

  it("names the skipping cell when a current-run skip reds", () => {
    const identity = { questionIds: [QUESTION_ID, SECOND_QUESTION_ID] }
    const cleanCells = {
      identity,
      answers: [
        makeAnswer(),
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
    }
    const current = makeRunPair({
      ...cleanCells,
      answers: [
        makeAnswer(),
        makeAnswer({
          questionId: SECOND_QUESTION_ID,
          category: "pastoral-grief",
          skippedTool: true,
          toolCalls: [],
        }),
      ],
    })
    const report = evaluateGate({
      current,
      baseline: makeRunPair(cleanCells),
      fixtures: FIXTURES,
    })
    expect(report.verdict).toBe("red")
    expect(report.toolSkipDeltas).toEqual([
      expect.objectContaining({
        baselineCount: 0,
        currentCount: 1,
        currentCells: [SECOND_QUESTION_ID],
        regression: true,
      }),
    ])
  })

  it("reports word-count/prose-format count changes without gating on them", () => {
    const bulleted = "* a bullet\n* another bullet"
    const report = evaluateGate({
      current: makeRunPair({ answer: { text: bulleted } }),
      baseline: makeRunPair({}),
      fixtures: FIXTURES,
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

  it("goes RED on a grounding flip (prompt changed) ONLY when the confirm run reproduces it", () => {
    const flipped = {
      identity: { promptSha256: "prompt-sha-2-softened" },
      judgedCell: { verdicts: makeVerdicts(["g-no-invented-citation"]) },
    }
    const report = evaluateGate({
      current: makeRunPair(flipped),
      baseline: makeRunPair({}),
      fixtures: FIXTURES,
      confirmJudged: makeRunPair(flipped).judged,
    })
    expect(report.verdict).toBe("red")
    expect(report.confirmedGroundingFlips).toEqual([
      expect.objectContaining({
        criterionId: "g-no-invented-citation",
        criterionClass: "grounding",
      }),
    ])
    expect(report.unconfirmedGroundingFlips).toEqual([])
  })

  it("does NOT red an UNREPRODUCED flip — surfaced as unconfirmed noise, never dropped", () => {
    const report = evaluateGate({
      current: makeRunPair({
        identity: { promptSha256: "prompt-sha-2-softened" },
        judgedCell: { verdicts: makeVerdicts(["g-no-invented-citation"]) },
      }),
      baseline: makeRunPair({}),
      fixtures: FIXTURES,
      // Confirmation run of the same candidate: criterion satisfied.
      confirmJudged: makeRunPair({
        identity: { promptSha256: "prompt-sha-2-softened" },
      }).judged,
    })
    expect(report.verdict).toBe("green")
    expect(report.confirmedGroundingFlips).toEqual([])
    expect(report.unconfirmedGroundingFlips).toEqual([
      expect.objectContaining({ criterionId: "g-no-invented-citation" }),
    ])
    // The raw flip stays visible too — noise is reported, not erased.
    expect(report.groundingFlips).toHaveLength(1)
  })

  it("REFUSES (demands a confirmation run) when a prompt-change flip has no --confirm-judged input", () => {
    const report = evaluateGate({
      current: makeRunPair({
        identity: { promptSha256: "prompt-sha-2-softened" },
        judgedCell: { verdicts: makeVerdicts(["g-no-invented-citation"]) },
      }),
      baseline: makeRunPair({}),
      fixtures: FIXTURES,
    })
    expect(report.verdict).toBe("refused")
    expect(report.refusedOn.join(";")).toContain("--confirm-judged")
    // Fail-safe, not silent: the flip itself is still in the report.
    expect(report.groundingFlips).toHaveLength(1)
  })

  it("REFUSES a confirm run that is not the same candidate (identity mismatch)", () => {
    const report = evaluateGate({
      current: makeRunPair({
        identity: { promptSha256: "prompt-sha-2-softened" },
        judgedCell: { verdicts: makeVerdicts(["g-no-invented-citation"]) },
      }),
      baseline: makeRunPair({}),
      fixtures: FIXTURES,
      // Confirm run generated under a DIFFERENT prompt — not a confirmation.
      confirmJudged: makeRunPair({
        identity: { promptSha256: "prompt-sha-3-other" },
        judgedCell: { verdicts: makeVerdicts(["g-no-invented-citation"]) },
      }).judged,
    })
    expect(report.verdict).toBe("refused")
    expect(report.refusedOn.join(";")).toContain("confirm run: prompt")
  })

  it("routes a grounding flip on an UNCHANGED prompt to reporting — sampling noise, not a red", () => {
    const report = evaluateGate({
      current: makeRunPair({
        judgedCell: { verdicts: makeVerdicts(["g-no-invented-citation"]) },
      }),
      baseline: makeRunPair({}),
      fixtures: FIXTURES,
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
      fixtures: FIXTURES,
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
      fixtures: FIXTURES,
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
      fixtures: FIXTURES,
      scoreTolerance: 0.05,
    })
    expect(report.verdict).toBe("green")
    expect(report.scoreDelta.beyondTolerance).toBe(true)
    expect(report.scoreDelta.delta).not.toBeNull()
    expect(report.scoreDelta.delta!).toBeLessThan(-0.05)
  })

  it("REFUSES when a judged file does not belong to its answers file", () => {
    const current = makeRunPair({})
    current.judged.identity.answeringModels = ["other/model"]
    const report = evaluateGate({
      current,
      baseline: makeRunPair({}),
      fixtures: FIXTURES,
    })
    expect(report.verdict).toBe("refused")
    expect(report.refusedOn.join(";")).toContain("current answers↔judged")
  })

  it("treats an infra-failed cell (ok:false, skippedTool stamped) as NO tool decision — clean baseline stays green", () => {
    // run-loop stamps `skippedTool: calls.length === 0` on ok:false cells
    // (an OpenRouter 401/429/timeout before any tool round-trip). Without
    // the checks.ts ok-guard this reds the zero-skip absorbing rule as if
    // the model chose to skip retrieval.
    const report = evaluateGate({
      current: makeRunPair({
        answer: {
          ok: false,
          text: null,
          finishReason: null,
          error: "429: rate limited",
          toolCalls: [],
          skippedTool: true,
        },
      }),
      baseline: makeRunPair({}),
      fixtures: FIXTURES,
    })
    expect(report.verdict).toBe("green")
    expect(report.toolSkipPooled).toEqual({
      baselineCount: 0,
      currentCount: 0,
      regression: false,
    })
    expect(report.newHardFails).toEqual([])
  })

  it("carries an invented citation ONLY when the same offending URL was in the baseline cell", () => {
    const carriedUrl = "https://invented.example.com/known-bad"
    const report = evaluateGate({
      current: makeRunPair({
        answer: { text: `See ${carriedUrl} for more.` },
      }),
      baseline: makeRunPair({
        answer: { text: `Consider ${carriedUrl} today.` },
      }),
      fixtures: FIXTURES,
    })
    expect(report.verdict).toBe("green")
    expect(report.newHardFails).toEqual([])
    expect(report.carriedKnownFails).toEqual([
      expect.objectContaining({
        checkId: "cited-urls-grounded",
        details: [carriedUrl],
      }),
    ])
  })

  it("goes RED when the same cell + check gains a DIFFERENT invented URL — a carried pin never blankets the check", () => {
    const report = evaluateGate({
      current: makeRunPair({
        answer: { text: "See https://invented.example.com/brand-new-bad." },
      }),
      baseline: makeRunPair({
        answer: { text: "See https://invented.example.com/known-bad." },
      }),
      fixtures: FIXTURES,
    })
    expect(report.verdict).toBe("red")
    expect(report.newHardFails).toEqual([
      expect.objectContaining({
        checkId: "cited-urls-grounded",
        details: ["https://invented.example.com/brand-new-bad"],
      }),
    ])
    expect(report.carriedKnownFails).toEqual([])
  })

  it("REFUSES an all-invalid judged run — a run that never graded an answer certifies nothing", () => {
    const report = evaluateGate({
      current: makeRunPair({
        judgedCell: {
          status: "invalid",
          verdicts: undefined,
          errors: ["judge call failed: 503"],
        },
      }),
      baseline: makeRunPair({}),
      fixtures: FIXTURES,
    })
    expect(report.verdict).toBe("refused")
    expect(report.refusedOn.join(";")).toContain("current coverage")
    expect(report.invalidCells).toEqual({ baseline: 0, current: 1 })
    expect(report.answerErrorCells).toEqual({ baseline: 0, current: 0 })
  })

  it("surfaces answerErrorCells beside invalidCells in the coverage refusal", () => {
    const report = evaluateGate({
      current: makeRunPair({
        judgedCell: {
          status: "answer-error",
          verdicts: undefined,
          errors: ["answering model returned no text"],
        },
      }),
      baseline: makeRunPair({}),
      fixtures: FIXTURES,
    })
    expect(report.verdict).toBe("refused")
    expect(report.answerErrorCells).toEqual({ baseline: 0, current: 1 })
  })

  it("REFUSES a fixture-world run pair when no fixtures were loaded — the citation lane must not silently vacate", () => {
    const report = evaluateGate({
      current: makeRunPair({}),
      baseline: makeRunPair({}),
      fixtures: null,
    })
    expect(report.verdict).toBe("refused")
    expect(report.refusedOn.join(";")).toMatch(/fixtures.*tool-loop/)
    expect(report.fixturesCorpusSha256).toBeNull()
  })

  it("gates mode-'none' run pairs without fixtures — the only mode allowed to", () => {
    const noRetrieval = {
      identity: { retrieval: { mode: "none" as const } },
      answer: { toolCalls: undefined, skippedTool: undefined },
    }
    const report = evaluateGate({
      current: makeRunPair(noRetrieval),
      baseline: makeRunPair(noRetrieval),
      fixtures: null,
    })
    expect(report.verdict).toBe("green")
    expect(report.fixturesCorpusSha256).toBeNull()
  })

  it("REFUSES when the fixture file's corpus differs from the runs' stamped corpus", () => {
    const report = evaluateGate({
      current: makeRunPair({}),
      baseline: makeRunPair({}),
      fixtures: { ...FIXTURES, corpusSha256: "corpus-recaptured" },
    })
    expect(report.verdict).toBe("refused")
    expect(report.refusedOn).toHaveLength(2) // both runs named
    expect(report.refusedOn.join(";")).toContain("--allow-corpus-mismatch")
  })

  it("allows a deliberate legacy replay through allowCorpusMismatch", () => {
    const report = evaluateGate({
      current: makeRunPair({}),
      baseline: makeRunPair({}),
      fixtures: { ...FIXTURES, corpusSha256: "corpus-recaptured" },
      allowCorpusMismatch: true,
    })
    expect(report.verdict).toBe("green")
  })

  it("stamps the fixture file's corpus into the gate report", () => {
    const report = evaluateGate({
      current: makeRunPair({}),
      baseline: makeRunPair({}),
      fixtures: FIXTURES,
    })
    expect(report.fixturesCorpusSha256).toBe("corpus-1")
  })

  it("REFUSES when both runs stamp a weights fingerprint and they differ — a reclassification is not the same measurement", () => {
    const report = evaluateGate({
      current: makeRunPair({ identity: { weightsSha256: "w-2-reclassified" } }),
      baseline: makeRunPair({ identity: { weightsSha256: "w-1" } }),
      fixtures: FIXTURES,
    })
    expect(report.verdict).toBe("refused")
    expect(report.refusedOn).toContain("weights")
  })

  it("does NOT refuse when the baseline predates the weights stamp — legacy artifacts stay gateable", () => {
    const report = evaluateGate({
      current: makeRunPair({ identity: { weightsSha256: "w-1" } }),
      baseline: makeRunPair({}),
      fixtures: FIXTURES,
    })
    expect(report.verdict).toBe("green")
  })
})

// The fail-closed loadFixtures loader (finding #4) is consolidated in cli.ts
// (decision 2026-08-04 #9) and tested in cli.test.ts.
