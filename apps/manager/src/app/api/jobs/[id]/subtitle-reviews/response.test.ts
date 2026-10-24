import { beforeEach, afterEach, expect, it, vi } from "vitest"
vi.mock("@/config/env", () => ({
  env: {
    get SUBTITLE_EDITOR_PUBLIC_URL() {
      return process.env.SUBTITLE_EDITOR_PUBLIC_URL
    },
    get SUBTITLE_EDITOR_ALLOWED_ORIGINS() {
      return process.env.SUBTITLE_EDITOR_ALLOWED_ORIGINS
    },
    get SUBTITLE_REVIEW_SESSION_SECRET() {
      return process.env.SUBTITLE_REVIEW_SESSION_SECRET
    },
  },
}))
import { readReviewJson, readBearerToken, preflightResponse } from "./response"
beforeEach(() => {
  vi.stubEnv("SUBTITLE_EDITOR_PUBLIC_URL", "https://editor.invalid")
  vi.stubEnv("SUBTITLE_EDITOR_ALLOWED_ORIGINS", "https://editor.invalid")
  vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "fixture-secret")
})
afterEach(() => vi.unstubAllEnvs())
it("bounds actual streamed bytes when content-length is absent", async () => {
  let cancelled = false
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode("x".repeat(20)))
    },
    cancel() {
      cancelled = true
    },
  })
  const request = new Request("http://fixture.invalid", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit)
  expect(await readReviewJson(request, 10)).toBeNull()
  expect(cancelled).toBe(true)
})
it("rejects oversized declarations without consuming the body", async () => {
  const request = new Request("http://fixture.invalid", {
    method: "POST",
    headers: { "content-length": "100" },
    body: "{}",
  })
  expect(await readReviewJson(request, 10)).toBeNull()
  expect(request.bodyUsed).toBe(false)
})
it("accepts bounded JSON and rejects malformed JSON", async () => {
  const request = (body: string) =>
    new Request("http://fixture.invalid", { method: "POST", body })
  expect(await readReviewJson(request('{"key":1}'), 20)).toEqual({ key: 1 })
  expect(await readReviewJson(request("{"), 20)).toBeNull()
})
it("rejects unbounded bearer fields", () => {
  expect(
    readBearerToken(
      new Request("http://fixture.invalid", {
        headers: { authorization: "Bearer " + "a".repeat(4097) },
      }),
    ),
  ).toBeNull()
})
it.each([
  ["https://editor.invalid", 204, "https://editor.invalid"],
  ["https://editor.invalid.evil", 403, null],
  ["https://editor.invalid/path", 403, null],
  ["null", 403, null],
])(
  "preflight uses exact origin and no-store: %s",
  (origin, status, allowed) => {
    const response = preflightResponse(
      new Request("http://fixture.invalid", { headers: { origin } }),
    )
    expect(response.status).toBe(status)
    expect(response.headers.get("access-control-allow-origin")).toBe(allowed)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  },
)
it("fails closed with configuration off", () => {
  vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "")
  const response = preflightResponse(
    new Request("http://fixture.invalid", {
      headers: { origin: "https://editor.invalid" },
    }),
  )
  expect(response.status).toBe(503)
  expect(response.headers.get("cache-control")).toBe("private, no-store")
})
