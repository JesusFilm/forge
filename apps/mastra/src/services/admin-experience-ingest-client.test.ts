import { describe, expect, it, vi } from "vitest"
import {
  callAdminExperienceIngest,
  type AdminExperienceEmbeddingIngestPayload,
} from "./admin-experience-ingest-client"

function payload(): AdminExperienceEmbeddingIngestPayload {
  return {
    target: {
      experienceId: "exp-1",
      experienceLocaleId: "loc-1",
      locale: "en",
      slug: "hope",
    },
    source: {
      contentHash: "sha256:source",
      summary: "chars=24;lines=2;title=present;meta=absent;og=absent",
    },
    model: {
      name: "openai/text-embedding-3-small",
      provider: "openai",
      dimensions: 1536,
    },
    generation: {
      mode: "idempotent",
      generatedAt: "2026-05-26T00:00:00.000Z",
      mastraRunId: "run-1",
    },
    embedding: [0.1, 0.2],
  }
}

describe("callAdminExperienceIngest", () => {
  it("posts the experience payload and parses a valid Admin result", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        result: {
          status: "created",
          target: {
            experienceId: "exp-1",
            experienceLocaleId: "loc-1",
            locale: "en",
          },
          model: "openai/text-embedding-3-small",
          dimensions: 1536,
          mastraRunId: "run-1",
        },
      }),
    )

    const result = await callAdminExperienceIngest({
      ingestUrl:
        "https://admin.internal/api/internal/mastra/experience-embeddings",
      bearer: "admin-key",
      payload: payload(),
      fetchImpl,
    })

    expect(result).toEqual({
      ok: true,
      result: {
        status: "created",
        target: {
          experienceId: "exp-1",
          experienceLocaleId: "loc-1",
          locale: "en",
        },
        model: "openai/text-embedding-3-small",
        dimensions: 1536,
        mastraRunId: "run-1",
      },
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL(
        "https://admin.internal/api/internal/mastra/experience-embeddings",
      ),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer admin-key",
        }),
      }),
    )
  })

  it("returns typed nonretryable auth/reject failures and retryable parse failures", async () => {
    await expect(
      callAdminExperienceIngest({
        payload: payload(),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })

    await expect(
      callAdminExperienceIngest({
        ingestUrl:
          "https://admin.internal/api/internal/mastra/experience-embeddings",
        bearer: "admin-key",
        payload: payload(),
        fetchImpl: vi.fn(async () => new Response(null, { status: 401 })),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "auth_failed",
      retryable: false,
    })

    await expect(
      callAdminExperienceIngest({
        ingestUrl:
          "https://admin.internal/api/internal/mastra/experience-embeddings",
        bearer: "admin-key",
        payload: payload(),
        fetchImpl: vi.fn(async () =>
          Response.json(
            {
              result: {
                status: "rejected",
                reason: "existing_experience_embedding_differs",
                target: {
                  experienceId: "exp-1",
                  experienceLocaleId: "loc-1",
                  locale: "en",
                },
                model: "openai/text-embedding-3-small",
                dimensions: 1536,
                mastraRunId: "run-1",
              },
            },
            { status: 409 },
          ),
        ),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "rejected",
      retryable: false,
      result: { status: "rejected" },
    })

    await expect(
      callAdminExperienceIngest({
        ingestUrl:
          "https://admin.internal/api/internal/mastra/experience-embeddings",
        bearer: "admin-key",
        payload: payload(),
        fetchImpl: vi.fn(async () => Response.json({ bad: true })),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })
  })
})
