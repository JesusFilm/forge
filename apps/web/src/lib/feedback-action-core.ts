import "server-only"

import { createHash } from "node:crypto"

import {
  addLinearFeedbackFollowUpEmail,
  createFeedbackReceipt,
  createLinearFeedbackIssue,
  feedbackFollowUpEmailSchema,
  feedbackSubmissionSchema,
  openFeedbackReceipt,
} from "@/lib/feedback-linear"

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT_MAX_REQUESTS = 5
export const FEEDBACK_RATE_LIMIT_MAX_BUCKETS = 1024
const RATE_LIMIT_SWEEP_INTERVAL = 64

const rateLimitBuckets = new Map<string, number[]>()
let rateLimitChecks = 0

export type FeedbackActionResult =
  | { ok: true; receipt?: string }
  | {
      ok: false
      reason: "invalid" | "rate_limited" | "delivery_failed"
      message: string
    }

export type FeedbackFollowUpEmailResult =
  | { ok: true }
  | {
      ok: false
      reason: "invalid" | "delivery_failed"
      message: string
    }

type RequestHeaders = Pick<Headers, "get">

function requestFingerprint(requestHeaders: RequestHeaders): string {
  const address =
    requestHeaders.get("cf-connecting-ip") ||
    requestHeaders.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    "unknown"
  return createHash("sha256").update(address).digest("hex")
}

function sweepExpiredBuckets(now: number): void {
  for (const [key, timestamps] of rateLimitBuckets) {
    const recent = timestamps.filter(
      (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
    )
    if (recent.length === 0) rateLimitBuckets.delete(key)
    else rateLimitBuckets.set(key, recent)
  }
}

function makeBucketRoom(): void {
  while (rateLimitBuckets.size >= FEEDBACK_RATE_LIMIT_MAX_BUCKETS) {
    const oldestKey = rateLimitBuckets.keys().next().value as string | undefined
    if (!oldestKey) return
    rateLimitBuckets.delete(oldestKey)
  }
}

function isRateLimited(
  requestHeaders: RequestHeaders,
  now = Date.now(),
): boolean {
  rateLimitChecks += 1
  if (rateLimitChecks % RATE_LIMIT_SWEEP_INTERVAL === 0) {
    sweepExpiredBuckets(now)
  }

  const key = requestFingerprint(requestHeaders)
  const recent = (rateLimitBuckets.get(key) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  )
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateLimitBuckets.delete(key)
    rateLimitBuckets.set(key, recent)
    return true
  }

  if (!rateLimitBuckets.has(key)) makeBucketRoom()
  recent.push(now)
  rateLimitBuckets.delete(key)
  rateLimitBuckets.set(key, recent)
  return false
}

export function resetFeedbackRateLimitForTests(): void {
  rateLimitBuckets.clear()
  rateLimitChecks = 0
}

export function feedbackRateLimitBucketCountForTests(): number {
  return rateLimitBuckets.size
}

export async function submitFeedbackWithHeaders(
  input: unknown,
  requestHeaders: RequestHeaders,
): Promise<FeedbackActionResult> {
  if (isRateLimited(requestHeaders)) {
    return {
      ok: false,
      reason: "rate_limited",
      message: "Too many feedback requests. Please try again later.",
    }
  }

  const parsed = feedbackSubmissionSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      message: "Please check the form and try again.",
    }
  }

  // Honeypot submissions get a generic success without reaching Linear.
  if (parsed.data.website) return { ok: true }

  const result = await createLinearFeedbackIssue(parsed.data)
  if (!result.ok) {
    console.warn(
      `[feedback] event=linear_create_failed reason=${result.reason} retryable=${result.retryable}`,
    )
    return {
      ok: false,
      reason: "delivery_failed",
      message: "We could not send your feedback. Please try again.",
    }
  }

  console.info(
    `[feedback] event=linear_issue_created category=${parsed.data.category} language=${Boolean(parsed.data.languageIssue)} content=${Boolean(parsed.data.content)} diagnostics=${Boolean(parsed.data.diagnostics)} element=${Boolean(parsed.data.selectedElement)}`,
  )
  const receipt = createFeedbackReceipt(result.issueId)
  return receipt ? { ok: true, receipt } : { ok: true }
}

export async function addFeedbackFollowUpEmail(
  input: unknown,
): Promise<FeedbackFollowUpEmailResult> {
  const parsed = feedbackFollowUpEmailSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      message: "Enter a valid email address.",
    }
  }

  const issueId = openFeedbackReceipt(parsed.data.receipt)
  if (!issueId) {
    return {
      ok: false,
      reason: "invalid",
      message:
        "This follow-up link has expired. Please use the support form to contact us.",
    }
  }

  const result = await addLinearFeedbackFollowUpEmail(
    issueId,
    parsed.data.email,
  )
  if (!result.ok) {
    console.warn(
      `[feedback] event=linear_follow_up_failed reason=${result.reason} retryable=${result.retryable}`,
    )
    return {
      ok: false,
      reason: "delivery_failed",
      message:
        "We could not add your email. Please use the support form to contact us.",
    }
  }

  console.info("[feedback] event=linear_follow_up_email_added")
  return { ok: true }
}
