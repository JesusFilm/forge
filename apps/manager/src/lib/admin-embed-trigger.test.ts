import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as {
    ADMIN_GRAPHQL_URL?: string
    ADMIN_EMBED_TRIGGER_API_KEY?: string
  },
}))

const { env } = await import("@/config/env")
const { triggerSceneEmbeddingBackfill, triggerTranscriptEmbeddingBackfill } =
  await import("@/lib/admin-embed-trigger")

const envMutable = env as {
  ADMIN_GRAPHQL_URL?: string
  ADMIN_EMBED_TRIGGER_API_KEY?: string
}

const fetchSpy = vi.spyOn(globalThis, "fetch")

describe("admin-embed-trigger", () => {
  beforeEach(() => {
    envMutable.ADMIN_GRAPHQL_URL = "https://admin.example/api/graphql"
    envMutable.ADMIN_EMBED_TRIGGER_API_KEY = "test-key"
    fetchSpy.mockReset()
  })

  afterEach(() => {
    envMutable.ADMIN_GRAPHQL_URL = undefined
    envMutable.ADMIN_EMBED_TRIGGER_API_KEY = undefined
  })

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  }

  describe("triggerSceneEmbeddingBackfill", () => {
    it("forwards args to admin and unwraps successful response", async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          data: {
            triggerSceneEmbeddingBackfill: { totalTargets: 3, succeeded: 3 },
          },
        }),
      )

      const result = await triggerSceneEmbeddingBackfill({
        coreIds: ["a", "b"],
        locales: ["en"],
      })

      expect(result).toEqual({
        ok: true,
        data: { totalTargets: 3, succeeded: 3 },
      })
      expect(fetchSpy).toHaveBeenCalledOnce()
      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe("https://admin.example/api/graphql")
      expect(init?.method).toBe("POST")
      expect(init?.headers).toMatchObject({
        authorization: "Bearer test-key",
        "content-type": "application/json",
      })
      const body = JSON.parse(init?.body as string)
      expect(body.query).toContain("triggerSceneEmbeddingBackfill")
      expect(body.variables).toEqual({ coreIds: ["a", "b"], locales: ["en"] })
    })

    it("surfaces GraphQL errors with messages", async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          errors: [{ message: "permission denied" }],
        }),
      )

      const result = await triggerSceneEmbeddingBackfill({})
      expect(result).toEqual({
        ok: false,
        reason: "graphql_error",
        messages: ["permission denied"],
        httpStatus: 200,
      })
    })

    it("returns config_missing when env unset", async () => {
      envMutable.ADMIN_GRAPHQL_URL = undefined
      const result = await triggerSceneEmbeddingBackfill({})
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.reason).toBe("config_missing")
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("returns network_error when fetch throws", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"))
      const result = await triggerSceneEmbeddingBackfill({})
      expect(result.ok).toBe(false)
      if (result.ok) return
      if (result.reason !== "network_error") {
        throw new Error(`expected network_error, got ${result.reason}`)
      }
      expect(result.message).toContain("ECONNREFUSED")
    })

    it("returns parse_error on malformed JSON", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response("<html>not json</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
      )
      const result = await triggerSceneEmbeddingBackfill({})
      expect(result.ok).toBe(false)
      if (result.ok) return
      if (result.reason !== "parse_error") {
        throw new Error(`expected parse_error, got ${result.reason}`)
      }
      expect(result.httpStatus).toBe(502)
    })

    it("surfaces graphql_error when data is missing the expected field", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ data: {} }))
      const result = await triggerSceneEmbeddingBackfill({})
      expect(result.ok).toBe(false)
      if (result.ok) return
      if (result.reason !== "graphql_error") {
        throw new Error(`expected graphql_error, got ${result.reason}`)
      }
      expect(result.messages[0]).toMatch(/triggerSceneEmbeddingBackfill/)
    })
  })

  describe("triggerTranscriptEmbeddingBackfill", () => {
    it("forwards languages arg verbatim", async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          data: {
            triggerTranscriptEmbeddingBackfill: { totalTargets: 0 },
          },
        }),
      )

      const result = await triggerTranscriptEmbeddingBackfill({
        languages: ["en", "es"],
      })

      expect(result).toEqual({ ok: true, data: { totalTargets: 0 } })
      const [, init] = fetchSpy.mock.calls[0]
      const body = JSON.parse(init?.body as string)
      expect(body.query).toContain("triggerTranscriptEmbeddingBackfill")
      expect(body.variables).toEqual({ languages: ["en", "es"] })
    })
  })
})
