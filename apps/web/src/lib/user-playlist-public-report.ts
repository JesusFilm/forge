import "server-only"

import { createHash } from "node:crypto"

import { authorizeUserPlaylistActionRequest } from "./user-playlist-action-security"
import {
  USER_PLAYLIST_REPORT_CATEGORIES,
  type UserPlaylistReportCategory,
} from "./user-playlist-public-contract"
import {
  signedPublicUserPlaylistContext,
  trustedPublicUserPlaylistContext,
} from "./user-playlist-public-boundary"
import { REPORT_USER_PLAYLIST_MUTATION_SOURCE } from "./user-playlist-public-operations"
import { consumePublicUserPlaylistIngress } from "./user-playlist-public-rate-limit"

export type PublicUserPlaylistReportInput = {
  reportIntent: string
  category: UserPlaylistReportCategory
  detail: string
}

export type PublicUserPlaylistReportActionResult =
  | { ok: true }
  | { ok: false; retryable: true }

function validInput(value: unknown): value is PublicUserPlaylistReportInput {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false
  }
  const input = value as Record<string, unknown>
  return (
    Object.keys(input).every((key) =>
      ["reportIntent", "category", "detail"].includes(key),
    ) &&
    typeof input.reportIntent === "string" &&
    input.reportIntent.length >= 1 &&
    input.reportIntent.length <= 1_024 &&
    typeof input.category === "string" &&
    USER_PLAYLIST_REPORT_CATEGORIES.includes(
      input.category as UserPlaylistReportCategory,
    ) &&
    typeof input.detail === "string" &&
    input.detail.length <= 1_000
  )
}

function allowedOrigins(): string[] {
  return [
    process.env.WEB_BASE_URL,
    process.env.NEXT_PUBLIC_CANONICAL_ORIGIN,
    process.env.NODE_ENV === "production"
      ? "https://www.jesusfilm.org"
      : "http://localhost:3000",
  ].filter((value): value is string => Boolean(value))
}

/**
 * Public report submissions carry only the short-lived report intent; the
 * share capability never enters the action payload. Every admitted response
 * from Admin is intentionally collapsed to the same terminal result.
 */
export async function submitPublicUserPlaylistReportRequest(input: {
  data: unknown
  requestHeaders: Headers
}): Promise<PublicUserPlaylistReportActionResult> {
  if (!validInput(input.data)) return { ok: true }
  const admission = authorizeUserPlaylistActionRequest(input.requestHeaders, {
    allowedOrigins: allowedOrigins(),
  })
  if (!admission.ok) return { ok: true }

  const now = new Date()
  const context = trustedPublicUserPlaylistContext(input.requestHeaders)
  const ingress = await consumePublicUserPlaylistIngress({
    action: "report",
    capabilityDigest: createHash("sha256")
      .update(input.data.reportIntent, "utf8")
      .digest("base64url"),
    viewerIp: context.viewerIp,
    now,
  })
  if (ingress === "limited") return { ok: true }
  if (ingress !== "admitted") return { ok: false, retryable: true }

  const adminGraphqlUrl = process.env.ADMIN_GRAPHQL_URL
  const consumerBearer = process.env.WEB_ADMIN_API_KEYS?.split(",")[0]?.trim()
  const secret = process.env.USER_PLAYLIST_TRUSTED_CONTEXT_HMAC_SECRET
  if (
    !adminGraphqlUrl ||
    !consumerBearer ||
    !secret ||
    Buffer.byteLength(secret, "utf8") < 32
  ) {
    return { ok: false, retryable: true }
  }

  try {
    const response = await fetch(adminGraphqlUrl, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${consumerBearer}`,
        ...signedPublicUserPlaylistContext(context, { secret, now }),
      },
      body: JSON.stringify({
        operationName: "ReportPublicUserPlaylist",
        query: REPORT_USER_PLAYLIST_MUTATION_SOURCE,
        variables: {
          input: {
            reportIntent: input.data.reportIntent,
            category: input.data.category,
            ...(input.data.detail ? { detail: input.data.detail } : {}),
          },
        },
      }),
    })
    return response.status >= 500
      ? { ok: false, retryable: true }
      : { ok: true }
  } catch {
    return { ok: false, retryable: true }
  }
}
