/**
 * Mobile in-app feedback to Linear (U1, KTD2).
 *
 * Ported from web's `apps/web/src/lib/feedback-linear.ts`: same endpoint, same
 * `issueCreate` mutation, same 6-second budget, same 64 KB response cap.
 *
 * Contract guarantees:
 *   - NEVER throws. Every transport, auth, and config failure returns a typed
 *     `failed` outcome. The resolver maps that outcome onto its refusal enum.
 *   - Silent refusal when the API key or the team id is unset. Admin runs in
 *     environments with no Linear configuration and every other operation must
 *     keep working (R15).
 *   - The payload carries no `priority` and no `assigneeId` field at all, so
 *     this service cannot set either one (R16).
 */

import { z } from "zod"

import { env } from "@/config/env"
import {
  safeFeedbackText,
  safeFeedbackTitleText,
  truncateWithoutSurrogateSplit,
} from "@/services/feedback-text"

export type FeedbackKind = "BROKEN" | "IDEA" | "OTHER"
export type FeedbackPlatform = "IOS" | "ANDROID"

export type FeedbackVideoContext = {
  title: string
  /** Absent while casting: the cast target may not report a position. */
  positionSeconds?: number
  slug?: string
  languageSlug?: string
}

export type FeedbackDeviceDetails = {
  appVersion: string
  appBuild: string
  osVersion: string
  deviceModel: string
}

export type MobileFeedbackSubmission = {
  submissionId: string
  kind: FeedbackKind
  message: string
  platform: FeedbackPlatform
  name?: string
  email?: string
  video?: FeedbackVideoContext
  deviceDetails?: FeedbackDeviceDetails
}

export type FeedbackLinearFailureReason =
  | "config_missing"
  | "timeout"
  | "network_error"
  | "rate_limited"
  | "rejected"
  | "invalid_response"

export type FeedbackLinearOutcome =
  | { status: "created"; issueId: string }
  | {
      status: "failed"
      reason: FeedbackLinearFailureReason
      retryable: boolean
    }

const LINEAR_ENDPOINT = "https://api.linear.app/graphql"
const LINEAR_TIMEOUT_MS = 6_000
const LINEAR_RESPONSE_MAX_BYTES = 64 * 1024
const TITLE_MAX_CHARS = 120

/**
 * KTD10. The short name goes in the title, the label goes in the description.
 * The label is the sentence the person read on the phone.
 */
const FEEDBACK_KIND_COPY: Record<
  FeedbackKind,
  { short: string; label: string }
> = {
  BROKEN: { short: "Problem", label: "Something's broken" },
  IDEA: { short: "Idea", label: "I have an idea" },
  OTHER: { short: "Other", label: "Something else" },
}

const PLATFORM_LABEL: Record<FeedbackPlatform, string> = {
  IOS: "iOS",
  ANDROID: "Android",
}

const linearResponseSchema = z.object({
  data: z
    .object({
      issueCreate: z.object({
        success: z.boolean(),
        issue: z.object({ id: z.string().min(1) }).nullable(),
      }),
    })
    .optional(),
  errors: z.array(z.object({ message: z.string().optional() })).optional(),
})

export function buildFeedbackIssueTitle(
  submission: MobileFeedbackSubmission,
): string {
  const subject = safeFeedbackTitleText(submission.message) || "Feedback"
  const short = FEEDBACK_KIND_COPY[submission.kind].short
  return truncateWithoutSurrogateSplit(
    `[Mobile feedback] ${short}: ${subject}`,
    TITLE_MAX_CHARS,
  )
}

