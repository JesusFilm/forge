import { describe, expect, it, vi } from "vitest"

import {
  EmbeddingProviderError,
  EXPECTED_EXPERIENCE_EMBEDDING_DIMENSIONS,
  type EmbeddingProviderResult,
} from "../../services/embedding-provider"
import {
  experienceEmbeddingWorkflow,
  handleExperienceEmbeddingRouteRequest,
  planExperienceEmbeddingRun,
  runExperienceEmbeddingWorkflow,
  type ExperienceEmbeddingWorkflowInput,
  _internals,
} from "./experience-embedding"

const vector = (seed: number) =>
  Array.from(
    { length: EXPECTED_EXPERIENCE_EMBEDDING_DIMENSIONS },
    (_, index) => seed + index / 1000,
  )

function sourceText() {
  return "Hope\n\nA story of hope.\n\nJesus brings hope."
}

function sourceHash(text = sourceText()) {
  return _internals.sha256Text(text)
}

function input(
  overrides: Partial<ExperienceEmbeddingWorkflowInput> = {},
): ExperienceEmbeddingWorkflowInput {
  const base: ExperienceEmbeddingWorkflowInput = {
    target: {
      experienceId: "exp-1",
      experienceLocaleId: "loc-1",
      locale: "en",
      slug: "hope",
    },
    source: {
      text: sourceText(),
      contentHash: sourceHash(),
      summary: "chars=42;lines=3;title=present;meta=present;og=absent",
    },
    mode: "idempotent",
  }

  return { ...base, ...overrides } as ExperienceEmbeddingWorkflowInput
}

function embeddingResult(items: string[]): EmbeddingProviderResult {
  return {
    embeddings: items.map((_, index) => vector(index + 1)),
    dimensions: EXPECTED_EXPERIENCE_EMBEDDING_DIMENSIONS,
    tokenCount: items.length * 5,
    model: "openai/text-embedding-3-small",
    provider: "openai",
    requestModel: "text-embedding-3-small",
  }
}

function adminSuccessResult(payload: {
  target: {
    experienceId: string
    experienceLocaleId: string
    locale: string
  }
  model: { name: string; dimensions: number }
  generation: { mastraRunId: string }
}) {
  return {
    ok: true as const,
    result: {
      status: "created" as const,
      target: {
        experienceId: payload.target.experienceId,
        experienceLocaleId: payload.target.experienceLocaleId,
        locale: payload.target.locale,
      },
      model: payload.model.name,
      dimensions: payload.model.dimensions,
      mastraRunId: payload.generation.mastraRunId,
    },
  }
}

