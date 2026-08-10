import { GoogleAuth } from "google-auth-library"

import { getSeoConfig } from "../config/seo"
import type { SeoProviderFailure } from "./seo-evidence"
import { classifySeoHttpStatus, readSeoJson } from "./seo-http"

export type GoogleAccessTokenResult =
  | { ok: true; accessToken: string }
  | SeoProviderFailure

export type GoogleTokenProvider = (
  scopes: readonly string[],
) => Promise<GoogleAccessTokenResult>

export function isGoogleApiDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(value))
}

export async function getGoogleAccessToken(
  scopes: readonly string[],
  options: {
    accessToken?: string
    acquire?: (scopes: readonly string[]) => Promise<string | null | undefined>
  } = {},
): Promise<GoogleAccessTokenResult> {
  const configured = options.accessToken ?? getSeoConfig().googleAccessToken
  if (configured) return { ok: true, accessToken: configured }
  try {
    const token = options.acquire
      ? await options.acquire(scopes)
      : await new GoogleAuth({ scopes: [...scopes] }).getAccessToken()
    return token
      ? { ok: true, accessToken: token }
      : { ok: false, reason: "config_missing", retryable: false }
  } catch {
    return { ok: false, reason: "auth_failed", retryable: false }
  }
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.min(seconds * 1_000, 60_000)
    : null
}

export async function requestGoogleJson(options: {
  url: URL
  accessToken: string
  body: unknown
  timeoutMs: number
  maxResponseBytes: number
  maxAttempts: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}): Promise<{ ok: true; body: unknown } | SeoProviderFailure> {
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  let last: SeoProviderFailure = {
    ok: false,
    reason: "network_error",
    retryable: true,
  }
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    let response: Response
    try {
      response = await fetchImpl(options.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.accessToken}`,
          "content-type": "application/json",
          "user-agent": "forge-mastra-seo/1.0",
        },
        body: JSON.stringify(options.body),
        redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs),
      })
    } catch (error) {
      last = {
        ok: false,
        reason:
          error instanceof DOMException && error.name === "TimeoutError"
            ? "timeout"
            : "network_error",
        retryable: true,
      }
      if (attempt < options.maxAttempts) {
        await sleep(Math.min(250 * 2 ** (attempt - 1), 2_000))
        continue
      }
      return last
    }
    if (!response.ok) {
      last = {
        ok: false,
        ...classifySeoHttpStatus(response.status),
      }
      if (last.retryable && attempt < options.maxAttempts) {
        await sleep(
          retryAfterMs(response.headers.get("retry-after")) ??
            Math.min(250 * 2 ** (attempt - 1), 2_000),
        )
        continue
      }
      return last
    }
    const body = await readSeoJson(response, options.maxResponseBytes)
    return body === undefined
      ? { ok: false, reason: "parse_error", retryable: true }
      : { ok: true, body }
  }
  return last
}
