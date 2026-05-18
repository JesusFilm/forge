import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as {
    ADMIN_GRAPHQL_URL?: string
    ADMIN_EMBED_TRIGGER_API_KEY?: string
  },
}))

const { env } = await import("@/config/env")
const { lookupVideosByCoreIdFromAdmin } =
  await import("@/lib/admin-video-lookup")

const envMutable = env as {
  ADMIN_GRAPHQL_URL?: string
  ADMIN_EMBED_TRIGGER_API_KEY?: string
}

const fetchSpy = vi.spyOn(globalThis, "fetch")

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const FIXTURE_ROW = {
  id: "v-1",
  coreId: "core-1",
  label: "featureFilm",
  primaryLanguageBcp47: "en",
  muxAssetId: "mux-asset-en",
  subtitleUrl: "https://example.com/en.vtt",
}

describe("admin-video-lookup", () => {
  beforeEach(() => {
    envMutable.ADMIN_GRAPHQL_URL = "https://admin.example/api/graphql"
    envMutable.ADMIN_EMBED_TRIGGER_API_KEY = "test-key"
    fetchSpy.mockReset()
  })

  afterEach(() => {
    envMutable.ADMIN_GRAPHQL_URL = undefined
    envMutable.ADMIN_EMBED_TRIGGER_API_KEY = undefined
  })

  describe("happy path", () => {
    it("returns ok:true with Map keyed by coreId", async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          data: {
            videosByCoreIds: [
              FIXTURE_ROW,
              { ...FIXTURE_ROW, id: "v-2", coreId: "core-2" },
            ],
          },
        }),
      )

      const result = await lookupVideosByCoreIdFromAdmin(["core-1", "core-2"])

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error("expected ok envelope")
      expect(result.data.size).toBe(2)
      expect(result.data.get("core-1")).toEqual(FIXTURE_ROW)
      expect(result.data.get("core-2")?.id).toBe("v-2")
    })

    it("sends bearer + GraphQL POST shape", async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ data: { videosByCoreIds: [] } }),
      )

      await lookupVideosByCoreIdFromAdmin(["core-1"])

      expect(fetchSpy).toHaveBeenCalledOnce()
      const [url, init] = fetchSpy.mock.calls[0] as [
        string,
        { headers: Record<string, string>; body: string; method: string },
      ]
      expect(url).toBe("https://admin.example/api/graphql")
      expect(init.method).toBe("POST")
      expect(init.headers).toMatchObject({
        authorization: "Bearer test-key",
        "content-type": "application/json",
      })
      const parsed = JSON.parse(init.body) as {
        query: string
        variables: { coreIds: string[] }
      }
      expect(parsed.variables.coreIds).toEqual(["core-1"])
      expect(parsed.query).toContain("videosByCoreIds")
    })

    it("returns an empty Map without making a fetch call when coreIds is empty", async () => {
      const result = await lookupVideosByCoreIdFromAdmin([])

      expect(result).toEqual({ ok: true, data: new Map() })
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("returns an empty Map (no fetch) when admin returns no rows", async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ data: { videosByCoreIds: [] } }),
      )

      const result = await lookupVideosByCoreIdFromAdmin(["core-missing"])

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error("expected ok envelope")
      expect(result.data.size).toBe(0)
    })
  })

  describe("config_missing", () => {
    it("envelope when ADMIN_GRAPHQL_URL is unset (and no fetch)", async () => {
      envMutable.ADMIN_GRAPHQL_URL = undefined

      const result = await lookupVideosByCoreIdFromAdmin(["core-1"])

      expect(result).toMatchObject({
        ok: false,
        reason: "config_missing",
        retryable: false,
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("envelope when ADMIN_EMBED_TRIGGER_API_KEY is unset (and no fetch)", async () => {
      envMutable.ADMIN_EMBED_TRIGGER_API_KEY = undefined

      const result = await lookupVideosByCoreIdFromAdmin(["core-1"])

      expect(result).toMatchObject({
        ok: false,
        reason: "config_missing",
        retryable: false,
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("envelope when coreIds is empty AND env is unset — config_missing wins over empty-input short-circuit", async () => {
      // Regression guard for the Round 1 fix that ordered the
      // config check ahead of the empty-input short-circuit so a
      // misconfigured environment isn't masked by a happy-path
      // empty Map on degenerate input. Flipping the two branches
      // back would silently fail this test.
      envMutable.ADMIN_GRAPHQL_URL = undefined

      const result = await lookupVideosByCoreIdFromAdmin([])

      expect(result).toMatchObject({
        ok: false,
        reason: "config_missing",
        retryable: false,
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe("network_error", () => {
    it("envelope on AbortError (timeout simulation)", async () => {
      const abort = Object.assign(new Error("aborted"), { name: "AbortError" })
      fetchSpy.mockRejectedValueOnce(abort)

      const result = await lookupVideosByCoreIdFromAdmin(["core-1"])

      expect(result).toMatchObject({
        ok: false,
        reason: "network_error",
        retryable: true,
      })
      if (result.ok) throw new Error("unreachable")
      expect(result.messages[0]).toMatch(/timed out|timeout/i)
    })

    it("envelope on TimeoutError (AbortSignal.timeout)", async () => {
      const timeout = Object.assign(new Error("timed out"), {
        name: "TimeoutError",
      })
      fetchSpy.mockRejectedValueOnce(timeout)

      const result = await lookupVideosByCoreIdFromAdmin(["core-1"])

      expect(result).toMatchObject({
        ok: false,
        reason: "network_error",
        retryable: true,
      })
    })

    it("envelope on generic fetch failure (ECONNREFUSED simulation)", async () => {
      fetchSpy.mockRejectedValueOnce(
        Object.assign(new Error("fetch failed"), { name: "TypeError" }),
      )

      const result = await lookupVideosByCoreIdFromAdmin(["core-1"])

      expect(result).toMatchObject({
        ok: false,
        reason: "network_error",
        retryable: true,
      })
      if (result.ok) throw new Error("unreachable")
      expect(result.messages[0]).toBe("fetch failed")
    })
  })

  describe("parse_error", () => {
    it("envelope when admin returns non-JSON body", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response("<!DOCTYPE html><html>...</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
      )

      const result = await lookupVideosByCoreIdFromAdmin(["core-1"])

      expect(result).toMatchObject({
        ok: false,
        reason: "parse_error",
        retryable: true,
        httpStatus: 502,
      })
    })
  })

  describe("graphql_error", () => {
    it("envelope when payload.errors is non-empty", async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          errors: [{ message: "Forbidden" }],
        }),
      )

      const result = await lookupVideosByCoreIdFromAdmin(["core-1"])

      expect(result).toMatchObject({
        ok: false,
        reason: "graphql_error",
        retryable: false,
      })
      if (result.ok) throw new Error("unreachable")
      expect(result.messages).toContain("Forbidden")
    })

    it("envelope when payload is missing data.videosByCoreIds", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ data: {} }))

      const result = await lookupVideosByCoreIdFromAdmin(["core-1"])

      expect(result).toMatchObject({
        ok: false,
        reason: "graphql_error",
        retryable: false,
      })
    })

    it("envelope when data.videosByCoreIds is null", async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ data: { videosByCoreIds: null } }),
      )

      const result = await lookupVideosByCoreIdFromAdmin(["core-1"])

      expect(result).toMatchObject({
        ok: false,
        reason: "graphql_error",
        retryable: false,
      })
    })

    it("envelope on non-2xx response (treats body as JSON if parseable but flags non-2xx as graphql_error)", async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ errors: [{ message: "Internal" }] }, 503),
      )

      const result = await lookupVideosByCoreIdFromAdmin(["core-1"])

      expect(result).toMatchObject({
        ok: false,
        reason: "graphql_error",
        retryable: false,
        httpStatus: 503,
      })
    })
  })
})
