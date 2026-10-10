/**
 * Apple credential lifecycle for NATIVE sign-ins.
 *
 * The native sheet path (`signIn.social` with an identityToken) never runs an
 * authorization-code exchange, so no revocable Apple credential is persisted —
 * but Apple's account-deletion guidance requires revoking the user's tokens
 * when the account is deleted. The app therefore captures the native sheet's
 * one-time authorizationCode, and this service exchanges it server-side (the
 * app bundle id is the OAuth client for native codes, not the web Service ID)
 * so the refresh token can be stored and later revoked at deletion.
 */

const APPLE_TOKEN_ENDPOINT = "https://appleid.apple.com/auth/token"
const APPLE_REVOKE_ENDPOINT = "https://appleid.apple.com/auth/revoke"
const APPLE_REQUEST_TIMEOUT_MS = 5000

export type AppleNativeClientConfig = {
  /** App bundle id — the client_id native authorization codes are issued to. */
  bundleId: string
  /** Pre-built ES256 client-secret JWT whose `sub` is the bundle id. */
  clientSecret: string
  fetchImpl?: typeof fetch
}

export type AppleCodeExchangeResult =
  | {
      ok: true
      refreshToken: string
      accessToken?: string
      accessTokenExpiresAt?: Date
    }
  | {
      ok: false
      reason: "exchange_rejected" | "no_refresh_token" | "network_error"
    }

export async function exchangeAppleAuthorizationCode(
  config: AppleNativeClientConfig,
  authorizationCode: string,
): Promise<AppleCodeExchangeResult> {
  const fetchImpl = config.fetchImpl ?? fetch

  let response: Response
  try {
    response = await fetchImpl(APPLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.bundleId,
        client_secret: config.clientSecret,
        code: authorizationCode,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(APPLE_REQUEST_TIMEOUT_MS),
    })
  } catch {
    return { ok: false, reason: "network_error" }
  }

  if (!response.ok) {
    return { ok: false, reason: "exchange_rejected" }
  }

  let payload: {
    refresh_token?: unknown
    access_token?: unknown
    expires_in?: unknown
  }
  try {
    payload = (await response.json()) as typeof payload
  } catch {
    return { ok: false, reason: "exchange_rejected" }
  }

  if (typeof payload.refresh_token !== "string" || !payload.refresh_token) {
    return { ok: false, reason: "no_refresh_token" }
  }

  return {
    ok: true,
    refreshToken: payload.refresh_token,
    accessToken:
      typeof payload.access_token === "string"
        ? payload.access_token
        : undefined,
    accessTokenExpiresAt:
      typeof payload.expires_in === "number"
        ? new Date(Date.now() + payload.expires_in * 1000)
        : undefined,
  }
}

export type AppleRevocationResult =
  | { ok: true }
  | { ok: false; reason: "revocation_rejected" | "network_error" }

export async function revokeAppleRefreshToken(
  config: AppleNativeClientConfig,
  refreshToken: string,
): Promise<AppleRevocationResult> {
  const fetchImpl = config.fetchImpl ?? fetch

  let response: Response
  try {
    response = await fetchImpl(APPLE_REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.bundleId,
        client_secret: config.clientSecret,
        token: refreshToken,
        token_type_hint: "refresh_token",
      }),
      signal: AbortSignal.timeout(APPLE_REQUEST_TIMEOUT_MS),
    })
  } catch {
    return { ok: false, reason: "network_error" }
  }

  if (!response.ok) {
    return { ok: false, reason: "revocation_rejected" }
  }

  return { ok: true }
}
