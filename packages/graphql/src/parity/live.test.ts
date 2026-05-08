import { describe, expect, it } from "vitest"

import {
  LiveModeConfigError,
  LiveModeDisabledError,
  assertLiveModeEnabled,
  validateHost,
} from "./live"

describe("assertLiveModeEnabled", () => {
  it("throws LiveModeDisabledError when FORGE_PARITY_LIVE is unset", () => {
    expect(() => assertLiveModeEnabled({})).toThrow(LiveModeDisabledError)
  })

  it("throws LiveModeDisabledError with a message naming the missing env", () => {
    try {
      assertLiveModeEnabled({})
    } catch (e) {
      expect((e as Error).message).toMatch(/FORGE_PARITY_LIVE/)
      return
    }
    throw new Error("expected throw")
  })

  it("throws LiveModeConfigError when FORGE_STRAPI_URL is missing", () => {
    expect(() =>
      assertLiveModeEnabled({
        FORGE_PARITY_LIVE: "1",
        FORGE_ADMIN_URL: "http://localhost:3003/api/graphql",
        FORGE_STRAPI_PUBLIC_ORIGIN: "https://cdn.example.com",
      }),
    ).toThrow(/FORGE_STRAPI_URL/)
  })

  it("throws LiveModeConfigError when FORGE_ADMIN_URL is missing", () => {
    expect(() =>
      assertLiveModeEnabled({
        FORGE_PARITY_LIVE: "1",
        FORGE_STRAPI_URL: "https://cms.example.com/graphql",
        FORGE_STRAPI_PUBLIC_ORIGIN: "https://cdn.example.com",
      }),
    ).toThrow(/FORGE_ADMIN_URL/)
  })

  it("throws LiveModeConfigError when FORGE_STRAPI_PUBLIC_ORIGIN is missing", () => {
    expect(() =>
      assertLiveModeEnabled({
        FORGE_PARITY_LIVE: "1",
        FORGE_STRAPI_URL: "https://cms.example.com/graphql",
        FORGE_ADMIN_URL: "http://localhost:3003/api/graphql",
      }),
    ).toThrow(/FORGE_STRAPI_PUBLIC_ORIGIN/)
  })

  it("returns config when all env vars are set", () => {
    const config = assertLiveModeEnabled({
      FORGE_PARITY_LIVE: "1",
      FORGE_STRAPI_URL: "https://cms.example.com/graphql",
      FORGE_ADMIN_URL: "http://localhost:3003/api/graphql",
      FORGE_STRAPI_PUBLIC_ORIGIN: "https://cdn.example.com",
    })
    expect(config.strapiUrl).toBe("https://cms.example.com/graphql")
    expect(config.adminUrl).toBe("http://localhost:3003/api/graphql")
    expect(config.baseOrigin).toBe("https://cdn.example.com")
  })
})

describe("validateHost", () => {
  it("accepts localhost (local dev)", () => {
    expect(() =>
      validateHost("http://localhost:3003/api/graphql", "FORGE_ADMIN_URL"),
    ).not.toThrow()
  })

  it("accepts production admin host", () => {
    expect(() =>
      validateHost(
        "https://admin.jesusfilm.org/api/graphql",
        "FORGE_ADMIN_URL",
      ),
    ).not.toThrow()
  })

  it("accepts a Railway preview URL", () => {
    expect(() =>
      validateHost(
        "https://forge-admin-preview-pr-42.up.railway.app/api/graphql",
        "FORGE_ADMIN_URL",
      ),
    ).not.toThrow()
  })

  it("REJECTS auth.jesusfilm.org (per PR #909 — auth host returns 404 on /api/*)", () => {
    expect(() =>
      validateHost("https://auth.jesusfilm.org/api/graphql", "FORGE_ADMIN_URL"),
    ).toThrow(LiveModeConfigError)
  })

  it("REJECTS auth.jesusfilm.org with non-default port (e.g. :8443) — port-bypass guard", () => {
    expect(() =>
      validateHost(
        "https://auth.jesusfilm.org:8443/api/graphql",
        "FORGE_ADMIN_URL",
      ),
    ).toThrow(LiveModeConfigError)
  })

  it("REJECTS auth.jesusfilm.org with mixed-case host", () => {
    expect(() =>
      validateHost("https://AUTH.JesusFilm.ORG/api/graphql", "FORGE_ADMIN_URL"),
    ).toThrow(LiveModeConfigError)
  })

  it("rejection error names auth.jesusfilm.org explicitly so misconfig is debuggable", () => {
    try {
      validateHost("https://auth.jesusfilm.org/api/graphql", "FORGE_ADMIN_URL")
    } catch (e) {
      expect((e as Error).message).toMatch(/auth\.jesusfilm\.org/)
      return
    }
    throw new Error("expected throw")
  })

  it("throws LiveModeConfigError on a malformed URL", () => {
    expect(() => validateHost("not a url", "FORGE_ADMIN_URL")).toThrow(
      LiveModeConfigError,
    )
  })
})
