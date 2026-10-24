import { reportGoogleAnalyticsEventWhenReady } from "@/components/GoogleAnalytics"
import type { FeedbackCategory } from "@/lib/feedback"

/*
 * The feedback funnel, as GA4 events.
 *
 * The question this exists to answer is "where do people give up?", so the
 * shape is a funnel: one open event, one view event per wizard step, and one
 * terminal event (submitted / failed / abandoned). Drop-off between two
 * consecutive `feedback_step_viewed` counts is the answer; `feedback_abandoned`
 * names the step they were on when they quit.
 *
 * Emission goes through `reportGoogleAnalyticsEventWhenReady`, the same v1
 * path the
 * sibling Watch intents (`watch_download_intent`, `watch_share_opened`,
 * `watch_language_picker_opened`) use. That helper strips the `watch_` prefix,
 * so the wire names GA4 receives are the `feedback_*` names in the comments
 * below. These events are NOT yet declared in the v2 contract
 * (`watch-analytics-contract.ts`) — they migrate with their siblings, not
 * ahead of them, so a v2 build cannot end up with half this funnel.
 *
 * EVERY parameter here is a bounded enum, a small integer or a boolean. No
 * free text ever reaches this module: the category is a four-value enum, the
 * step is 1-5, and the reasons are closed unions. The message body, the
 * reporter's name, their email and the affected-language name stay in the
 * submission payload and never become analytics parameters.
 */

/**
 * The wizard's steps, in order. Doubles as the `Feedback.steps.*` message-key
 * space and the analytics `step_name`, so a rename cannot desync the label a
 * reader sees from the name the funnel reports. Lives here rather than in
 * `FeedbackModal` because `FeedbackLauncher` needs the count without pulling
 * the lazily-loaded modal chunk into its own bundle.
 */
export const FEEDBACK_STEP_KEYS = [
  "type",
  "describe",
  "context",
  "point",
  "about",
] as const

export type FeedbackStepKey = (typeof FEEDBACK_STEP_KEYS)[number]

export const FEEDBACK_STEP_COUNT = FEEDBACK_STEP_KEYS.length

/**
 * How far a reader got, published by `FeedbackModal` to `FeedbackLauncher`.
 * It lives here, not in the modal, because the launcher must read it without
 * importing anything from the lazily-loaded modal chunk.
 */
export type FeedbackProgress = {
  step: number
  category: FeedbackCategory | null
  submitted: boolean
}

/** Which affordance opened the composer. */
export type FeedbackOpenSource = "launcher" | "page_cta"

/**
 * Why the composer closed without a submission. `search_opened` is the global
 * search taking precedence — a real abandonment, but one the product caused,
 * so it is worth telling apart from a deliberate dismissal.
 */
export type FeedbackAbandonReason = "dismissed" | "search_opened"

/**
 * Terminal submission failures. Deliberately re-declared rather than derived
 * from the server action: this module is imported by the launcher, and
 * deriving would pull the action module into that bundle. The modal passes the
 * action's own typed reason straight in, so widening the server union breaks
 * THIS call site at compile time — which is the moment to decide whether the
 * new reason belongs in the funnel.
 */
export type FeedbackSubmitFailureAnalyticsReason =
  | "invalid"
  | "rate_limited"
  | "client_timeout"
  | "delivery_failed"
  | "exception"

/**
 * Validation keys that can hold someone on a step. `name` is deliberately
 * absent: the name field no longer blocks submission, so a `name` value here
 * would be a dimension that can never appear.
 */
export type FeedbackBlockedField = "category" | "message" | "email"

function stepName(step: number): FeedbackStepKey {
  return FEEDBACK_STEP_KEYS[step - 1] ?? FEEDBACK_STEP_KEYS[0]
}

/** `feedback_opened` — the launcher (or a page CTA) opened the composer. */
export function reportFeedbackOpened(input: {
  source: FeedbackOpenSource
}): void {
  reportGoogleAnalyticsEventWhenReady("watch_feedback_opened", {
    // `open_source`, not `source` — GA4 already means something by `source`
    // in its traffic-acquisition dimensions, and a same-named event parameter
    // reads as that in reports.
    open_source: input.source,
  })
}

/**
 * `feedback_step_viewed` — a wizard step became visible. One per arrival, so
 * stepping back and forward counts both views; the funnel is about how far
 * people get, and a re-view is a real one.
 */
export function reportFeedbackStepViewed(input: {
  step: number
  category: FeedbackCategory | null
}): void {
  reportGoogleAnalyticsEventWhenReady("watch_feedback_step_viewed", {
    step: input.step,
    step_name: stepName(input.step),
    ...(input.category ? { category: input.category } : {}),
  })
}

/**
 * `feedback_step_blocked` — validation refused to advance. This is the
 * difference between "they lost interest on step 2" and "step 2 would not let
 * them through", which the view counts alone cannot tell apart.
 *
 * `fields` is sorted and joined so the two-error case on the last step is one
 * stable value (`email_name`) rather than two orderings of the same thing.
 */
export function reportFeedbackStepBlocked(input: {
  step: number
  fields: readonly FeedbackBlockedField[]
}): void {
  if (input.fields.length === 0) return
  reportGoogleAnalyticsEventWhenReady("watch_feedback_step_blocked", {
    step: input.step,
    step_name: stepName(input.step),
    reason: [...input.fields].sort().join("_"),
  })
}

/**
 * `feedback_submitted` — the terminal success. The `has_*` booleans record
 * which optional sections people actually fill in, without carrying any of
 * their contents.
 */
export function reportFeedbackSubmitted(input: {
  category: FeedbackCategory
  hasName: boolean
  hasEmail: boolean
  hasLanguageIssue: boolean
  hasContent: boolean
  hasSelectedElement: boolean
  hasDiagnostics: boolean
}): void {
  reportGoogleAnalyticsEventWhenReady("watch_feedback_submitted", {
    category: input.category,
    // The name became optional in the same change that added this funnel, so
    // "do people still give one?" is the question it most needs to answer.
    has_name: input.hasName,
    has_email: input.hasEmail,
    has_language_issue: input.hasLanguageIssue,
    has_content: input.hasContent,
    has_selected_element: input.hasSelectedElement,
    has_diagnostics: input.hasDiagnostics,
  })
}

/**
 * `feedback_submit_failed` — they finished the form and the send did not land.
 * Separate from abandonment on purpose: this is lost feedback that someone
 * already wrote, which is a different (and worse) problem.
 */
export function reportFeedbackSubmitFailed(input: {
  category: FeedbackCategory | null
  reason: FeedbackSubmitFailureAnalyticsReason
}): void {
  reportGoogleAnalyticsEventWhenReady("watch_feedback_submit_failed", {
    reason: input.reason,
    ...(input.category ? { category: input.category } : {}),
  })
}

/**
 * `feedback_abandoned` — closed without a submission, naming the step they
 * were on. Not emitted when someone navigates away or closes the tab with the
 * composer open: that case shows up as a `feedback_opened` with no terminal
 * event, and the per-step view counts still carry the drop-off curve.
 */
export function reportFeedbackAbandoned(input: {
  step: number
  category: FeedbackCategory | null
  reason: FeedbackAbandonReason
}): void {
  reportGoogleAnalyticsEventWhenReady("watch_feedback_abandoned", {
    step: input.step,
    step_name: stepName(input.step),
    reason: input.reason,
    ...(input.category ? { category: input.category } : {}),
  })
}
