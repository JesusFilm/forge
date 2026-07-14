import { beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: {
    MASTRA_BASE_URL: undefined as string | undefined,
    MASTRA_SERVICE_API_KEY: undefined as string | undefined,
    MASTRA_DRAFT_TIMEOUT_MS: 200_000 as number,
  },
}))

vi.mock("@/config/env", () => mockEnv)

import { launchMastraExperienceDraft } from "./mastra-experience-draft-client"

const VALID_DRAFT = {
  title: "Hope for the journey",
  metaDescription: "A short reflection on hope.",
  blocks: [
    {
      t: "text" as const,
      heading: "Hope is anchored",
      contentParagraphs: ["Anchored in unchanging truth."],
    },
    {
      t: "card" as const,
      title: "Hope is anchored",
      description: "Discover what scripture says about hope.",
    },
  ],
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const INPUT = {
  prompt: "A page about hope",
  locale: "en",
  candidates: [
    {
      ref: "v01" as const,
      videoId: "video-1",
      slug: "hope",
      title: "Hope Story",
      description: null,
      previewImageUrl: null,
      previewStreamUrl: null,
      label: null,
    },
  ],
}

describe("launchMastraExperienceDraft", () => {
  beforeEach(() => {
    mockEnv.env.MASTRA_BASE_URL = undefined
    mockEnv.env.MASTRA_SERVICE_API_KEY = undefined
    mockEnv.env.MASTRA_DRAFT_TIMEOUT_MS = 200_000
  })

  it("short-circuits to config_missing when caller vars are unset", async () => {
    const fetchImpl = vi.fn()
    const result = await launchMastraExperienceDraft(INPUT, { fetchImpl })
    expect(result).toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("posts to /forge-experience-draft with a Bearer + the videoId-keyed candidates and returns the validated draft", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true, draft: VALID_DRAFT }))
    const result = await launchMastraExperienceDraft(INPUT, {
      baseUrl: "https://mastra.example/",
      bearer: "svc-key",
      fetchImpl,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")
    expect(result.draft.title).toBe(VALID_DRAFT.title)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toBe("https://mastra.example/forge-experience-draft")
    expect((init as RequestInit).method).toBe("POST")
    expect(
      (init as RequestInit).headers as Record<string, string>,
    ).toMatchObject({ authorization: "Bearer svc-key" })
    const sentBody = JSON.parse(String((init as RequestInit).body))
    expect(sentBody).toMatchObject({
      prompt: INPUT.prompt,
      locale: "en",
      candidates: [expect.objectContaining({ videoId: "video-1" })],
    })
  })

  it("forwards an explicit mode + exemplar in the body", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true, draft: VALID_DRAFT }))
    await launchMastraExperienceDraft(
      { ...INPUT, exemplar: "{...}", mode: "quick" },
      { baseUrl: "https://mastra.example", bearer: "svc-key", fetchImpl },
    )
    const sentBody = JSON.parse(
      String((fetchImpl.mock.calls[0][1] as RequestInit).body),
    )
    expect(sentBody).toMatchObject({ mode: "quick", exemplar: "{...}" })
  })

  it("maps a 401 to auth_failed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, {}))
    const result = await launchMastraExperienceDraft(INPUT, {
      baseUrl: "https://mastra.example",
      bearer: "svc-key",
      fetchImpl,
    })
    expect(result).toEqual({
      ok: false,
      reason: "auth_failed",
      retryable: false,
    })
  })

  it("passes a route { ok:false, reason:'timeout' } envelope through unchanged", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(504, { ok: false, reason: "timeout", retryable: true }),
      )
    const result = await launchMastraExperienceDraft(INPUT, {
      baseUrl: "https://mastra.example",
      bearer: "svc-key",
      fetchImpl,
    })
    expect(result).toEqual({ ok: false, reason: "timeout", retryable: true })
  })

  it("passes a route { ok:false, reason:'generation_failed', retryable:false } envelope through unchanged", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(502, {
        ok: false,
        reason: "generation_failed",
        retryable: false,
      }),
    )
    const result = await launchMastraExperienceDraft(INPUT, {
      baseUrl: "https://mastra.example",
      bearer: "svc-key",
      fetchImpl,
    })
    expect(result).toEqual({
      ok: false,
      reason: "generation_failed",
      retryable: false,
    })
  })

  it("classifies a fetch throw as network_error (retryable)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"))
    const result = await launchMastraExperienceDraft(INPUT, {
      baseUrl: "https://mastra.example",
      bearer: "svc-key",
      fetchImpl,
    })
    expect(result).toEqual({
      ok: false,
      reason: "network_error",
      retryable: true,
    })
  })

  it("returns parse_error when a 200 body is unrecognized", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { wat: true }))
    const result = await launchMastraExperienceDraft(INPUT, {
      baseUrl: "https://mastra.example",
      bearer: "svc-key",
      fetchImpl,
    })
    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })
  })

  it("returns parse_error when a 200 ok:true body carries a schema-invalid draft", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true, draft: { title: "x" } }))
    const result = await launchMastraExperienceDraft(INPUT, {
      baseUrl: "https://mastra.example",
      bearer: "svc-key",
      fetchImpl,
    })
    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })
  })

  it("classifies an unrecognized 5xx body as retryable network_error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, "nope"))
    const result = await launchMastraExperienceDraft(INPUT, {
      baseUrl: "https://mastra.example",
      bearer: "svc-key",
      fetchImpl,
    })
    expect(result).toEqual({
      ok: false,
      reason: "network_error",
      retryable: true,
    })
  })
})
