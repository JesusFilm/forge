/**
 * The three mobile-feedback limits (U2, KTD3).
 *
 * Every one answers as DATA through the resolver, never as a thrown fault:
 * the phone renders one message for all refusals (KD10), so the refusal value
 * on the wire and admin's log line are what keep them apart for operators.
 *
 * SECURITY: `installIdentity` carries the raw fleet bearer key (it comes from
 * `identifyForRateLimit`). It is a bucket label only — never log it.
 */

import { incrementFixedWindow } from "@/auth/rate-limit"
import { env } from "@/config/env"

/** Per install: the bound a person can feel. R14. */
export const FEEDBACK_INSTALL_LIMIT = 5
export const FEEDBACK_INSTALL_WINDOW_MS = 10 * 60_000

/** Per trusted address: bounds a client that relaunches or rotates its
 * spoofable `x-viewer-id`, which mints a fresh install bucket each time. */
export const FEEDBACK_ADDRESS_LIMIT = 20
export const FEEDBACK_ADDRESS_WINDOW_MS = 60 * 60_000

/** The key carries the UTC date, so the counter resets at midnight UTC. */
export const FEEDBACK_DAILY_WINDOW_MS = 24 * 60 * 60_000

/** Mirrors the zod default on `ADMIN_FEEDBACK_DAILY_CAP`. */
export const FEEDBACK_DAILY_CAP_DEFAULT = 200

/** `env` skips zod validation, and so zod DEFAULTS, whenever `CI` is set: the
 * declared 200 is absent exactly where the type says it is a number. Read the
 * cap through here, never straight off `env`. */
export function feedbackDailyCap(): number {
  const raw = Number(env.ADMIN_FEEDBACK_DAILY_CAP)
  return Number.isInteger(raw) && raw >= 0 ? raw : FEEDBACK_DAILY_CAP_DEFAULT
}

export type FeedbackLimitScope = "install" | "address" | "daily"

export type FeedbackLimitDecision =
  | { allowed: true }
  | {
      allowed: false
      scope: FeedbackLimitScope
      refusal: "RATE_LIMITED" | "DAILY_CAP"
    }

/** `YYYY-MM-DD` in UTC. */
export function feedbackDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/** Debits the three counters in order and stops at the first refusal:
 * debiting the fleet's day for a call the install limit already refused would
 * let one install spend the whole cap. */
export async function checkFeedbackLimits({
  installIdentity,
  clientIp,
  now = Date.now(),
}: {
  installIdentity: string
  clientIp: string
  now?: number
}): Promise<FeedbackLimitDecision> {
  const install = await incrementFixedWindow(
    `feedback-install:${installIdentity}`,
    FEEDBACK_INSTALL_LIMIT,
    FEEDBACK_INSTALL_WINDOW_MS,
  )
  if (!install.allowed) {
    return { allowed: false, scope: "install", refusal: "RATE_LIMITED" }
  }

  const address = await incrementFixedWindow(
    `feedback-address:${clientIp}`,
    FEEDBACK_ADDRESS_LIMIT,
    FEEDBACK_ADDRESS_WINDOW_MS,
  )
  if (!address.allowed) {
    return { allowed: false, scope: "address", refusal: "RATE_LIMITED" }
  }

  // A cap of 0 refuses the first call of the day and is the operator's kill
  // switch. It never means unlimited — the opposite of the search ceiling.
  const daily = await incrementFixedWindow(
    `feedback-daily:${feedbackDayKey(now)}`,
    feedbackDailyCap(),
    FEEDBACK_DAILY_WINDOW_MS,
  )
  if (!daily.allowed) {
    return { allowed: false, scope: "daily", refusal: "DAILY_CAP" }
  }

  return { allowed: true }
}
