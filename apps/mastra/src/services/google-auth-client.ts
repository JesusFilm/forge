import { GoogleAuth } from "google-auth-library"
import { z } from "zod"

import { getGoogleSealedCredentialState, getSeoConfig } from "../config/seo"
import type { SeoProviderFailure } from "./seo-evidence"
import { classifySeoHttpStatus, readSeoJsonResult } from "./seo-http"

export type GoogleAccessTokenResult =
  | { ok: true; accessToken: string }
  | SeoProviderFailure

export type GoogleTokenProvider = (
  scopes: readonly string[],
) => Promise<GoogleAccessTokenResult>

const GoogleServiceAccountCredentialsSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u),
  private_key_id: z.string().min(1).max(256).optional(),
  private_key: z
    .string()
    .min(1)
    .max(32_768)
    .regex(
      /^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----\n?$/u,
    ),
  client_email: z
    .string()
    .max(320)
    .regex(/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/u),
  client_id: z.string().min(1).max(256).optional(),
})

type GoogleServiceAccountCredentials = z.infer<
  typeof GoogleServiceAccountCredentialsSchema
>

type GoogleAuthFactory = (options: {
  scopes: string[]
  credentials?: GoogleServiceAccountCredentials
}) => {
  getAccessToken: () => Promise<string | null | undefined>
}

function parseGoogleServiceAccountCredentials(
  credentialsJson: string,
  expectedProjectId: string,
): GoogleServiceAccountCredentials | null {
  if (credentialsJson.length > 65_536) return null
  try {
    const parsed = GoogleServiceAccountCredentialsSchema.safeParse(
      JSON.parse(credentialsJson),
    )
    return parsed.success &&
      parsed.data.project_id === expectedProjectId &&
      parsed.data.client_email.endsWith(
        `@${expectedProjectId}.iam.gserviceaccount.com`,
      )
      ? parsed.data
      : null
  } catch {
    return null
  }
}

const defaultGoogleAuthFactory: GoogleAuthFactory = (options) =>
  new GoogleAuth(options)

async function waitForGoogleAccessToken(
  work: Promise<string | null | undefined>,
  timeoutMs: number,
): Promise<GoogleAccessTokenResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const outcome = await Promise.race([
      work.then((accessToken) => ({ kind: "token" as const, accessToken })),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
      }),
    ])
    if (outcome.kind === "timeout") {
      return { ok: false, reason: "timeout", retryable: true }
    }
    return outcome.accessToken
      ? { ok: true, accessToken: outcome.accessToken }
      : { ok: false, reason: "config_missing", retryable: false }
  } catch {
    return { ok: false, reason: "auth_failed", retryable: false }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function isGoogleApiDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(value))
}

export async function getGoogleAccessToken(
  scopes: readonly string[],
  options: {
    accessToken?: string
    credentialsJson?: string
    expectedProjectId?: string
    timeoutMs?: number
    acquire?: (scopes: readonly string[]) => Promise<string | null | undefined>
    authFactory?: GoogleAuthFactory
  } = {},
): Promise<GoogleAccessTokenResult> {
  let config: ReturnType<typeof getSeoConfig> | undefined
  const loadConfig = () => (config ??= getSeoConfig())
  const configured = options.accessToken ?? loadConfig().googleAccessToken
  if (configured) return { ok: true, accessToken: configured }
  try {
    const timeoutMs = options.timeoutMs ?? loadConfig().timeoutMs
    if (options.acquire) {
      return await waitForGoogleAccessToken(options.acquire(scopes), timeoutMs)
    }
    const credentialsJson =
      options.credentialsJson ?? loadConfig().googleCredentialsJson
    const expectedProjectId =
      options.expectedProjectId ?? loadConfig().googleProjectId
    const sealedCredentialState = getGoogleSealedCredentialState(
      credentialsJson,
      expectedProjectId,
    )
    if (sealedCredentialState === "incomplete") {
      return { ok: false, reason: "config_missing", retryable: false }
    }
    let credentials: GoogleServiceAccountCredentials | undefined
    if (sealedCredentialState === "complete") {
      const parsedCredentials = parseGoogleServiceAccountCredentials(
        credentialsJson!,
        expectedProjectId!,
      )
      if (!parsedCredentials) {
        return { ok: false, reason: "auth_failed", retryable: false }
      }
      credentials = parsedCredentials
    }
    return await waitForGoogleAccessToken(
      (options.authFactory ?? defaultGoogleAuthFactory)({
        scopes: [...scopes],
        ...(credentials ? { credentials } : {}),
      }).getAccessToken(),
      timeoutMs,
    )
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
}): Promise<
  | { ok: true; body: unknown }
  | SeoProviderFailure
  | { ok: false; reason: "response_too_large"; retryable: true }
> {
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
    const body = await readSeoJsonResult(response, options.maxResponseBytes)
    if (!body.ok) {
      if (body.reason === "body_too_large") {
        return { ok: false, reason: "response_too_large", retryable: true }
      }
      if (body.reason === "parse_error") {
        return { ok: false, reason: "parse_error", retryable: true }
      }
      last = {
        ok: false,
        reason: body.reason === "timeout" ? "timeout" : "network_error",
        retryable: true,
      }
      if (attempt < options.maxAttempts) {
        await sleep(Math.min(250 * 2 ** (attempt - 1), 2_000))
        continue
      }
      return last
    }
    return { ok: true, body: body.body }
  }
  return last
}
