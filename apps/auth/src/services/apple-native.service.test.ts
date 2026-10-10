import { describe, expect, it, vi } from "vitest"

import {
  exchangeAppleAuthorizationCode,
  revokeAppleRefreshToken,
  type AppleNativeClientConfig,
} from "./apple-native.service"

function config(fetchImpl: typeof fetch): AppleNativeClientConfig {
  return {
    bundleId: "org.jesusfilm.forgewatch",
    clientSecret: "apple-native-client-secret",
    fetchImpl,
  }
}

describe("exchangeAppleAuthorizationCode", () => {
  it("exchanges a code for a refresh token against Apple's token endpoint", async () => {
    const fetchImpl = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toBe("https://appleid.apple.com/auth/token")
        const body = init?.body as URLSearchParams
        expect(body.get("client_id")).toBe("org.jesusfilm.forgewatch")
        expect(body.get("client_secret")).toBe("apple-native-client-secret")
        expect(body.get("code")).toBe("native-auth-code")
        expect(body.get("grant_type")).toBe("authorization_code")
        return new Response(
          JSON.stringify({
            access_token: "apple-access",
            refresh_token: "apple-refresh",
            expires_in: 3600,
          }),
          { status: 200 },
        )
      },
    ) as unknown as typeof fetch

    const result = await exchangeAppleAuthorizationCode(
      config(fetchImpl),
      "native-auth-code",
    )

    expect(result).toMatchObject({
      ok: true,
      refreshToken: "apple-refresh",
      accessToken: "apple-access",
    })
  })

  it("classifies a rejected exchange without throwing", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
        }),
    ) as unknown as typeof fetch

    await expect(
      exchangeAppleAuthorizationCode(config(fetchImpl), "expired-code"),
    ).resolves.toEqual({ ok: false, reason: "exchange_rejected" })
  })

  it("classifies a success response missing refresh_token", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: "only-access" }), {
          status: 200,
        }),
    ) as unknown as typeof fetch

    await expect(
      exchangeAppleAuthorizationCode(config(fetchImpl), "code"),
    ).resolves.toEqual({ ok: false, reason: "no_refresh_token" })
  })

  it("classifies network failures without throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed")
    }) as unknown as typeof fetch

    await expect(
      exchangeAppleAuthorizationCode(config(fetchImpl), "code"),
    ).resolves.toEqual({ ok: false, reason: "network_error" })
  })
})

describe("revokeAppleRefreshToken", () => {
  it("revokes against Apple's revoke endpoint with a refresh-token hint", async () => {
    const fetchImpl = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toBe("https://appleid.apple.com/auth/revoke")
        const body = init?.body as URLSearchParams
        expect(body.get("token")).toBe("apple-refresh")
        expect(body.get("token_type_hint")).toBe("refresh_token")
        return new Response(null, { status: 200 })
      },
    ) as unknown as typeof fetch

    await expect(
      revokeAppleRefreshToken(config(fetchImpl), "apple-refresh"),
    ).resolves.toEqual({ ok: true })
  })

  it("classifies a rejected revocation", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 400 }),
    ) as unknown as typeof fetch

    await expect(
      revokeAppleRefreshToken(config(fetchImpl), "bad-token"),
    ).resolves.toEqual({ ok: false, reason: "revocation_rejected" })
  })

  it("classifies network failures without throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed")
    }) as unknown as typeof fetch

    await expect(
      revokeAppleRefreshToken(config(fetchImpl), "token"),
    ).resolves.toEqual({ ok: false, reason: "network_error" })
  })
})
