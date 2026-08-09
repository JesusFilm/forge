// Transport for the RFC 8628 device grant against apps/auth (feat-322 U4.2).
//
// Deliberately thin and React-free: every decision about WHEN to call these
// lives in the pure state machine (`deviceGrantMachine.ts`), which is the
// repo's testable-helper convention for apps/tv (no render harness exists here).
//
// Error contract: these never throw for an OAuth-level failure. RFC 8628's five
// error codes are outcomes, not exceptions, and the state machine branches on
// them. Only a transport failure rejects, and every caller wraps the tick —
// an unhandled rejection in dev escalates to an all-native RCTFatal with no JS
// message.

import * as Crypto from "expo-crypto"

import { env } from "../../env"

export const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"

/** Per-environment client id. The seeder writes exactly these four. */
export function getDeviceClientId(authBaseUrl: string): string {
  if (authBaseUrl.includes("localhost")) return "jfp_tv_local"
  if (authBaseUrl.includes("auth-preview.")) return "jfp_tv_preview"
  if (authBaseUrl.includes("auth-stage.")) return "jfp_tv_staging"
  return "jfp_tv_production"
}

export type DeviceGrantConfig = {
  authBaseUrl: string
  clientId: string
}

export function getDeviceGrantConfig(): DeviceGrantConfig {
  const authBaseUrl = env.EXPO_PUBLIC_AUTH_BASE_URL
  return { authBaseUrl, clientId: getDeviceClientId(authBaseUrl) }
}

// ── PKCE ────────────────────────────────────────────────────────────────────

const B64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

function base64UrlFromBytes(bytes: Uint8Array): string {
  let out = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63]
    if (i + 1 < bytes.length) out += B64URL[(n >> 6) & 63]
    if (i + 2 < bytes.length) out += B64URL[n & 63]
  }
  return out
}

export type PkcePair = { verifier: string; challenge: string }

/**
 * RFC 7636 S256 pair. The server requires S256 and rejects `plain`.
 *
 * This is what binds redemption to THIS device: RFC 8628 alone lets anyone
 * holding a stolen device code redeem it, and the verifier never leaves here.
 * The randomness must come from expo-crypto — Hermes' Math.random would make
 * the verifier guessable and defeat the whole point.
 */
export async function createPkcePair(): Promise<PkcePair> {
  const verifier = base64UrlFromBytes(Crypto.getRandomBytes(32))
  const challenge = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  )
  // expo-crypto returns standard base64; RFC 7636 wants base64url, unpadded.
  const urlSafe = challenge
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  return { verifier, challenge: urlSafe }
}

// ── Wire types ──────────────────────────────────────────────────────────────

export type DeviceCodeGrant = {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresInSeconds: number
  intervalSeconds: number
}

export type DeviceTokens = {
  accessToken: string
  refreshToken?: string
  idToken?: string
  scope?: string
  expiresInSeconds?: number
}

/**
 * Every outcome the poll can produce, as data.
 *
 * `unknown_error` is deliberately its own case rather than folded into
 * `pending`: RFC 8628 says an unrecognised code is terminal, and a
 * keep-polling-on-anything fallback would let a permanent failure spin
 * forever while looking healthy.
 */
export type PollOutcome =
  | { kind: "pending" }
  | { kind: "slow_down" }
  | { kind: "denied" }
  | { kind: "expired" }
  | { kind: "unknown_error"; code: string }
  | { kind: "transport_error" }
  | { kind: "granted"; tokens: DeviceTokens }

type ErrorBody = { error?: string; error_description?: string }

/**
 * Abort budget per request. Bounded strictly below the poll interval so a hung
 * request can never overlap the next tick — otherwise a stalled connection
 * silently doubles the effective poll rate against the server's own rate limit.
 */
export const REQUEST_TIMEOUT_MS = 4000

async function postJson(
  url: string,
  body: unknown,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const json = (await res.json()) as Record<string, unknown>
    return { ok: res.ok, status: res.status, json }
  } finally {
    clearTimeout(timer)
  }
}

export async function requestDeviceCode(
  config: DeviceGrantConfig,
  challenge: string,
): Promise<DeviceCodeGrant> {
  const { ok, json } = await postJson(
    `${config.authBaseUrl}/api/auth/device/code`,
    {
      client_id: config.clientId,
      code_challenge: challenge,
      code_challenge_method: "S256",
    },
  )
  if (!ok) {
    const body = json as ErrorBody
    throw new Error(body.error ?? "device_code_failed")
  }
  return {
    deviceCode: String(json.device_code),
    userCode: String(json.user_code),
    verificationUri: String(json.verification_uri),
    verificationUriComplete: String(json.verification_uri_complete),
    expiresInSeconds: Number(json.expires_in),
    intervalSeconds: Number(json.interval),
  }
}

export async function pollDeviceToken(
  config: DeviceGrantConfig,
  deviceCode: string,
  verifier: string,
): Promise<PollOutcome> {
  let result: Awaited<ReturnType<typeof postJson>>
  try {
    result = await postJson(`${config.authBaseUrl}/api/auth/device/token`, {
      grant_type: DEVICE_GRANT_TYPE,
      device_code: deviceCode,
      client_id: config.clientId,
      code_verifier: verifier,
    })
  } catch {
    // Timeout, offline, DNS. Distinct from an OAuth error: the grant may still
    // be perfectly alive, so the machine retries rather than giving up.
    return { kind: "transport_error" }
  }

  const { ok, json } = result
  if (ok && typeof json.access_token === "string") {
    return {
      kind: "granted",
      tokens: {
        accessToken: json.access_token,
        refreshToken:
          typeof json.refresh_token === "string"
            ? json.refresh_token
            : undefined,
        idToken: typeof json.id_token === "string" ? json.id_token : undefined,
        scope: typeof json.scope === "string" ? json.scope : undefined,
        expiresInSeconds:
          typeof json.expires_in === "number" ? json.expires_in : undefined,
      },
    }
  }

  switch ((json as ErrorBody).error) {
    case "authorization_pending":
      return { kind: "pending" }
    case "slow_down":
      return { kind: "slow_down" }
    case "access_denied":
      return { kind: "denied" }
    case "expired_token":
      return { kind: "expired" }
    default:
      return {
        kind: "unknown_error",
        code: (json as ErrorBody).error ?? "unknown",
      }
  }
}
