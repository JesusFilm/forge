import { describe, expect, it, vi } from "vitest"

import { callAdminEmbeddingIngest } from "./admin-embedding-ingest-client"

type TestResult = {
  status: "created" | "rejected"
  model: string
}

const payload = { hello: "world" }

function parseResult(body: unknown): TestResult | null {
  if (
    body &&
    typeof body === "object" &&
    "result" in body &&
    body.result &&
    typeof body.result === "object" &&
    "status" in body.result &&
    (body.result.status === "created" || body.result.status === "rejected") &&
    "model" in body.result &&
    typeof body.result.model === "string"
  ) {
    return {
      status: body.result.status,
      model: body.result.model,
    }
  }
  return null
}

describe("Admin embedding ingest client shared transport", () => {
  it("returns config_missing without URL or bearer", async () => {
    await expect(
      callAdminEmbeddingIngest({ payload, parseResult }),
    ).resolves.toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
  })

  it("sends bearer auth and parses an ingest result", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ result: { status: "created", model: "model-a" } }),
    )

    await expect(
      callAdminEmbeddingIngest({
        ingestUrl: "https://admin.internal/api/internal/mastra/test",
        bearer: "secret",
        payload,
        parseResult,
        fetchImpl,
      }),
    ).resolves.toEqual({
      ok: true,
      result: { status: "created", model: "model-a" },
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://admin.internal/api/internal/mastra/test"),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret",
        }),
        body: JSON.stringify(payload),
      }),
    )
  })

  it("classifies auth, rejected, invalid, and retryable Admin responses", async () => {
    await expect(
      callAdminEmbeddingIngest({
        ingestUrl: "https://admin.internal/api/internal/mastra/test",
        bearer: "bad",
        payload,
        parseResult,
        fetchImpl: vi.fn(async () => new Response("no", { status: 401 })),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "auth_failed",
      retryable: false,
      status: 401,
    })

    await expect(
      callAdminEmbeddingIngest({
        ingestUrl: "https://admin.internal/api/internal/mastra/test",
        bearer: "secret",
        payload,
        parseResult,
        fetchImpl: vi.fn(async () =>
          Response.json(
            { result: { status: "rejected", model: "model-a" } },
            { status: 409 },
          ),
        ),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "rejected",
      retryable: false,
      status: 409,
      result: { status: "rejected", model: "model-a" },
    })

    await expect(
      callAdminEmbeddingIngest({
        ingestUrl: "https://admin.internal/api/internal/mastra/test",
        bearer: "secret",
        payload,
        parseResult,
        fetchImpl: vi.fn(async () =>
          Response.json(
            { error: "nope", reason: "target_not_found", retryable: false },
            { status: 404 },
          ),
        ),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "rejected",
      retryable: false,
      status: 404,
      adminReason: "target_not_found",
    })

    await expect(
      callAdminEmbeddingIngest({
        ingestUrl: "https://admin.internal/api/internal/mastra/test",
        bearer: "secret",
        payload,
        parseResult,
        fetchImpl: vi.fn(async () =>
          Response.json({ ok: true }, { status: 200 }),
        ),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
      status: 200,
    })

    await expect(
      callAdminEmbeddingIngest({
        ingestUrl: "https://admin.internal/api/internal/mastra/test",
        bearer: "secret",
        payload,
        parseResult,
        fetchImpl: vi.fn(async () =>
          Response.json(
            { reason: "overloaded", retryable: true },
            { status: 503 },
          ),
        ),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "network_error",
      retryable: true,
      status: 503,
      adminReason: "overloaded",
    })

    await expect(
      callAdminEmbeddingIngest({
        ingestUrl: "https://admin.internal/api/internal/mastra/test",
        bearer: "secret",
        payload,
        parseResult,
        fetchImpl: vi.fn(async () =>
          Response.json(
            { reason: "rate_limited", retryable: true },
            { status: 429 },
          ),
        ),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "ingest_failed",
      retryable: true,
      status: 429,
      adminReason: "rate_limited",
    })

    await expect(
      callAdminEmbeddingIngest({
        ingestUrl: "https://admin.internal/api/internal/mastra/test",
        bearer: "secret",
        payload,
        parseResult,
        fetchImpl: vi.fn(async () =>
          Response.json(
            { reason: "overloaded", retryable: false },
            { status: 503 },
          ),
        ),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "network_error",
      retryable: true,
      status: 503,
      adminReason: "overloaded",
    })
  })
})
