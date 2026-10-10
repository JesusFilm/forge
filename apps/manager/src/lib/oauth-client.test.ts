import { afterEach, describe, expect, it, vi } from "vitest"
import {
  exchangeManagerAuthorizationCode,
  type ManagerOAuthConfig,
} from "./oauth-client"

const config: ManagerOAuthConfig = {
  issuerUrl: "https://auth.jesusfilm.org",
  clientId: "jfp_manager_local",
  clientSecret: "manager-secret",
  managerBaseUrl: "http://localhost:3002",
}

describe("exchangeManagerAuthorizationCode", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("bounds the Auth token exchange with an abort signal", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        access_token: "access-token",
        id_token: "id-token",
        scope: "openid manager:access",
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      exchangeManagerAuthorizationCode({
        config,
        code: "code-123",
        codeVerifier: "verifier-123",
      }),
    ).resolves.toMatchObject({
      access_token: "access-token",
    })

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://auth.jesusfilm.org/api/auth/oauth2/token"),
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    )
  })
})
