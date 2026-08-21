import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { resolveTrustedUserPlaylistRequestContext } from "./user-playlist-request-context"

const secret = "viewer-context-secret-that-is-at-least-32-bytes"

function signedRequest(
  payload: object,
  overrides: Record<string, string> = {},
) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = createHmac("sha256", secret)
    .update(encoded, "ascii")
    .digest("base64url")
  return new Request("https://admin.example.test/api/graphql", {
    headers: {
      "x-forge-viewer-context": encoded,
      "x-forge-viewer-context-signature": signature,
      ...overrides,
    },
  })
}

describe("trusted User Playlist request context", () => {
  it("accepts a fresh HMAC-bound country and IP", () => {
    const now = new Date("2026-08-21T12:00:00.000Z")
    expect(
      resolveTrustedUserPlaylistRequestContext(
        signedRequest({
          countryCode: "CA",
          viewerIp: "2001:db8::1",
          issuedAt: now.getTime(),
        }),
        { secret, now: () => now },
      ),
    ).toEqual({
      viewerCountry: { integrityVerified: true, countryCode: "CA" },
      reporterIp: { integrityVerified: true, normalizedIp: "2001:db8::1" },
    })
  })

  it("treats unsigned, forged, stale, and hostile context as coarse/global", () => {
    const now = new Date("2026-08-21T12:00:00.000Z")
    const options = { secret, now: () => now }
    const requests = [
      new Request("https://admin.example.test/api/graphql", {
        headers: {
          "x-forwarded-for": "6.6.6.6",
          "cf-ipcountry": "US",
        },
      }),
      signedRequest(
        { countryCode: "US", viewerIp: "1.1.1.1", issuedAt: now.getTime() },
        { "x-forge-viewer-context-signature": "forged" },
      ),
      signedRequest({
        countryCode: "US",
        viewerIp: "1.1.1.1",
        issuedAt: now.getTime() - 301_000,
      }),
      signedRequest({
        countryCode: "ZZZ",
        viewerIp: "not-an-ip",
        issuedAt: now.getTime(),
      }),
    ]
    for (const request of requests) {
      expect(
        resolveTrustedUserPlaylistRequestContext(request, options),
      ).toEqual({ viewerCountry: null, reporterIp: null })
    }
  })

  it("fails closed when the shared secret is unconfigured", () => {
    expect(
      resolveTrustedUserPlaylistRequestContext(
        signedRequest({
          countryCode: "CA",
          viewerIp: "1.1.1.1",
          issuedAt: Date.now(),
        }),
        { secret: undefined },
      ),
    ).toEqual({ viewerCountry: null, reporterIp: null })
  })
})
