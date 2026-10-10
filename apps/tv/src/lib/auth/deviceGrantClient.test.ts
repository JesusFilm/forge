import {
  getDeviceClientId,
  createPkcePair,
  pollDeviceToken,
  refreshAccessToken,
  requestDeviceCode,
  revokeToken,
} from "./deviceGrantClient"

const CONFIG = {
  authBaseUrl: "https://auth.example.test",
  clientId: "jfp_tv_production",
}

type Captured = { url: string; contentType: string; body: string }

let captured: Captured[] = []

function respondWith(status: number, json: unknown) {
  ;(globalThis as { fetch: unknown }).fetch = jest.fn(
    async (url: string, init: RequestInit) => {
      captured.push({
        url,
        contentType:
          (init.headers as Record<string, string>)["content-type"] ?? "",
        body: String(init.body),
      })
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => json,
      }
    },
  )
}

beforeEach(() => {
  captured = []
})

describe("client id", () => {
  it("maps each environment to the client the seeder writes", () => {
    expect(getDeviceClientId("http://localhost:3004")).toBe("jfp_tv_local")
    expect(getDeviceClientId("https://auth-preview.jesusfilm.org")).toBe(
      "jfp_tv_preview",
    )
    expect(getDeviceClientId("https://auth-stage.jesusfilm.org")).toBe(
      "jfp_tv_staging",
    )
    expect(getDeviceClientId("https://auth.jesusfilm.org")).toBe(
      "jfp_tv_production",
    )
  })

  it("defaults an unrecognised host to production, never to local", () => {
    // Falling back to `jfp_tv_local` would send a real TV at a client id that
    // only exists on a developer's machine.
    expect(getDeviceClientId("https://auth.example.test")).toBe(
      "jfp_tv_production",
    )
  })
})

describe("PKCE", () => {
  it("produces a base64url S256 challenge with no padding", async () => {
    const { verifier, challenge } = await createPkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    // `+`, `/` and `=` are exactly what RFC 7636 forbids and what the server
    // rejects; the conversion from expo-crypto's standard base64 is the step
    // that has to hold.
    expect(challenge).not.toMatch(/[+/=]/)
  })

  it("mints a fresh verifier every call", async () => {
    const a = await createPkcePair()
    const b = await createPkcePair()
    expect(a.verifier).not.toBe(b.verifier)
  })
})

/**
 * The wire-format split is the point of these tests.
 *
 * `/device/*` is this repo's own plugin and speaks JSON. `/oauth2/*` is
 * better-auth's and accepts form encoding ONLY — production answers a JSON body
 * there with 415 `Allowed types: application/x-www-form-urlencoded`. Getting
 * this wrong breaks every refresh and every sign-out, and nothing in the device
 * flow itself would reveal it.
 */
describe("wire format", () => {
  it("sends JSON to the device endpoints", async () => {
    respondWith(200, {
      device_code: "dc",
      user_code: "0123456789",
      verification_uri: "https://auth.example.test/device",
      verification_uri_complete:
        "https://auth.example.test/device?user_code=0123456789",
      expires_in: 900,
      interval: 5,
    })
    await requestDeviceCode(CONFIG, "challenge")
    expect(captured[0].url).toContain("/api/auth/device/code")
    expect(captured[0].contentType).toBe("application/json")
  })

  it("sends FORM encoding to the standard token endpoint", async () => {
    respondWith(200, { access_token: "jfp_at_x", expires_in: 3600 })
    await refreshAccessToken(CONFIG, "jfp_rt_x")
    expect(captured[0].url).toContain("/api/auth/oauth2/token")
    expect(captured[0].contentType).toBe("application/x-www-form-urlencoded")
    expect(captured[0].body).toContain("grant_type=refresh_token")
    expect(captured[0].body).toContain("refresh_token=jfp_rt_x")
  })

  it("sends FORM encoding to the revoke endpoint", async () => {
    respondWith(200, {})
    await revokeToken(CONFIG, "jfp_rt_x")
    expect(captured[0].url).toContain("/api/auth/oauth2/revoke")
    expect(captured[0].contentType).toBe("application/x-www-form-urlencoded")
  })

  it("percent-encodes form values", async () => {
    // An unescaped `+` in a token decodes server-side as a space, which fails
    // as "token not found" — indistinguishable from a real revocation.
    respondWith(200, { access_token: "a" })
    await refreshAccessToken(CONFIG, "tok+with/special=chars&more")
    expect(captured[0].body).toContain(
      "refresh_token=tok%2Bwith%2Fspecial%3Dchars%26more",
    )
  })
})

