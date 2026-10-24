import { env } from "@/config/env"

export type ManagerClientErrorKind =
  | "network"
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "unexpected"

export class ManagerClientError extends Error {
  constructor(
    message: string,
    public readonly kind: ManagerClientErrorKind,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = "ManagerClientError"
  }
}

export type ExchangeLaunchCodeInput = {
  jobId: string
  launchCode: string
  fetchImpl?: typeof fetch
}

export type ExchangeLaunchCodeResult = {
  editSessionToken: string
  expiresAt: string
}

type ManagerExchangeLaunchCodeResponse = {
  editToken?: string
  editSessionToken?: string
  expiresAt: string
}

export type BootstrapReviewSessionInput = {
  jobId: string
  editSessionToken: string
  fetchImpl?: typeof fetch
}

export type BootstrapReviewSessionResult = {
  jobId: string
  sourceArtifactKey: string
  baseArtifactKey: string | null
  targetLanguage: string
  muxPlaybackId: string | null
  mediaUrl: string | null
  vtt: string
  baseArtifactFingerprint: string
}

type ManagerBootstrapReviewSessionResponse = {
  jobId: string
  sourceArtifactKey: string
  baseArtifactKey?: string | null
  targetLanguage: string
  media?: {
    muxPlaybackId?: string | null
    muxAssetId?: string | null
  }
  muxPlaybackId?: string | null
  mediaUrl?: string | null
  vtt: string
  baseFingerprint?: string
  baseArtifactFingerprint?: string
}

export type SaveReviewedVttInput = {
  jobId: string
  editSessionToken: string
  vtt: string
  baseArtifactFingerprint: string
  clientSaveId: string
  fetchImpl?: typeof fetch
}

export type SaveReviewedVttResult = {
  jobId: string
  revision: number
  reviewedArtifactKey: string
  contentFingerprint: string
  baseArtifactFingerprint: string
  savedAt: string
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function buildManagerUrl(pathname: string): string {
  return new URL(
    pathname,
    `${trimTrailingSlash(env.NEXT_PUBLIC_MANAGER_BASE_URL)}/`,
  ).toString()
}

function normalizeMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) {
    return body
  }

  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>
    const value = record.error ?? record.message
    if (typeof value === "string" && value.trim()) {
      return value
    }
  }

  return fallback
}

function mapStatusKind(status: number): ManagerClientErrorKind {
  if (status === 400) return "bad_request"
  if (status === 401) return "unauthorized"
  if (status === 403) return "forbidden"
  if (status === 404) return "not_found"
  if (status === 409) return "conflict"
  if (status === 422) return "validation"
  if (status === 429) return "rate_limited"
  return "unexpected"
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    return response.json()
  }

  const text = await response.text()
  return text.trim() ? text : null
}

async function requestJson<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  try {
    const response = await fetchImpl(input, {
      cache: "no-store",
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    })

    if (!response.ok) {
      const body = await readResponseBody(response)
      throw new ManagerClientError(
        normalizeMessage(
          body,
          `Manager request failed with ${response.status}`,
        ),
        mapStatusKind(response.status),
        response.status,
        body,
      )
    }

    return (await response.json()) as T
  } catch (error) {
    if (error instanceof ManagerClientError) {
      throw error
    }

    throw new ManagerClientError(
      "Manager request failed",
      "network",
      undefined,
      error,
    )
  }
}

export async function exchangeLaunchCode({
  jobId,
  launchCode,
  fetchImpl = fetch,
}: ExchangeLaunchCodeInput): Promise<ExchangeLaunchCodeResult> {
  const response = await requestJson<ManagerExchangeLaunchCodeResponse>(
    buildManagerUrl(
      `/api/jobs/${encodeURIComponent(jobId)}/subtitle-reviews/session/exchange`,
    ),
    {
      method: "POST",
      body: JSON.stringify({ launchCode }),
    },
    fetchImpl,
  )
  const editSessionToken = response.editSessionToken ?? response.editToken
  if (!editSessionToken) {
    throw new ManagerClientError(
      "Manager exchange response did not include an edit token",
      "unexpected",
    )
  }

  return {
    editSessionToken,
    expiresAt: response.expiresAt,
  }
}

export async function bootstrapReviewSession({
  jobId,
  editSessionToken,
  fetchImpl = fetch,
}: BootstrapReviewSessionInput): Promise<BootstrapReviewSessionResult> {
  const response = await requestJson<ManagerBootstrapReviewSessionResponse>(
    buildManagerUrl(
      `/api/jobs/${encodeURIComponent(jobId)}/subtitle-reviews/session/bootstrap`,
    ),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${editSessionToken}`,
      },
    },
    fetchImpl,
  )
  const muxPlaybackId =
    response.muxPlaybackId ?? response.media?.muxPlaybackId ?? null
  const baseArtifactFingerprint =
    response.baseArtifactFingerprint ?? response.baseFingerprint
  if (!baseArtifactFingerprint) {
    throw new ManagerClientError(
      "Manager bootstrap response did not include a base fingerprint",
      "unexpected",
    )
  }

  return {
    jobId: response.jobId,
    sourceArtifactKey: response.sourceArtifactKey,
    baseArtifactKey: response.baseArtifactKey ?? null,
    targetLanguage: response.targetLanguage,
    muxPlaybackId,
    mediaUrl:
      response.mediaUrl ??
      (muxPlaybackId
        ? `https://player.mux.com/${encodeURIComponent(muxPlaybackId)}`
        : null),
    vtt: response.vtt,
    baseArtifactFingerprint,
  }
}

export async function saveReviewedVtt({
  jobId,
  editSessionToken,
  vtt,
  baseArtifactFingerprint,
  clientSaveId,
  fetchImpl = fetch,
}: SaveReviewedVttInput): Promise<SaveReviewedVttResult> {
  return requestJson<SaveReviewedVttResult>(
    buildManagerUrl(
      `/api/jobs/${encodeURIComponent(jobId)}/subtitle-reviews/revisions`,
    ),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${editSessionToken}`,
      },
      body: JSON.stringify({
        vtt,
        baseArtifactFingerprint,
        clientSaveId,
      }),
    },
    fetchImpl,
  )
}
