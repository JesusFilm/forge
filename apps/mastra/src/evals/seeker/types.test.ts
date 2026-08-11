import { describe, expect, it } from "vitest"

import {
  bandFor,
  coerceAnswerRun,
  experimentIdentityMismatch,
  identityMismatch,
  normalizeLegacyAnswerRun,
  stampedCorpusSha,
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
    answeringModels: ["anthropic/claude-sonnet-5"],
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
    // Decision 2026-08-04 (#14): a provider-default (null) run and a
    // pinned run are different sampling distributions — never comparable.
    ["decoding parameters", identity({ decoding: null })],
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

  it("compares two provider-default (decoding: null) runs as equal", () => {
    expect(
      identityMismatch(
        identity({ decoding: null }),
        identity({ decoding: null }),
      ),
    ).toEqual([])
  })

  it("does NOT treat sampleId as a mismatch — sampling the same identity is the point", () => {
    expect(
      identityMismatch(
        identity({ sampleId: "s1" }),
        identity({ sampleId: "s2" }),
      ),
    ).toEqual([])
  })

  it("compares the weights stamp only when both sides carry one — absent means legacy-compatible", () => {
    const stamped = identity({ weightsSha256: "w-1" })
    const restamped = identity({ weightsSha256: "w-2-reclassified" })
    // Two runs that BOTH stamp a weighting scheme must agree on it.
    expect(identityMismatch(stamped, restamped)).toContain("weights")
    // A pre-stamp artifact (committed baseline / reference runs) pairs with
    // a stamped run — no refusal, the field did not exist when it was
    // written.
    expect(identityMismatch(stamped, identity())).toEqual([])
    expect(identityMismatch(identity(), identity())).toEqual([])
    // Gate scope refuses on it too; generation scope never compares it.
    expect(identityMismatch(stamped, restamped, "gate")).toContain("weights")
    expect(identityMismatch(stamped, restamped, "generation")).not.toContain(
      "weights",
    )
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

describe("experimentIdentityMismatch — exactly one causal axis", () => {
  it("prompt axis ignores only prompt identity", () => {
    const baseline = identity()
    expect(
      experimentIdentityMismatch(
        baseline,
        identity({
          promptSha256: "candidate",
          promptLangfuseVersion: 42,
          promptLangfuseLabel: "intake-only",
        }),
        "prompt",
      ),
    ).toEqual([])
    expect(
      experimentIdentityMismatch(
        baseline,
        identity({ promptSha256: "candidate", decoding: null }),
        "prompt",
      ),
    ).toContain("decoding parameters")
  })

  it("model axis ignores only answering model identity", () => {
    const baseline = identity()
    expect(
      experimentIdentityMismatch(
        baseline,
        identity({ answeringModels: ["candidate/model"] }),
        "model",
      ),
    ).toEqual([])
    expect(
      experimentIdentityMismatch(
        baseline,
        identity({
          answeringModels: ["candidate/model"],
          promptSha256: "other",
        }),
        "model",
      ),
    ).toContain("prompt")
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
      answeringModels: ["anthropic/claude-sonnet-5"],
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
})

describe("bandFor", () => {
  it("bands bluntly", () => {
    expect(bandFor(0.95)).toBe("pass")
    expect(bandFor(0.9)).toBe("pass")
    expect(bandFor(0.8)).toBe("borderline")
    expect(bandFor(0.5)).toBe("fail")
  })
})

describe("stampedCorpusSha", () => {
  it("returns the stamped corpus for fixture-world modes and null otherwise", () => {
    expect(
      stampedCorpusSha(
        identity({
          retrieval: { mode: "fixtures", corpusSha256: "c1", topK: 5 },
        }),
      ),
    ).toBe("c1")
    expect(
      stampedCorpusSha(
        identity({
          retrieval: { mode: "tool-loop", corpusSha256: "c2", topK: 5 },
        }),
      ),
    ).toBe("c2")
    expect(
      stampedCorpusSha(identity({ retrieval: { mode: "none" } })),
    ).toBeNull()
    // Unstamped legacy artifacts must report null, never crash.
    expect(
      stampedCorpusSha(
        identity({
          retrieval: undefined as unknown as RunIdentity["retrieval"],
        }),
      ),
    ).toBeNull()
  })
})
