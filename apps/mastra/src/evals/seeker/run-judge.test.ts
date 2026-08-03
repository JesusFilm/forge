import { fileURLToPath } from "node:url"

import { describe, expect, it, vi } from "vitest"

import { criteriaFor, questionById } from "./questions"
import {
  assertFixtureCorpusMatchesRun,
  collapseAgreeingDuplicates,
  judgeOneAnswer,
  loadFixtures,
  parseVerdicts,
  renderPassagesBlock,
  rubricSha256,
  runRequiresFixtures,
  verdictProtocolProblems,
  type JudgeCompletion,
} from "./run-judge"
import type { RagFixtureFile } from "./rag"
import type { AnswerRecord, CriterionVerdict, RunIdentity } from "./types"

const QUESTION_ID = "q-suffering"
const CRITERIA = criteriaFor(questionById(QUESTION_ID))

function cleanVerdicts(): CriterionVerdict[] {
  return CRITERIA.map((criterion) => ({
    criterionId: criterion.id,
    verdict: "satisfied" as const,
    reasoning: "clearly satisfied because of the opening paragraph",
  }))
}

function answer(extra: Partial<AnswerRecord> = {}): AnswerRecord {
  return {
    questionId: QUESTION_ID,
    category: "intellectual-doubt",
    model: "google/gemma-4-31b-it",
    ok: true,
    text: "A thoughtful, grounded answer.",
    finishReason: "stop",
    usage: { input: 100, output: 100 },
    costUsd: 0.0001,
    latencyMs: 900,
    ...extra,
  }
}

function completionReturning(
  batches: CriterionVerdict[][],
): JudgeCompletion & ReturnType<typeof vi.fn> {
  let call = 0
  return vi.fn(async () => {
    const value = batches[Math.min(call, batches.length - 1)]
    call += 1
    return { value, usage: { input: 10, output: 10 }, latencyMs: 50 }
  }) as JudgeCompletion & ReturnType<typeof vi.fn>
}

describe("verdictProtocolProblems — the amended protocol", () => {
  it("accepts a clean, complete verdict set", () => {
    expect(verdictProtocolProblems(cleanVerdicts(), CRITERIA)).toEqual([])
  })

  it("flags a missing criterion", () => {
    const verdicts = cleanVerdicts().slice(1)
    expect(verdictProtocolProblems(verdicts, CRITERIA)).toEqual([
      `missing verdict for ${CRITERIA[0].id}`,
    ])
  })

  it("flags duplicate verdicts for one criterion", () => {
    const verdicts = [...cleanVerdicts(), cleanVerdicts()[0]]
    expect(verdictProtocolProblems(verdicts, CRITERIA)).toContain(
      `duplicate verdicts for ${CRITERIA[0].id}`,
    )
  })

  it("flags a verdict for an unknown criterion", () => {
    const verdicts = [
      ...cleanVerdicts(),
      {
        criterionId: "q-ghost",
        verdict: "satisfied" as const,
        reasoning: "ghost",
      },
    ]
    expect(verdictProtocolProblems(verdicts, CRITERIA)).toContain(
      "verdict for unknown criterion q-ghost",
    )
  })

  it("flags a verdict outside the binary vocabulary — including the retired 'not-applicable'", () => {
    const verdicts = cleanVerdicts()
    verdicts[0] = {
      ...verdicts[0],
      verdict: "not-applicable" as unknown as CriterionVerdict["verdict"],
    }
    const problems = verdictProtocolProblems(verdicts, CRITERIA)
    expect(
      problems.some((problem) => problem.includes("invalid verdict")),
    ).toBe(true)
  })

  it("flags empty reasoning — reasoning is REQUIRED", () => {
    const verdicts = cleanVerdicts()
    verdicts[0] = { ...verdicts[0], reasoning: "   " }
    expect(verdictProtocolProblems(verdicts, CRITERIA)).toEqual([
      `${verdicts[0].criterionId}: empty reasoning`,
    ])
  })
})

describe("collapseAgreeingDuplicates", () => {
  it("drops identical repeats and keeps disagreements", () => {
    const [first] = cleanVerdicts()
    const conflicting = { ...first, verdict: "violated" as const }
    expect(collapseAgreeingDuplicates([first, first, first])).toEqual([first])
    expect(collapseAgreeingDuplicates([first, conflicting])).toEqual([
      first,
      conflicting,
    ])
  })
})

