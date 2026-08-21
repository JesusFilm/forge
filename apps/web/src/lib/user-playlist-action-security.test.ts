import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"

import {
  authorizeUserPlaylistActionRequest,
  authorizeUserPlaylistServerRenderRequest,
  signUserPlaylistViewerContext,
} from "./user-playlist-action-security"

const allowedOrigins = ["https://www.jesusfilm.org"]

function actionHeaders(overrides: HeadersInit = {}): Headers {
  return new Headers({
    host: "www.jesusfilm.org",
    origin: "https://www.jesusfilm.org",
    "next-action": "0085b246c2b7639365ce6f2316b2d46f40df3d4d51",
    "sec-fetch-site": "same-origin",
    ...Object.fromEntries(new Headers(overrides)),
  })
}

describe("User Playlist Server Action request admission", () => {
  it("admits a same-origin Next action and extracts only trusted edge context", () => {
    const result = authorizeUserPlaylistActionRequest(
      actionHeaders({
        "cf-connecting-ip": "2001:db8::1",
        "cf-ipcountry": "ca",
        "cf-ray": "1234567890abcdef-YUL",
        "x-forwarded-for": "6.6.6.6",
      }),
      { allowedOrigins },
    )

    expect(result).toEqual({
      ok: true,
      context: { countryCode: "CA", viewerIp: "2001:db8::1" },
    })
  })

  it.each([
    ["missing Origin", { origin: "" }],
    ["opaque Origin", { origin: "null" }],
    ["cross-site Origin", { origin: "https://attacker.example" }],
    ["host confusion", { host: "attacker.example" }],
    [
      "forwarded-host list",
      { "x-forwarded-host": "www.jesusfilm.org, attacker.example" },
    ],
    ["cross-site Fetch Metadata", { "sec-fetch-site": "cross-site" }],
    ["missing Next action marker", { "next-action": "" }],
    ["method override", { "x-http-method-override": "GET" }],
  ])("fails closed for %s", (_label, overrides) => {
    expect(
      authorizeUserPlaylistActionRequest(actionHeaders(overrides), {
        allowedOrigins,
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" })
  })

  it("normalizes default ports and a single trusted forwarded host", () => {
    expect(
      authorizeUserPlaylistActionRequest(
        actionHeaders({
          host: "forge-web.railway.internal:8080",
          origin: "https://www.jesusfilm.org:443",
          "x-forwarded-host": "WWW.JESUSFILM.ORG:443",
          "x-forwarded-proto": "https",
        }),
        { allowedOrigins },
      ),
    ).toMatchObject({ ok: true })
  })

  it("ignores spoofable forwarding headers and invalid Cloudflare values", () => {
    const result = authorizeUserPlaylistActionRequest(
      actionHeaders({
        "cf-connecting-ip": "1.1.1.1, 6.6.6.6",
        "cf-ipcountry": "T1",
        "x-forwarded-for": "1.2.3.4",
      }),
      { allowedOrigins },
    )

    expect(result).toEqual({
      ok: true,
      context: { countryCode: null, viewerIp: null },
    })
  })
})

describe("User Playlist trusted viewer context", () => {
  it("creates the exact fresh, integrity-protected Admin envelope", () => {
    const secret = "viewer-context-secret-that-is-at-least-32-bytes"
    const headers = signUserPlaylistViewerContext(
      { countryCode: "CA", viewerIp: "2001:db8::1" },
      { secret, now: new Date("2026-08-21T12:00:00.000Z") },
    )
    const encoded = headers["x-forge-viewer-context"]

    expect(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    ).toEqual({
      countryCode: "CA",
      viewerIp: "2001:db8::1",
      issuedAt: 1787313600000,
    })
    expect(headers["x-forge-viewer-context-signature"]).toBe(
      createHmac("sha256", secret).update(encoded, "ascii").digest("base64url"),
    )
  })

  it("fails closed rather than forwarding unsigned context", () => {
    expect(() =>
      signUserPlaylistViewerContext(
        { countryCode: null, viewerIp: null },
        { secret: "short" },
      ),
    ).toThrow("not configured")
  })
})

describe("User Playlist server-only loader admission", () => {
  it("admits an allowlisted render host without weakening action admission", () => {
    const renderHeaders = new Headers({ host: "www.jesusfilm.org" })
    expect(
      authorizeUserPlaylistServerRenderRequest(renderHeaders, {
        allowedOrigins,
      }),
    ).toMatchObject({ ok: true })
    expect(
      authorizeUserPlaylistActionRequest(renderHeaders, { allowedOrigins }),
    ).toEqual({ ok: false, code: "FORBIDDEN" })
  })

  it("rejects direct/internal and forwarded host confusion", () => {
    for (const candidate of [
      new Headers({ host: "forge-web.railway.internal" }),
      new Headers({
        host: "forge-web.railway.internal",
        "x-forwarded-host": "www.jesusfilm.org, attacker.example",
      }),
    ]) {
      expect(
        authorizeUserPlaylistServerRenderRequest(candidate, {
          allowedOrigins,
        }),
      ).toEqual({ ok: false, code: "FORBIDDEN" })
    }
  })
})
