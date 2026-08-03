import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  bandFor,
  coerceAnswerRun,
  identityMismatch,
  normalizeLegacyAnswerRun,
  type LegacyAnswerRun,
  type RunIdentity,
} from "./types"

function identity(overrides: Partial<RunIdentity> = {}): RunIdentity {
  return {
    promptSha256: "prompt-sha",
    promptSource: "fallback",
    promptLangfuseVersion: null,
    promptLangfuseLabel: null,
    sectionMappingVersion: "seeker-sections/v1",
    questionSetId: "seeker-eval/v1",
    questionIds: ["q-suffering", "q-grief-father"],
    criteriaSha256: "criteria-sha",
    answeringModels: ["google/gemma-4-31b-it"],
    decoding: { temperature: 0.7, maxTokens: 1600 },
    sampleId: "s1",
    gitSha: "abc1234",
    retrieval: { mode: "fixtures", corpusSha256: "corpus-a", topK: 5 },
    judge: null,
    ...overrides,
  }
}

describe("identityMismatch — refuse-to-compare", () => {
  it("returns no problems for identical identities", () => {
    expect(identityMismatch(identity(), identity())).toEqual([])
  })

  it.each([
    ["prompt", identity({ promptSha256: "other" })],
    ["prompt source", identity({ promptSource: "langfuse" })],
    ["langfuse prompt version", identity({ promptLangfuseVersion: 7 })],
    [
      "section mapping",
      identity({ sectionMappingVersion: "seeker-sections/v2" }),
    ],
    ["question set", identity({ questionSetId: "other/v1" })],
    ["questions", identity({ questionIds: ["q-suffering"] })],
    ["criteria", identity({ criteriaSha256: "other" })],
    ["answering models", identity({ answeringModels: ["other/model"] })],
    [
      "decoding parameters",
      identity({ decoding: { temperature: 0, maxTokens: 1600 } }),
    ],
    [
      "retrieval mode",
      identity({
        retrieval: { mode: "tool-loop", corpusSha256: "corpus-a", topK: 5 },
      }),
    ],
    [
      "corpus snapshot",
      identity({
        retrieval: { mode: "fixtures", corpusSha256: "corpus-b", topK: 5 },
      }),
    ],
  ])("refuses on %s", (problem, changed) => {
    expect(identityMismatch(identity(), changed)).toContain(problem)
  })

  it("does NOT treat sampleId as a mismatch — sampling the same identity is the point", () => {
    expect(
      identityMismatch(
        identity({ sampleId: "s1" }),
        identity({ sampleId: "s2" }),
      ),
    ).toEqual([])
  })

  it("compares the judge stamp only when both sides carry one", () => {
    const judged = identity({
      judge: { model: "anthropic/claude-haiku-4.5", rubricSha256: "r1" },
    })
    // answers run (null judge) pairs with the judge run over it
    expect(identityMismatch(judged, identity())).toEqual([])
    // two judge runs with different rubrics never compare
    const otherRubric = identity({
      judge: { model: "anthropic/claude-haiku-4.5", rubricSha256: "r2" },
    })
    expect(identityMismatch(judged, otherRubric)).toContain("judge rubric")
    const otherModel = identity({
      judge: { model: "anthropic/claude-sonnet-5", rubricSha256: "r1" },
    })
    expect(identityMismatch(judged, otherModel)).toContain("judge model")
  })

  it("generation scope skips criteria and judge — rubric iteration over cached answers", () => {
    const answers = identity({ criteriaSha256: "old-rubric" })
    const judged = identity({
      criteriaSha256: "new-rubric",
      judge: { model: "anthropic/claude-haiku-4.5", rubricSha256: "r1" },
    })
    expect(identityMismatch(judged, answers, "generation")).toEqual([])
    // but generation scope still refuses on anything that shaped the answers
    expect(
      identityMismatch(
        judged,
        identity({ promptSha256: "other" }),
        "generation",
      ),
    ).toContain("prompt")
  })

  it("gate scope skips the prompt fields and section mapping — the prompt is the subject under test", () => {
    const baseline = identity()
    const candidate = identity({
      promptSha256: "softened-prompt-sha",
      promptSource: "langfuse",
      promptLangfuseVersion: 4,
      promptLangfuseLabel: "production",
      sectionMappingVersion: "seeker-sections/v2",
    })
    expect(identityMismatch(candidate, baseline, "gate")).toEqual([])
  })

  it("gate scope still refuses on everything else (criteria, models, corpus, judge)", () => {
    expect(
      identityMismatch(
        identity({ criteriaSha256: "other" }),
        identity(),
        "gate",
      ),
    ).toContain("criteria")
    expect(
      identityMismatch(
        identity({ answeringModels: ["other/model"] }),
        identity(),
        "gate",
      ),
    ).toContain("answering models")
    expect(
      identityMismatch(
        identity({
          retrieval: { mode: "fixtures", corpusSha256: "corpus-b", topK: 5 },
        }),
        identity(),
        "gate",
      ),
    ).toContain("corpus snapshot")
    expect(
      identityMismatch(
        identity({
          judge: { model: "anthropic/claude-haiku-4.5", rubricSha256: "r1" },
        }),
        identity({
          judge: { model: "anthropic/claude-haiku-4.5", rubricSha256: "r2" },
        }),
        "gate",
      ),
    ).toContain("judge rubric")
  })
})

