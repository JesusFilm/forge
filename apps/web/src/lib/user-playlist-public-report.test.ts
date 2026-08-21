import { beforeEach, describe, expect, it, vi } from "vitest"

const { consume } = vi.hoisted(() => ({ consume: vi.fn() }))
vi.mock("./user-playlist-public-rate-limit", () => ({
  consumePublicUserPlaylistIngress: consume,
}))

import { submitPublicUserPlaylistReportRequest } from "./user-playlist-public-report"

const REPORT_INTENT = "v1.key.nonce.ciphertext.tag"

function requestHeaders(): Headers {
  return new Headers({
    origin: "http://localhost:3000",
    host: "localhost:3000",
    "next-action": "safeActionId",
    "sec-fetch-site": "same-origin",
    "cf-ray": "1234567890abcdef-YHZ",
    "cf-ipcountry": "CA",
    "cf-connecting-ip": "203.0.113.4",
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  consume.mockReset().mockResolvedValue("admitted")
  vi.stubEnv("NODE_ENV", "test")
  process.env.WEB_BASE_URL = "http://localhost:3000"
  process.env.ADMIN_GRAPHQL_URL = "https://admin.jesusfilm.org/api/graphql"
  process.env.WEB_ADMIN_API_KEYS = "consumer-key"
  process.env.USER_PLAYLIST_TRUSTED_CONTEXT_HMAC_SECRET = "s".repeat(32)
})

describe("public user playlist report submission", () => {
  it("submits only the report intent with signed context and collapses admitted results", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("bad input", { status: 400 }))

    await expect(
      submitPublicUserPlaylistReportRequest({
        data: {
          reportIntent: REPORT_INTENT,
          category: "OTHER_SAFETY",
          detail: "Please review this text.",
        },
        requestHeaders: requestHeaders(),
      }),
    ).resolves.toEqual({ ok: true })

    const [, init] = fetch.mock.calls[0]!
    const body = String(init?.body)
    expect(body).toContain(REPORT_INTENT)
    expect(body).not.toMatch(/[A-Za-z0-9_-]{43}/)
    const headers = new Headers(init?.headers)
    expect(headers.get("x-forge-viewer-context")).toBeTruthy()
    expect(headers.get("x-forge-viewer-context-signature")).toBeTruthy()
    expect(headers.get("cf-connecting-ip")).toBeNull()
  })

  it("returns the same success for invalid/cross-site/limited requests and retry only for infrastructure failure", async () => {
    const fetch = vi.spyOn(globalThis, "fetch")
    await expect(
      submitPublicUserPlaylistReportRequest({
        data: { reportIntent: "bad" },
        requestHeaders: requestHeaders(),
      }),
    ).resolves.toEqual({ ok: true })

    const crossSite = requestHeaders()
    crossSite.set("sec-fetch-site", "cross-site")
    await expect(
      submitPublicUserPlaylistReportRequest({
        data: {
          reportIntent: REPORT_INTENT,
          category: "OTHER_SAFETY",
          detail: "",
        },
        requestHeaders: crossSite,
      }),
    ).resolves.toEqual({ ok: true })

    consume.mockResolvedValueOnce("limited")
    await expect(
      submitPublicUserPlaylistReportRequest({
        data: {
          reportIntent: REPORT_INTENT,
          category: "OTHER_SAFETY",
          detail: "",
        },
        requestHeaders: requestHeaders(),
      }),
    ).resolves.toEqual({ ok: true })

    consume.mockResolvedValueOnce("unavailable")
    await expect(
      submitPublicUserPlaylistReportRequest({
        data: {
          reportIntent: REPORT_INTENT,
          category: "OTHER_SAFETY",
          detail: "",
        },
        requestHeaders: requestHeaders(),
      }),
    ).resolves.toEqual({ ok: false, retryable: true })
    expect(fetch).not.toHaveBeenCalled()
  })
})
