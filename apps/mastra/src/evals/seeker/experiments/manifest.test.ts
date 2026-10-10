import { describe, expect, it } from "vitest"

import {
  ExperimentManifestSchema,
  validateLifecycleTransition,
} from "./manifest"
import type { ExperimentManifestInput, ResolvedIdentity } from "./types"

function identity(overrides: Partial<ResolvedIdentity> = {}): ResolvedIdentity {
  return {
    prompt: {
      provider: "prompt-provider",
      name: "seeker-system",
      revision: "42",
      contentHash: "a".repeat(64),
    },
    model: {
      routing: "ordered-fallback",
      routes: [
        {
          provider: "model-provider",
          model: "seeker-primary",
          endpoint: "chat-completions",
          maxRetries: 0,
        },
      ],
    },
    decoding: { mode: "provider-default" },
    questionSet: { id: "seeker-eval/v1", questionIds: ["q-1"] },
    criteria: { contentHash: "b".repeat(64) },
    judge: { model: "judge-v1", rubricHash: "c".repeat(64) },
    retrieval: { mode: "fixtures", corpusHash: "d".repeat(64), topK: 5 },
    runtime: { configurationHash: "e".repeat(64) },
    ...overrides,
  }
}

function manifest(
  overrides: Partial<ExperimentManifestInput> = {},
): ExperimentManifestInput {
  const baseline = identity()
  return {
    schemaVersion: "seeker-experiment/v1",
    id: "prompt-tone-2026-08",
    owner: "seeker-team",
    hypothesis: "The revised prompt reduces regressions.",
    criterion: { id: "regression-rate", version: "1", parameters: {} },
    comparisonAxis: "prompt",
    productionBenchmark: {
      path: "evals/results/seeker-baseline/answers.json",
      identity: baseline,
    },
    candidates: [
      {
        id: "revised-prompt",
        identity: identity({
          prompt: {
            ...baseline.prompt,
            revision: "43",
            contentHash: "f".repeat(64),
          },
        }),
      },
    ],
    lifecycle: "draft",
    ...overrides,
  }
}