describe("legacy answer-run coercion (reference-runs compatibility)", () => {
  const legacy: LegacyAnswerRun = {
    kind: "chat-eval-answers",
    startedAt: "2026-07-29T07:20:44.983Z",
    finishedAt: "2026-07-29T07:24:35.550Z",
    identity: {
      promptId: "seeker-as-shipped-v1",
      promptSha256: "legacy-prompt-sha",
      questionSetId: "chat-eval-proto/v1",
      questionIds: ["q-suffering"],
      criteriaSha256: "legacy-criteria",
      answeringModels: ["google/gemma-4-31b-it"],
      gitSha: "47b0a189",
      retrieval: { mode: "fixtures", corpusSha256: "corpus", topK: 5 },
    },
    answers: [],
  }

  it("normalizes a prototype-era artifact with the prototype's actual constants", () => {
    const normalized = normalizeLegacyAnswerRun(legacy)
    expect(normalized.kind).toBe("seeker-eval-answers")
    expect(normalized.identity.promptSource).toBe("fallback")
    expect(normalized.identity.sectionMappingVersion).toBe("legacy/unstamped")
    expect(normalized.identity.decoding).toEqual({
      temperature: 0.7,
      maxTokens: 1600,
    })
    expect(normalized.identity.judge).toBeNull()
    // A legacy run must REFUSE to compare against a new-stamped run.
    expect(identityMismatch(normalized.identity, identity())).toContain(
      "section mapping",
    )
  })

  it("coerces both kinds and rejects anything else", () => {
    expect(coerceAnswerRun(legacy).kind).toBe("seeker-eval-answers")
    expect(() => coerceAnswerRun({ kind: "something-else" })).toThrow(
      /not a seeker-eval answers file/,
    )
    expect(() => coerceAnswerRun(null)).toThrow(/not an answers file/)
  })

  it("parses the COMMITTED reference answers file the repeatability gate replays", () => {
    // Real-fixture contract test (mocked-shape-vs-real-contract discipline):
    // the judge-repeatability milestone replays this exact committed file, so
    // its parseability through the legacy path is load-bearing.
    const raw = JSON.parse(
      readFileSync(
        new URL("reference-runs/answers-injected.json", import.meta.url),
        "utf8",
      ),
    ) as unknown
    const run = coerceAnswerRun(raw)
    expect(run.answers).toHaveLength(18)
    expect(run.identity.retrieval).toEqual({
      mode: "fixtures",
      corpusSha256:
        "4909d1b97c9b065ff79d8da0f71907c4259e0d1b96a2b8cabfa73578f7a4fd49",
      topK: 5,
    })
    // Every legacy question id must still exist in the current set — the
    // judge grades them with the CURRENT criteria.
    const currentIds = new Set([
      "q-suffering",
      "q-grief-father",
      "q-trinity",
      "q-living-together",
      "q-python-pdf",
      "q-islam-jesus",
    ])
    for (const id of run.identity.questionIds) {
      expect(currentIds.has(id)).toBe(true)
    }
  })
})

describe("bandFor", () => {
  it("bands bluntly", () => {
    expect(bandFor(0.95)).toBe("pass")
    expect(bandFor(0.9)).toBe("pass")
    expect(bandFor(0.8)).toBe("borderline")
    expect(bandFor(0.5)).toBe("fail")
  })
})
