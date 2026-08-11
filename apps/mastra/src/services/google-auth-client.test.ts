import { afterEach, describe, expect, it, vi } from "vitest"

import { getGoogleAccessToken, requestGoogleJson } from "./google-auth-client"

const scopes = ["https://www.googleapis.com/auth/webmasters.readonly"]
const privateKey = [
  "-----BEGIN PRIVATE KEY-----",
  "fake-private-key-material",
  "-----END PRIVATE KEY-----",
  "",
].join("\n")

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

function serviceAccountJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "service_account",
    project_id: "jfplab",
    private_key_id: "fake-key-id",
    private_key: privateKey,
    client_email: "forge-seo-production@jfplab.iam.gserviceaccount.com",
    client_id: "109609494053001160408",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    ...overrides,
  })
}

describe("getGoogleAccessToken", () => {
  it("uses an explicit short-lived access token before renewable credentials", async () => {
    const authFactory = vi.fn()
    vi.stubEnv("SEO_AUTOMATION_MODE", "invalid")

    await expect(
      getGoogleAccessToken(scopes, {
        accessToken: "short-lived-token",
        credentialsJson: "not-json",
        expectedProjectId: "jfplab",
        authFactory,
      }),
    ).resolves.toEqual({ ok: true, accessToken: "short-lived-token" })
    expect(authFactory).not.toHaveBeenCalled()
  })

  it("mints a renewable token from a validated service-account credential", async () => {
    const getAccessToken = vi.fn(async () => "renewable-token")
    const authFactory = vi.fn(() => ({ getAccessToken }))

    await expect(
      getGoogleAccessToken(scopes, {
        credentialsJson: serviceAccountJson(),
        expectedProjectId: "jfplab",
        authFactory,
      }),
    ).resolves.toEqual({ ok: true, accessToken: "renewable-token" })
    expect(authFactory).toHaveBeenCalledWith({
      scopes,
      credentials: {
        type: "service_account",
        project_id: "jfplab",
        private_key_id: "fake-key-id",
        private_key: privateKey,
        client_email: "forge-seo-production@jfplab.iam.gserviceaccount.com",
        client_id: "109609494053001160408",
      },
    })
    expect(getAccessToken).toHaveBeenCalledOnce()
  })

  it("loads renewable credentials through the production environment seam", async () => {
    const getAccessToken = vi.fn(async () => "renewable-token")
    const authFactory = vi.fn(() => ({ getAccessToken }))
    vi.stubEnv("SEO_GOOGLE_CREDENTIALS_JSON", serviceAccountJson())
    vi.stubEnv("SEO_GOOGLE_PROJECT_ID", "jfplab")

    await expect(
      getGoogleAccessToken(scopes, { authFactory }),
    ).resolves.toEqual({ ok: true, accessToken: "renewable-token" })
    expect(authFactory).toHaveBeenCalledWith({
      scopes,
      credentials: expect.objectContaining({
        type: "service_account",
        project_id: "jfplab",
        client_email: "forge-seo-production@jfplab.iam.gserviceaccount.com",
      }),
    })
  })

  it("prefers the environment access token over sealed credentials", async () => {
    const authFactory = vi.fn()
    vi.stubEnv("SEO_GOOGLE_ACCESS_TOKEN", "short-lived-token")
    vi.stubEnv("SEO_GOOGLE_CREDENTIALS_JSON", "not-json")
    vi.stubEnv("SEO_GOOGLE_PROJECT_ID", "jfplab")

    await expect(
      getGoogleAccessToken(scopes, { authFactory }),
    ).resolves.toEqual({ ok: true, accessToken: "short-lived-token" })
    expect(authFactory).not.toHaveBeenCalled()
  })

  it.each([
    ["malformed JSON", "not-json", "jfplab"],
    [
      "the wrong credential type",
      serviceAccountJson({ type: "authorized_user" }),
      "jfplab",
    ],
    [
      "a missing client email",
      serviceAccountJson({ client_email: undefined }),
      "jfplab",
    ],
    [
      "a missing private key",
      serviceAccountJson({ private_key: undefined }),
      "jfplab",
    ],
    [
      "an invalid project ID",
      serviceAccountJson({
        project_id: "1fplab",
        client_email: "forge-seo-production@1fplab.iam.gserviceaccount.com",
      }),
      "1fplab",
    ],
    [
      "an invalid client email",
      serviceAccountJson({
        client_email: "forge+seo@jfplab.iam.gserviceaccount.com",
      }),
      "jfplab",
    ],
    [
      "an invalid private key",
      serviceAccountJson({ private_key: "not-pem" }),
      "jfplab",
    ],
    [
      "an oversized credential",
      serviceAccountJson({ padding: "x".repeat(65_537) }),
      "jfplab",
    ],
  ])(
    "rejects %s without constructing GoogleAuth",
    async (_label, credentialsJson, expectedProjectId) => {
      const authFactory = vi.fn()

      await expect(
        getGoogleAccessToken(scopes, {
          credentialsJson,
          expectedProjectId,
          authFactory,
        }),
      ).resolves.toEqual({ ok: false, reason: "auth_failed", retryable: false })
      expect(authFactory).not.toHaveBeenCalled()
    },
  )

  it("requires an expected project for sealed credentials", async () => {
    const authFactory = vi.fn()

    await expect(
      getGoogleAccessToken(scopes, {
        credentialsJson: serviceAccountJson(),
        authFactory,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
    expect(authFactory).not.toHaveBeenCalled()
  })

  it("rejects either half of a sealed credential pair before ambient ADC", async () => {
    const authFactory = vi.fn()
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "ambient-project")

    for (const partial of [
      { credentialsJson: serviceAccountJson() },
      { expectedProjectId: "jfplab" },
    ]) {
      await expect(
        getGoogleAccessToken(scopes, { ...partial, authFactory }),
      ).resolves.toEqual({
        ok: false,
        reason: "config_missing",
        retryable: false,
      })
    }
    expect(authFactory).not.toHaveBeenCalled()
  })

  it("rejects credentials from a different project", async () => {
    const authFactory = vi.fn()

    await expect(
      getGoogleAccessToken(scopes, {
        credentialsJson: serviceAccountJson({ project_id: "other-project" }),
        expectedProjectId: "jfplab",
        authFactory,
      }),
    ).resolves.toEqual({ ok: false, reason: "auth_failed", retryable: false })
    expect(authFactory).not.toHaveBeenCalled()
  })

  it("rejects a client email from a different service-account project", async () => {
    const authFactory = vi.fn()

    await expect(
      getGoogleAccessToken(scopes, {
        credentialsJson: serviceAccountJson({
          client_email:
            "forge-seo-production@other-project.iam.gserviceaccount.com",
        }),
        expectedProjectId: "jfplab",
        authFactory,
      }),
    ).resolves.toEqual({ ok: false, reason: "auth_failed", retryable: false })
    expect(authFactory).not.toHaveBeenCalled()
  })

  it("returns a sanitized failure when token acquisition throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const secret = "do-not-log-this-private-key"

    await expect(
      getGoogleAccessToken(scopes, {
        credentialsJson: serviceAccountJson(),
        expectedProjectId: "jfplab",
        authFactory: () => ({
          getAccessToken: async () => {
            throw new Error(secret)
          },
        }),
      }),
    ).resolves.toEqual({ ok: false, reason: "auth_failed", retryable: false })
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it("bounds stalled token acquisition", async () => {
    vi.useFakeTimers()
    const result = getGoogleAccessToken(scopes, {
      credentialsJson: serviceAccountJson(),
      expectedProjectId: "jfplab",
      timeoutMs: 1_000,
      authFactory: () => ({
        getAccessToken: () => new Promise(() => undefined),
      }),
    })

    await vi.advanceTimersByTimeAsync(1_000)
    await expect(result).resolves.toEqual({
      ok: false,
      reason: "timeout",
      retryable: true,
    })
  })

  it("keeps the ambient ADC path when sealed credentials are absent", async () => {
    const authFactory = vi.fn(() => ({
      getAccessToken: async () => "adc-token",
    }))

    await expect(
      getGoogleAccessToken(scopes, { authFactory }),
    ).resolves.toEqual({ ok: true, accessToken: "adc-token" })
    expect(authFactory).toHaveBeenCalledWith({ scopes })
  })
})

describe("requestGoogleJson", () => {
  const request = (fetchImpl: typeof fetch) =>
    requestGoogleJson({
      url: new URL("https://www.googleapis.com/example"),
      accessToken: "access",
      body: {},
      timeoutMs: 1_000,
      maxResponseBytes: 16,
      maxAttempts: 1,
      fetchImpl,
    })

  it("distinguishes an oversized response from invalid JSON", async () => {
    await expect(
      request(
        vi.fn(
          async () => new Response("x".repeat(17)),
        ) as unknown as typeof fetch,
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "response_too_large",
      retryable: true,
    })
    await expect(
      request(vi.fn(async () => new Response("{")) as unknown as typeof fetch),
    ).resolves.toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })
  })

  it("retries a response stream failure as a network error", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.error(new Error("stream failed"))
            },
          }),
        ),
    ) as unknown as typeof fetch

    await expect(
      requestGoogleJson({
        url: new URL("https://www.googleapis.com/example"),
        accessToken: "access",
        body: {},
        timeoutMs: 1_000,
        maxResponseBytes: 16,
        maxAttempts: 2,
        fetchImpl,
        sleep: async () => undefined,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "network_error",
      retryable: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("retries an aborted response stream as a timeout", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.error(new DOMException("timed out", "TimeoutError"))
            },
          }),
        ),
    ) as unknown as typeof fetch

    await expect(
      requestGoogleJson({
        url: new URL("https://www.googleapis.com/example"),
        accessToken: "access",
        body: {},
        timeoutMs: 1_000,
        maxResponseBytes: 16,
        maxAttempts: 2,
        fetchImpl,
        sleep: async () => undefined,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "timeout",
      retryable: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
