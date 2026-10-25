import { describe, expect, it, vi } from "vitest"
import {
  launchMastraExperienceEmbedding,
  launchMastraExperienceEmbeddingForLocale,
} from "@/services/mastra-experience-embedding-client"

const source = {
  text: "Hope\n\nJesus brings hope.",
  contentHash: "sha256:source",
  summary: "chars=24;lines=2;title=present;meta=absent;og=absent",
}

const target = {
  experienceId: "exp-1",
  experienceLocaleId: "loc-1",
  locale: "en",
  slug: "hope",
}

describe("launchMastraExperienceEmbedding", () => {
  it("posts to the Mastra experience route with bearer auth and parses success", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      Response.json({
        result: {
          ok: true,
          status: "created",
        },
      }),
    )

    const result = await launchMastraExperienceEmbedding(
      { target, source, mode: "force" },
      {
        baseUrl: "https://mastra.internal",
        bearer: "service-key",
        fetchImpl,
      },
    )

    expect(result).toMatchObject({
      ok: true,
      status: "created",
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://mastra.internal/forge-experience-embeddings"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer service-key",
        }),
      }),
    )
    const body = JSON.parse(
      (fetchImpl.mock.calls[0]![1] as RequestInit).body as string,
    )
    expect(body).toMatchObject({
      target,
      source,
      mode: "force",
    })
  })

  it("returns typed failures for missing config, auth, malformed response, and network errors", async () => {
    await expect(
      launchMastraExperienceEmbedding({ target, source }),
    ).resolves.toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })

    await expect(
      launchMastraExperienceEmbedding(
        { target, source },
        {
          baseUrl: "https://mastra.internal",
          bearer: "service-key",
          fetchImpl: vi.fn(async () => new Response(null, { status: 401 })),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "auth_failed",
      retryable: false,
    })

    await expect(
      launchMastraExperienceEmbedding(
        { target, source },
        {
          baseUrl: "https://mastra.internal",
          bearer: "service-key",
          fetchImpl: vi.fn(async () => Response.json({ nope: true })),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })

    await expect(
      launchMastraExperienceEmbedding(
        { target, source },
        {
          baseUrl: "https://mastra.internal",
          bearer: "service-key",
          fetchImpl: vi.fn(async () => {
            throw new Error("offline")
          }),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "network_error",
      retryable: true,
    })
  })

  it("rejects unpublished or archived locale rows before posting source text to Mastra", async () => {
    const fetchImpl = vi.fn()
    const prisma = {
      experienceLocale: {
        findUniqueOrThrow: vi.fn(),
      },
    }

    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce({
      id: "loc-draft",
      experienceId: "exp-1",
      locale: "en",
      slug: "draft",
      title: "Draft",
      metaDescription: null,
      ogTitle: null,
      ogDescription: null,
      blocks: [],
      status: "DRAFT",
      experience: { archivedAt: null },
    })

    await expect(
      launchMastraExperienceEmbeddingForLocale("loc-draft", {
        prisma: prisma as never,
        baseUrl: "https://mastra.internal",
        bearer: "service-key",
        fetchImpl,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "target_unpublished",
      retryable: false,
    })

    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce({
      id: "loc-archived",
      experienceId: "exp-1",
      locale: "en",
      slug: "archived",
      title: "Archived",
      metaDescription: null,
      ogTitle: null,
      ogDescription: null,
      blocks: [],
      status: "PUBLISHED",
      experience: { archivedAt: new Date("2026-05-26T00:00:00.000Z") },
    })

    await expect(
      launchMastraExperienceEmbeddingForLocale("loc-archived", {
        prisma: prisma as never,
        baseUrl: "https://mastra.internal",
        bearer: "service-key",
        fetchImpl,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "target_not_found",
      retryable: false,
    })

    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