describe("experience embedding workflow", () => {
  it("submits one Admin ingest payload with aligned vector and provenance", async () => {
    const embeddingRequester = vi.fn(async (items: string[]) =>
      embeddingResult(items),
    )
    const adminIngestClient = vi.fn(async (payload) =>
      adminSuccessResult(payload),
    )

    const result = await runExperienceEmbeddingWorkflow(input(), {
      runId: "run-experience",
      generatedAt: "2026-05-26T01:00:00.000Z",
      embeddingRequester,
      adminIngestClient,
    })

    expect(result).toMatchObject({
      ok: true,
      status: "created",
    })
    expect(JSON.stringify(result)).not.toContain("mastraRunId")
    expect(JSON.stringify(result)).not.toContain("providerTokens")
    expect(JSON.stringify(result)).not.toContain(
      "openai/text-embedding-3-small",
    )
    expect(embeddingRequester).toHaveBeenCalledWith(
      [sourceText()],
      expect.objectContaining({
        expectedDimensions: EXPECTED_EXPERIENCE_EMBEDDING_DIMENSIONS,
      }),
    )
    expect(adminIngestClient).toHaveBeenCalledWith(
      expect.objectContaining({
        target: {
          experienceId: "exp-1",
          experienceLocaleId: "loc-1",
          locale: "en",
          slug: "hope",
        },
        source: {
          contentHash: sourceHash(),
          summary: "chars=42;lines=3;title=present;meta=present;og=absent",
        },
        generation: {
          mode: "idempotent",
          generatedAt: "2026-05-26T01:00:00.000Z",
          mastraRunId: "run-experience",
        },
        embedding: vector(1),
      }),
    )
  })

  it("rejects stale source hashes before provider calls", async () => {
    const embeddingRequester = vi.fn(async (items: string[]) =>
      embeddingResult(items),
    )

    await expect(
      runExperienceEmbeddingWorkflow(
        input({
          source: {
            ...input().source,
            contentHash: "sha256:stale",
          },
        }),
        { runId: "run-stale", embeddingRequester },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid_input",
      retryable: false,
    })
    expect(embeddingRequester).not.toHaveBeenCalled()
  })

  it("maps provider and Admin failures to safe typed failures", async () => {
    await expect(
      runExperienceEmbeddingWorkflow(input(), {
        runId: "run-provider",
        embeddingRequester: async () => {
          throw new EmbeddingProviderError(
            "dimension_mismatch",
            "provider dimensions changed",
          )
        },
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "provider_dimension_mismatch",
      retryable: false,
    })

    await expect(
      runExperienceEmbeddingWorkflow(input(), {
        runId: "run-admin",
        embeddingRequester: async (items) => embeddingResult(items),
        adminIngestClient: async () => ({
          ok: false,
          reason: "rejected",
          retryable: false,
          status: 409,
          result: {
            status: "rejected",
            reason: "existing_experience_embedding_differs",
            target: {
              experienceId: "exp-1",
              experienceLocaleId: "loc-1",
              locale: "en",
            },
            model: "openai/text-embedding-3-small",
            dimensions: EXPECTED_EXPERIENCE_EMBEDDING_DIMENSIONS,
            mastraRunId: "run-admin",
          },
        }),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "admin_ingest_rejected",
      retryable: false,
      adminStatus: "rejected",
      adminReason: "existing_experience_embedding_differs",
    })
  })

  it("keeps route auth scoped and response payload scrubbed", async () => {
    const unauthorized = await handleExperienceEmbeddingRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys: ["secret"],
      readJson: async () => input(),
    })

    expect(unauthorized).toEqual({
      status: 401,
      body: { error: "Service bearer required" },
    })

    const authorized = await handleExperienceEmbeddingRouteRequest({
      authHeader: "Bearer secret",
      serviceKeys: ["secret"],
      readJson: async () => input(),
      launch: async () => ({
        ok: true,
        status: "created",
        target: {
          experienceId: "exp-1",
          experienceLocaleId: "loc-1",
          locale: "en",
        },
      }),
    })

    expect(authorized.status).toBe(200)
    expect(JSON.stringify(authorized.body)).not.toContain('"embedding"')
    expect(JSON.stringify(authorized.body)).not.toContain("mastraRunId")
    expect(JSON.stringify(authorized.body)).not.toContain("Jesus brings hope")
  })

  it("keeps committed step summaries free of source text and vectors", () => {
    const planned = planExperienceEmbeddingRun(input(), {
      mastraRunId: "run-safe-summary",
    })
    const summary = _internals.summarizePlannedRun(planned)
    const serialized = JSON.stringify(summary)

    expect(serialized).not.toContain("Jesus brings hope")
    expect(serialized).not.toContain('"embedding"')
    expect(serialized).not.toContain("sha256:")
    expect(serialized).not.toContain("chars=42")
    expect(summary).toMatchObject({
      source: {
        sourceTextLength: sourceText().length,
      },
    })
  })

  it("marks committed Mastra runs as failed when the workflow result is typed failure", async () => {
    const run = await experienceEmbeddingWorkflow.createRun({
      runId: "run-committed-provider-config",
    })

    const result = await run.start({ inputData: input() })

    expect(result.status).toBe("failed")
    expect(_internals.workflowFailureFromRunResult(result)).toMatchObject({
      ok: false,
      reason: "provider_config_missing",
      retryable: false,
    })
  })

  it("marks committed Mastra runs as failed for invalid input", async () => {
    const run = await experienceEmbeddingWorkflow.createRun({
      runId: "run-committed-invalid-input",
    })

    const result = await run.start({ inputData: { nope: true } })

    expect(result.status).toBe("failed")
    expect(_internals.workflowFailureFromRunResult(result)).toEqual({
      ok: false,
      reason: "invalid_input",
      retryable: false,
    })
  })

  it("registers the committed Mastra workflow", () => {
    expect(experienceEmbeddingWorkflow.id).toBe("experience-embedding")
    expect(experienceEmbeddingWorkflow.committed).toBe(true)
  })
})