describe("ExperimentManifestSchema", () => {
  it("accepts prompt and model experiments that vary only their declared axis", () => {
    expect(ExperimentManifestSchema.parse(manifest()).comparisonAxis).toBe(
      "prompt",
    )

    const baseline = identity()
    expect(
      ExperimentManifestSchema.parse(
        manifest({
          id: "model-route-2026-08",
          comparisonAxis: "model",
          productionBenchmark: {
            path: "evals/results/seeker-baseline/answers.json",
            identity: baseline,
          },
          candidates: [
            {
              id: "candidate-route",
              identity: identity({
                model: {
                  routing: "ordered-fallback",
                  routes: [
                    {
                      provider: "model-provider",
                      model: "candidate",
                      endpoint: "chat-completions",
                      maxRetries: 0,
                    },
                  ],
                },
              }),
            },
          ],
        }),
      ).comparisonAxis,
    ).toBe("model")
  })

  it.each([
    "owner",
    "hypothesis",
    "criterion",
    "productionBenchmark",
    "candidates",
    "lifecycle",
  ] as const)(
    "rejects a manifest missing %s with a bounded field path",
    (field) => {
      const input = { ...manifest() } as Record<string, unknown>
      delete input[field]
      const result = ExperimentManifestSchema.safeParse(input)
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues[0]?.path[0]).toBe(field)
    },
  )

  it("rejects zero or multiple causal axes", () => {
    for (const comparisonAxis of [undefined, [], ["prompt", "model"]]) {
      const result = ExperimentManifestSchema.safeParse({
        ...manifest(),
        comparisonAxis,
      })
      expect(result.success).toBe(false)
    }
  })

  it("rejects duplicate candidate IDs and off-axis drift", () => {
    const valid = manifest()
    const duplicate = valid.candidates[0]
    expect(
      ExperimentManifestSchema.safeParse({
        ...valid,
        candidates: [duplicate, duplicate],
      }).success,
    ).toBe(false)

    const drifted = identity({
      prompt: {
        ...identity().prompt,
        revision: "43",
        contentHash: "f".repeat(64),
      },
      decoding: { mode: "parameters", temperature: 0, maxTokens: 1000 },
    })
    const result = ExperimentManifestSchema.safeParse({
      ...valid,
      candidates: [{ id: "drifted", identity: drifted }],
    })
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error.issues[0]?.message).toContain("decoding parameters")
  })

  it("rejects duplicate candidate identities even when IDs differ", () => {
    const valid = manifest()
    expect(
      ExperimentManifestSchema.safeParse({
        ...valid,
        candidates: [
          valid.candidates[0],
          { ...valid.candidates[0], id: "same-prompt-again" },
        ],
      }).success,
    ).toBe(false)
  })

  it.each([
    [
      "model route identity",
      {
        model: {
          ...identity().model,
          routes: [{ ...identity().model.routes[0], model: "other-model" }],
        },
      },
    ],
    ["question set", { questionSet: { id: "other/v1", questionIds: ["q-1"] } }],
    ["criteria", { criteria: { contentHash: "0".repeat(64) } }],
    ["judge", { judge: { model: "other-judge", rubricHash: "c".repeat(64) } }],
    ["retrieval fixtures", { retrieval: { mode: "none" } }],
    [
      "runtime configuration",
      { runtime: { configurationHash: "0".repeat(64) } },
    ],
  ] as const)(
    "prompt experiments refuse off-axis %s drift",
    (problem, override) => {
      const baseline = identity()
      const candidate = identity({
        prompt: {
          ...baseline.prompt,
          revision: "43",
          contentHash: "f".repeat(64),
        },
        ...(override as Partial<ResolvedIdentity>),
      })
      const result = ExperimentManifestSchema.safeParse({
        ...manifest(),
        candidates: [{ id: "drifted", identity: candidate }],
      })
      expect(result.success).toBe(false)
      if (!result.success)
        expect(result.error.issues[0]?.message).toContain(problem)
    },
  )

  it("model experiments refuse prompt revision or hash drift", () => {
    const baseline = identity()
    const result = ExperimentManifestSchema.safeParse(
      manifest({
        comparisonAxis: "model",
        productionBenchmark: {
          path: "evals/results/seeker-baseline/answers.json",
          identity: baseline,
        },
        candidates: [
          {
            id: "drifted-model",
            identity: identity({
              prompt: { ...baseline.prompt, revision: "43" },
              model: {
                ...baseline.model,
                routes: [{ ...baseline.model.routes[0], model: "candidate" }],
              },
            }),
          },
        ],
      }),
    )
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error.issues[0]?.message).toContain("prompt revision")
  })

  it.each(["../escape", "/absolute", "other/root", "has spaces"])(
    "rejects path-unsafe experiment id %s",
    (id) =>
      expect(ExperimentManifestSchema.safeParse(manifest({ id })).success).toBe(
        false,
      ),
  )

  it("does not admit prompt bodies or provider labels as identity authority", () => {
    const input = manifest() as unknown as Record<string, unknown>
    const candidate = (input.candidates as Array<Record<string, unknown>>)[0]
    candidate.identity = {
      ...(candidate.identity as object),
      prompt: {
        ...(candidate.identity as ResolvedIdentity).prompt,
        body: "managed prompt text",
        label: "production",
      },
    }
    expect(ExperimentManifestSchema.safeParse(input).success).toBe(false)
  })
})

describe("lifecycle transitions", () => {
  it.each([
    ["draft", "executing"],
    ["executing", "executing"],
    ["executing", "review-ready"],
  ] as const)("accepts %s -> %s", (from, to) => {
    expect(validateLifecycleTransition(from, to)).toEqual({ ok: true })
  })

  it.each([
    ["draft", "review-ready"],
    ["review-ready", "executing"],
  ] as const)("refuses %s -> %s", (from, to) => {
    expect(validateLifecycleTransition(from, to)).toMatchObject({ ok: false })
  })
})