/** `H:MM:SS` past an hour, `M:SS` below it. Undefined when unreportable. */
function formatPosition(seconds: number | undefined): string | undefined {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
    return undefined
  }
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = total % 60
  const paddedSeconds = String(remainder).padStart(2, "0")
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`
}

/**
 * R17's order: the message, the context list, then the source line. A content
 * field appears only when the submission carries it, so removing the video tag
 * or leaving device details off removes the lines with it.
 */
export function buildFeedbackIssueDescription(
  submission: MobileFeedbackSubmission,
): string {
  const lines = [
    "## Feedback",
    "",
    safeFeedbackText(submission.message),
    "",
    "## Context",
    "",
    `- **Kind:** ${FEEDBACK_KIND_COPY[submission.kind].label}`,
  ]

  if (submission.name) {
    lines.push(`- **Name:** ${safeFeedbackText(submission.name)}`)
  }
  if (submission.email) {
    lines.push(`- **Email:** ${safeFeedbackText(submission.email)}`)
  }

  const video = submission.video
  if (video) {
    lines.push(`- **Video:** ${safeFeedbackText(video.title)}`)
    const position = formatPosition(video.positionSeconds)
    if (position) lines.push(`- **Position:** ${position}`)
    if (video.slug) {
      lines.push(`- **Video slug:** ${safeFeedbackText(video.slug)}`)
    }
    if (video.languageSlug) {
      lines.push(`- **Dub language:** ${safeFeedbackText(video.languageSlug)}`)
    }
  }

  lines.push(`- **Platform:** ${PLATFORM_LABEL[submission.platform]}`)

  const device = submission.deviceDetails
  if (device) {
    lines.push(
      `- **App version:** ${safeFeedbackText(device.appVersion)}`,
      `- **App build:** ${safeFeedbackText(device.appBuild)}`,
      `- **OS version:** ${safeFeedbackText(device.osVersion)}`,
      `- **Device model:** ${safeFeedbackText(device.deviceModel)}`,
    )
  }

  lines.push(
    `- **Submission id:** ${safeFeedbackText(submission.submissionId)}`,
    "",
    "---",
    "Submitted from the Jesus Film mobile app.",
  )
  return lines.join("\n")
}

/**
 * Read the body through a byte counter and abort the socket past the cap.
 * `Content-Length` is not trusted. Over-cap returns `undefined`, which the
 * caller maps onto its existing `invalid_response` path.
 */
async function readJsonCapped(response: Response): Promise<unknown> {
  if (!response.body) return undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > LINEAR_RESPONSE_MAX_BYTES) {
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }
  } catch {
    // Never log the caught error: a parse failure can embed body fragments.
    return undefined
  } finally {
    reader?.releaseLock()
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged))
  } catch {
    return undefined
  }
}

export async function createLinearFeedbackIssue(
  submission: MobileFeedbackSubmission,
  fetchImpl: typeof fetch = fetch,
): Promise<FeedbackLinearOutcome> {
  const startedAt = Date.now()
  const apiKey = env.ADMIN_FEEDBACK_LINEAR_API_KEY
  const teamId = env.ADMIN_FEEDBACK_LINEAR_TEAM_ID
  if (!apiKey || !teamId) {
    return settle(
      submission,
      { status: "failed", reason: "config_missing", retryable: false },
      undefined,
      startedAt,
    )
  }

  try {
    // Inside the try on purpose: the builders index FEEDBACK_KIND_COPY, so an
    // unvalidated kind would throw past the never-throws boundary above.
    const input = {
      teamId,
      title: buildFeedbackIssueTitle(submission),
      description: buildFeedbackIssueDescription(submission),
      ...(env.ADMIN_FEEDBACK_LINEAR_PROJECT_ID
        ? { projectId: env.ADMIN_FEEDBACK_LINEAR_PROJECT_ID }
        : {}),
      ...(env.ADMIN_FEEDBACK_LINEAR_LABEL_ID
        ? { labelIds: [env.ADMIN_FEEDBACK_LINEAR_LABEL_ID] }
        : {}),
    }

    const response = await fetchImpl(LINEAR_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: apiKey,
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "forge-admin-mobile-feedback/1.0",
      },
      redirect: "error",
      signal: AbortSignal.timeout(LINEAR_TIMEOUT_MS),
      body: JSON.stringify({
        query: `mutation CreateMobileFeedback($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue { id }
          }
        }`,
        variables: { input },
      }),
    })

    if (!response.ok) {
      await response.body?.cancel()
      return settle(
        submission,
        {
          status: "failed",
          reason: response.status === 429 ? "rate_limited" : "rejected",
          retryable: response.status === 429 || response.status >= 500,
        },
        response.status,
        startedAt,
      )
    }

    const parsed = linearResponseSchema.safeParse(
      await readJsonCapped(response),
    )
    if (
      !parsed.success ||
      parsed.data.errors?.length ||
      !parsed.data.data?.issueCreate.success ||
      !parsed.data.data.issueCreate.issue
    ) {
      return settle(
        submission,
        { status: "failed", reason: "invalid_response", retryable: false },
        response.status,
        startedAt,
      )
    }
    return settle(
      submission,
      { status: "created", issueId: parsed.data.data.issueCreate.issue.id },
      response.status,
      startedAt,
    )
  } catch (error) {
    const name = (error as { name?: string } | undefined)?.name
    return settle(
      submission,
      {
        status: "failed",
        reason:
          name === "TimeoutError" || name === "AbortError"
            ? "timeout"
            : "network_error",
        retryable: true,
      },
      undefined,
      startedAt,
    )
  }
}

/** A submission id is client-supplied, so keep it from forging a log line. */
function logSafeId(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]/gu, "").slice(0, 64)
  return safe || "unknown"
}

/**
 * Plain-string `key=value` logging. Railway logsV2 silently drops
 * JSON-stringified payloads from a Next.js runtime route handler, and this
 * line is how an operator tells a refusal apart from a real fault. It carries
 * no free text: never the message, the name, or the email.
 */
function settle(
  submission: MobileFeedbackSubmission,
  outcome: FeedbackLinearOutcome,
  httpStatus: number | undefined,
  startedAt: number,
): FeedbackLinearOutcome {
  const base =
    `submission_id=${logSafeId(submission.submissionId)} ` +
    `kind=${submission.kind} platform=${submission.platform}`
  const tail = `status=${httpStatus ?? "none"} duration_ms=${Date.now() - startedAt}`
  if (outcome.status === "created") {
    console.log(`[feedback] event=linear_created ${base} ${tail}`)
  } else {
    console.warn(
      `[feedback] event=linear_failed ${base} reason=${outcome.reason} ${tail}`,
    )
  }
  return outcome
}