describe("judgeOneAnswer — retry once, then invalid", () => {
  it("judges on the first clean attempt without retrying", async () => {
    const complete = completionReturning([cleanVerdicts()])
    const result = await judgeOneAnswer(answer(), {
      complete,
      fixtures: null,
    })
    expect(result.status).toBe("judged")
    expect(result.retried).toBe(false)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it("retries a malformed first attempt and accepts a clean second (the retry MECHANISM)", async () => {
    const malformed = cleanVerdicts().slice(1) // missing one criterion
    const complete = completionReturning([malformed, cleanVerdicts()])
    const result = await judgeOneAnswer(answer(), {
      complete,
      fixtures: null,
    })
    expect(result.status).toBe("judged")
    expect(result.retried).toBe(true)
    expect(complete).toHaveBeenCalledTimes(2)
    // Usage accumulates across BOTH attempts — the retry is paid for.
    expect(result.judgeUsage).toEqual({ input: 20, output: 20 })
  })

  it("marks the cell invalid after two malformed attempts — never a third call", async () => {
    const malformed = cleanVerdicts().slice(1)
    const complete = completionReturning([malformed, malformed])
    const result = await judgeOneAnswer(answer(), {
      complete,
      fixtures: null,
    })
    expect(result.status).toBe("invalid")
    expect(result.retried).toBe(true)
    expect(result.errors).toEqual([`missing verdict for ${CRITERIA[0].id}`])
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it("maps a failed answer to answer-error WITHOUT calling the judge (fail-before-spending)", async () => {
    const complete = completionReturning([cleanVerdicts()])
    const failed = await judgeOneAnswer(
      answer({ ok: false, text: null, error: "429: rate limited" }),
      { complete, fixtures: null },
    )
    expect(failed.status).toBe("answer-error")
    expect(failed.errors).toEqual(["429: rate limited"])
    expect(complete).not.toHaveBeenCalled()

    const truncated = await judgeOneAnswer(answer({ finishReason: "length" }), {
      complete,
      fixtures: null,
    })
    expect(truncated.status).toBe("answer-error")
    expect(complete).not.toHaveBeenCalled()
  })

  it("accepts an AGREEING duplicate as stutter — collapsed, judged on attempt 1", async () => {
    // The first real run measured haiku stuttering (repeating an entry with
    // the same verdict) on 7 of 20 cells; agreement is not ambiguity.
    const stuttered = [...cleanVerdicts(), { ...cleanVerdicts()[0] }]
    const complete = completionReturning([stuttered])
    const result = await judgeOneAnswer(answer(), {
      complete,
      fixtures: null,
    })
    expect(result.status).toBe("judged")
    expect(result.retried).toBe(false)
    expect(complete).toHaveBeenCalledTimes(1)
    // Exactly one verdict per criterion survives the collapse.
    expect(result.verdicts).toHaveLength(CRITERIA.length)
  })

  it("keeps a DISAGREEING duplicate as a protocol error — retried, then invalid", async () => {
    const conflicted = [
      ...cleanVerdicts(),
      { ...cleanVerdicts()[0], verdict: "violated" as const },
    ]
    const complete = completionReturning([conflicted, conflicted])
    const result = await judgeOneAnswer(answer(), {
      complete,
      fixtures: null,
    })
    expect(result.status).toBe("invalid")
    expect(result.retried).toBe(true)
    expect(result.errors).toEqual([`duplicate verdicts for ${CRITERIA[0].id}`])
  })

  it("marks a thrown judge call invalid without a protocol retry", async () => {
    const complete = vi.fn(async () => {
      throw new Error("network down")
    }) as unknown as JudgeCompletion & ReturnType<typeof vi.fn>
    const result = await judgeOneAnswer(answer(), {
      complete,
      fixtures: null,
    })
    expect(result.status).toBe("invalid")
    expect(result.errors[0]).toContain("judge call failed")
    // Transport retries live inside the HTTP client; the protocol retry is
    // reserved for malformed OUTPUT only (the amendment's exact scope).
    expect(complete).toHaveBeenCalledTimes(1)
  })
})

describe("parseVerdicts", () => {
  it("parses the judge's wire shape structurally", () => {
    const parsed = parseVerdicts({
      verdicts: [
        { criterionId: "a", verdict: "satisfied", reasoning: "because" },
      ],
    })
    expect(parsed).toEqual([
      { criterionId: "a", verdict: "satisfied", reasoning: "because" },
    ])
  })

  it("throws when there is no verdicts array", () => {
    expect(() => parseVerdicts({})).toThrow(/no verdicts array/)
  })
})

describe("renderPassagesBlock", () => {
  const fixtures: RagFixtureFile = {
    kind: "chat-eval-rag-fixtures",
    capturedAt: "2026-08-01T00:00:00.000Z",
    baseUrl: "http://localhost:8080",
    topK: 5,
    corpusSha256: "corpus",
    fixtures: [
      {
        questionId: QUESTION_ID,
        query: "q",
        capturedAt: "2026-08-01T00:00:00.000Z",
        result: {
          status: "ok",
          sources: [
            {
              text: "Passage text here.",
              sourceName: "Cru",
              title: "A Title",
              url: "https://example.com/a",
              score: 0.5,
            },
          ],
        },
      },
    ],
  }

  it("shows the judge the passages served for the question", () => {
    const block = renderPassagesBlock(fixtures, QUESTION_ID)
    expect(block).toContain("<PASSAGES>")
    expect(block).toContain("source: Cru — A Title")
    expect(block).toContain("Passage text here.")
  })

  it("states plainly when no passages were served", () => {
    expect(renderPassagesBlock(fixtures, "q-unknown")).toContain(
      "No passages were served",
    )
    expect(renderPassagesBlock(null, QUESTION_ID)).toContain(
      "No passages were served",
    )
  })
})

describe("rubricSha256", () => {
  it("is stable for a fixed rubric", () => {
    expect(rubricSha256()).toBe(rubricSha256())
    expect(rubricSha256()).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("fixtures policy — mode-aware, fail-closed (finding #12)", () => {
  function makeIdentity(overrides: Partial<RunIdentity> = {}): RunIdentity {
    return {
      promptSha256: "prompt-sha",
      promptSource: "fallback",
      promptLangfuseVersion: null,
      promptLangfuseLabel: null,
      sectionMappingVersion: "seeker-sections/v1",
      questionSetId: "seeker-eval/v1",
      questionIds: [QUESTION_ID],
      criteriaSha256: "criteria-sha",
      answeringModels: ["google/gemma-4-31b-it"],
      decoding: { temperature: 0.7, maxTokens: 1_600 },
      sampleId: "s1",
      gitSha: null,
      retrieval: { mode: "tool-loop", corpusSha256: "corpus", topK: 5 },
      judge: null,
      ...overrides,
    }
  }

  const corpusFixtures: RagFixtureFile = {
    kind: "chat-eval-rag-fixtures",
    capturedAt: "2026-08-01T00:00:00.000Z",
    baseUrl: "http://localhost:8080",
    topK: 5,
    corpusSha256: "corpus",
    fixtures: [],
  }

  it("requires fixtures for fixture-world runs; only mode 'none' may judge without", () => {
    expect(
      runRequiresFixtures({ mode: "fixtures", corpusSha256: "c", topK: 5 }),
    ).toBe(true)
    expect(
      runRequiresFixtures({ mode: "tool-loop", corpusSha256: "c", topK: 5 }),
    ).toBe(true)
    expect(runRequiresFixtures({ mode: "none" })).toBe(false)
    expect(runRequiresFixtures(undefined)).toBe(false)
  })

  it("refuses a fixtures file whose corpus differs from the run's stamp", () => {
    expect(() =>
      assertFixtureCorpusMatchesRun({
        fixtures: { ...corpusFixtures, corpusSha256: "corpus-recaptured" },
        identity: makeIdentity(),
        allowCorpusMismatch: false,
      }),
    ).toThrow(/--allow-corpus-mismatch/)
  })

  it("lets an explicit legacy replay through", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      expect(() =>
        assertFixtureCorpusMatchesRun({
          fixtures: { ...corpusFixtures, corpusSha256: "corpus-recaptured" },
          identity: makeIdentity(),
          allowCorpusMismatch: true,
        }),
      ).not.toThrow()
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it("passes silently on a matching corpus", () => {
    expect(() =>
      assertFixtureCorpusMatchesRun({
        fixtures: corpusFixtures,
        identity: makeIdentity(),
        allowCorpusMismatch: false,
      }),
    ).not.toThrow()
  })
})

describe("loadFixtures — fail closed (finding #12)", () => {
  it("throws a distinct error when the file is absent", async () => {
    await expect(
      loadFixtures(
        fileURLToPath(new URL("./no-such-fixtures.json", import.meta.url)),
      ),
    ).rejects.toThrow(/fixtures file not found/)
  })

  it("throws a distinct error when the file is not valid JSON", async () => {
    await expect(
      loadFixtures(fileURLToPath(new URL("./run-judge.ts", import.meta.url))),
    ).rejects.toThrow(/not valid JSON/)
  })

  it("throws when the file is valid JSON of the wrong kind", async () => {
    await expect(
      loadFixtures(
        fileURLToPath(
          new URL("./reference-runs/answers-injected.json", import.meta.url),
        ),
      ),
    ).rejects.toThrow(/not a chat-eval RAG fixture file/)
  })
})
