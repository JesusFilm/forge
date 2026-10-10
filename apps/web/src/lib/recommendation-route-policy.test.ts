import { describe, expect, it, vi } from "vitest"

import {
  RecommendationRouteError,
  readStrictRecommendationJson,
} from "@/lib/recommendation-route-policy"

const EXPECTED_ORIGIN = "https://watch.example:8443"

function request(body: string, headers: HeadersInit = {}): Request {
  return new Request(`${EXPECTED_ORIGIN}/watch/api/recommendations/evidence`, {
    method: "POST",
    headers: {
      origin: EXPECTED_ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      ...headers,
    },
    body,
  })
}

async function expectRouteError(
  promise: Promise<unknown>,
  status: number,
  code: string,
) {
  const expected = {
    status,
    code,
  } satisfies Partial<RecommendationRouteError>
  await expect(promise).rejects.toMatchObject(expected)
}

describe("readStrictRecommendationJson", () => {
  it("parses one exact-origin, same-origin, unencoded JSON object", async () => {
    await expect(
      readStrictRecommendationJson(request('{"item":{"id":"one"}}'), {
        expectedOrigin: EXPECTED_ORIGIN,
        maxBytes: 1024,
      }),
    ).resolves.toEqual({ item: { id: "one" } })
  })

  it("accepts a forwarded localhost port outside production", async () => {
    const expectedOrigin = "http://localhost:55078"
    const forwardedRequest = new Request(
      `${expectedOrigin}/watch/api/recommendations/profile`,
      {
        method: "POST",
        headers: {
          origin: "http://localhost:51777",
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
        },
        body: "{}",
      },
    )

    await expect(
      readStrictRecommendationJson(forwardedRequest, {
        expectedOrigin,
        maxBytes: 1024,
      }),
    ).resolves.toEqual({})
  })

  it.each([
    ["http://127.0.0.1:55078", "http://127.0.0.1:51777"],
    ["http://[::1]:55078", "http://[::1]:51777"],
  ])(
    "accepts a forwarded port for the supported loopback host %s",
    async (expectedOrigin, origin) => {
      await expect(
        readStrictRecommendationJson(request("{}", { origin }), {
          expectedOrigin,
          maxBytes: 1024,
        }),
      ).resolves.toEqual({})
    },
  )

  it.each([
    ["http://localhost:55078", "https://localhost:51777"],
    ["http://localhost:55078", "http://127.0.0.1:51777"],
    ["http://watch.example:55078", "http://watch.example:51777"],
    ["http://localhost:55078", "not an origin"],
    ["http://localhost:55078", "http://localhost:51777/"],
  ])(
    "rejects an unsupported forwarded origin %s <- %s",
    async (expectedOrigin, origin) => {
      await expectRouteError(
        readStrictRecommendationJson(request("{}", { origin }), {
          expectedOrigin,
          maxBytes: 1024,
        }),
        403,
        "invalid_origin",
      )
    },
  )

  it("keeps exact-origin enforcement for localhost in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const expectedOrigin = "http://localhost:55078"
    const forwardedRequest = new Request(
      `${expectedOrigin}/watch/api/recommendations/profile`,
      {
        method: "POST",
        headers: {
          origin: "http://localhost:51777",
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
        },
        body: "{}",
      },
    )

    try {
      await expectRouteError(
        readStrictRecommendationJson(forwardedRequest, {
          expectedOrigin,
          maxBytes: 1024,
        }),
        403,
        "invalid_origin",
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it.each([
    '{"id":"one","id":"two"}',
    '{"item":{"id":"one","id":"two"}}',
    '{"items":[{"id":"one","\\u0069d":"two"}]}',
  ])("rejects duplicate decoded object keys at every depth", async (body) => {
    await expectRouteError(
      readStrictRecommendationJson(request(body), {
        expectedOrigin: EXPECTED_ORIGIN,
        maxBytes: 1024,
      }),
      400,
      "invalid_json",
    )
  })

  it.each([
    [{ origin: "https://watch.example" }, "invalid_origin"],
    [
      { origin: "https://watch.example:8443, https://watch.example:8443" },
      "invalid_origin",
    ],
    [{ "sec-fetch-site": "same-site" }, "invalid_fetch_metadata"],
    [
      { "sec-fetch-site": "same-origin, same-origin" },
      "invalid_fetch_metadata",
    ],
    [
      { "content-type": "application/json; charset=utf-8" },
      "invalid_content_type",
    ],
    [{ "content-encoding": "identity" }, "content_encoding_not_allowed"],
  ] as const)(
    "rejects ambiguous or inexact request headers",
    async (headers, code) => {
      await expectRouteError(
        readStrictRecommendationJson(request("{}", headers), {
          expectedOrigin: EXPECTED_ORIGIN,
          maxBytes: 1024,
        }),
        code === "invalid_origin" || code === "invalid_fetch_metadata"
          ? 403
          : 415,
        code,
      )
    },
  )

  it("rejects declared overflow before reading the body", async () => {
    const read = vi.fn()
    const oversized = {
      headers: new Headers({
        origin: EXPECTED_ORIGIN,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "content-length": "1025",
      }),
      body: { getReader: () => ({ read }) },
    } as unknown as Request

    await expectRouteError(
      readStrictRecommendationJson(oversized, {
        expectedOrigin: EXPECTED_ORIGIN,
        maxBytes: 1024,
      }),
      413,
      "body_too_large",
    )
    expect(read).not.toHaveBeenCalled()
  })

  it("cancels chunked input as soon as the decoded stream bound is crossed", async () => {
    const cancel = vi.fn(async () => undefined)
    let delivered = false
    const streamed = {
      headers: new Headers({
        origin: EXPECTED_ORIGIN,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      }),
      body: {
        getReader: () => ({
          cancel,
          read: vi.fn(async () => {
            if (delivered) return { done: true, value: undefined }
            delivered = true
            return {
              done: false,
              value: new TextEncoder().encode(
                `{"value":"${"x".repeat(1024)}"}`,
              ),
            }
          }),
        }),
      },
    } as unknown as Request

    await expectRouteError(
      readStrictRecommendationJson(streamed, {
        expectedOrigin: EXPECTED_ORIGIN,
        maxBytes: 1024,
      }),
      413,
      "body_too_large",
    )
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("rejects malformed UTF-8 before JSON parsing", async () => {
    let delivered = false
    const malformed = {
      headers: new Headers({
        origin: EXPECTED_ORIGIN,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      }),
      body: {
        getReader: () => ({
          cancel: vi.fn(),
          read: vi.fn(async () => {
            if (delivered) return { done: true, value: undefined }
            delivered = true
            return { done: false, value: new Uint8Array([0xc3, 0x28]) }
          }),
        }),
      },
    } as unknown as Request

    await expectRouteError(
      readStrictRecommendationJson(malformed, {
        expectedOrigin: EXPECTED_ORIGIN,
        maxBytes: 1024,
      }),
      400,
      "invalid_json",
    )
  })

  it("accepts a valid document at the exact decoded byte boundary", async () => {
    const maxBytes = 64
    const body = `{"value":"${"x".repeat(maxBytes - 12)}"}`
    expect(new TextEncoder().encode(body)).toHaveLength(maxBytes)

    await expect(
      readStrictRecommendationJson(request(body), {
        expectedOrigin: EXPECTED_ORIGIN,
        maxBytes,
      }),
    ).resolves.toEqual({ value: "x".repeat(maxBytes - 12) })
  })
})