describe("refresh classification", () => {
  it("treats this server's real invalid_token as a revocation", async () => {
    // The literal is taken from production, not from RFC 6749: an unknown
    // refresh token answers `invalid_token`, NOT `invalid_grant`.
    respondWith(400, {
      error: "invalid_token",
      error_description: "refresh token not found",
    })
    expect(await refreshAccessToken(CONFIG, "gone")).toEqual({
      kind: "revoked",
      code: "invalid_token",
    })
  })

  it("treats a server fault as retryable, not a revocation", async () => {
    respondWith(503, { error: "temporarily_unavailable" })
    expect(await refreshAccessToken(CONFIG, "jfp_rt_x")).toEqual({
      kind: "retryable",
    })
  })

  it("treats rate limiting as retryable", async () => {
    respondWith(429, { error: "too_many_requests" })
    expect(await refreshAccessToken(CONFIG, "jfp_rt_x")).toEqual({
      kind: "retryable",
    })
  })

  it("treats an unreachable server as retryable", async () => {
    ;(globalThis as { fetch: unknown }).fetch = jest.fn(async () => {
      throw new Error("network down")
    })
    expect(await refreshAccessToken(CONFIG, "jfp_rt_x")).toEqual({
      kind: "retryable",
    })
  })

  it("reports no refresh token when the server does not rotate", async () => {
    respondWith(200, { access_token: "jfp_at_new", expires_in: 3600 })
    const outcome = await refreshAccessToken(CONFIG, "jfp_rt_x")
    expect(outcome).toMatchObject({ kind: "refreshed" })
    if (outcome.kind !== "refreshed") throw new Error("unreachable")
    // Undefined, so the caller can tell "unchanged" from "rotated" and keep the
    // token it already holds.
    expect(outcome.tokens.refreshToken).toBeUndefined()
  })
})

describe("poll outcomes map RFC 8628 codes", () => {
  it.each([
    ["authorization_pending", "pending"],
    ["slow_down", "slow_down"],
    ["access_denied", "denied"],
    ["expired_token", "expired"],
  ])("maps %s to %s", async (error, kind) => {
    respondWith(400, { error })
    expect(await pollDeviceToken(CONFIG, "dc", "verifier")).toMatchObject({
      kind,
    })
  })

  it("treats an unrecognised code as terminal, not as pending", async () => {
    respondWith(400, { error: "invalid_client" })
    expect(await pollDeviceToken(CONFIG, "dc", "verifier")).toEqual({
      kind: "unknown_error",
      code: "invalid_client",
    })
  })

  it("returns transport_error rather than throwing when offline", async () => {
    // The state machine keeps polling on this. Throwing would surface as an
    // unhandled rejection, which in dev is an all-native RCTFatal.
    ;(globalThis as { fetch: unknown }).fetch = jest.fn(async () => {
      throw new Error("offline")
    })
    expect(await pollDeviceToken(CONFIG, "dc", "verifier")).toEqual({
      kind: "transport_error",
    })
  })

  it("carries the granted tokens out", async () => {
    respondWith(200, {
      access_token: "jfp_at_x",
      refresh_token: "jfp_rt_x",
      id_token: "e.y.z",
      expires_in: 3600,
    })
    expect(await pollDeviceToken(CONFIG, "dc", "verifier")).toMatchObject({
      kind: "granted",
      tokens: { accessToken: "jfp_at_x", refreshToken: "jfp_rt_x" },
    })
  })
})
