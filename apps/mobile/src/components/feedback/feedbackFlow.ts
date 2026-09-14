/**
 * The feedback sheet's state machine (KTD4) and every piece of text it derives.
 * `FeedbackSheetContent` is the only consumer; keeping the transitions, the
 * bound-to-copy map, the tag text and the disclosure rows here means a pure
 * suite can falsify them without a renderer.
 *
 * U3 owns the bounds and the wire shape. This module never re-states a bound —
 * it imports each one, so a change on admin's side reaches the inline copy.
 */
import {
  FEEDBACK_EMAIL_MAX_LENGTH,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_MESSAGE_MIN_LENGTH,
  FEEDBACK_NAME_MAX_LENGTH,
  FEEDBACK_POSITION_MAX_SECONDS,
  validateFeedbackDraft,
  type FeedbackDraft,
  type FeedbackDraftProblems,
  type FeedbackProblem,
} from "../../lib/feedbackSubmission"
import { FEEDBACK_PLATFORM_LABEL } from "../../lib/feedbackDeviceDetails"
import type {
  FeedbackDeviceDetails,
  FeedbackKind,
  FeedbackPlatform,
  FeedbackVideoContext,
} from "../../lib/feedbackQueries"

/** R4, verbatim. Straight ASCII apostrophe, matching FEEDBACK_FAILURE_MESSAGE. */
export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  BROKEN: "Something's broken",
  IDEA: "I have an idea",
  OTHER: "Something else",
}

export const FEEDBACK_PICK_KIND_HEADING = "What would you like to tell us?"
export const FEEDBACK_COMPOSE_HEADING = "Tell us more"
/** R12: a short confirmation, with no ticket id and no link. */
export const FEEDBACK_SUCCESS_MESSAGE = "Thank you. We got your feedback."

/** R12: the sheet closes on its own after this, or sooner on a tap. */
export const FEEDBACK_SUCCESS_CLOSE_MS = 1500
export const FEEDBACK_STEP_FADE_MS = 180

// ── Position and tag text (R6) ─────────────────────────────────────────────

/**
 * `h:mm:ss` once the position passes an hour, `m:ss` below it. The player's own
 * time label omits hours and renders 4324 as "72:04", so it is NOT reused here.
 */
export function formatFeedbackPosition(totalSeconds: number): string {
  const whole = Math.floor(totalSeconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const seconds = String(whole % 60).padStart(2, "0")
  if (hours === 0) return `${minutes}:${seconds}`
  return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
}

/**
 * Null on any position U3 would drop from the wire, so the tag never promises a
 * timestamp the submission leaves out.
 */
export function feedbackPositionLabel(
  positionSeconds: number | null | undefined,
): string | null {
  if (
    typeof positionSeconds !== "number" ||
    !Number.isFinite(positionSeconds)
  ) {
    return null
  }
  if (positionSeconds < 0 || positionSeconds > FEEDBACK_POSITION_MAX_SECONDS) {
    return null
  }
  return formatFeedbackPosition(positionSeconds)
}

export function feedbackTagText(video: FeedbackVideoContext): string {
  const position = feedbackPositionLabel(video.positionSeconds)
  return position
    ? `About: ${video.title} at ${position}`
    : `About: ${video.title}`
}

// ── Inline problem copy (R18) ──────────────────────────────────────────────

export type FeedbackProblemField = "message" | "name" | "email"

/** Each sentence carries the bound it enforces, read from U3's constants. */
export function feedbackProblemText(
  field: FeedbackProblemField,
  problem: FeedbackProblem,
): string {
  if (field === "message") {
    return problem === "too_short"
      ? `Please write at least ${FEEDBACK_MESSAGE_MIN_LENGTH} characters.`
      : `Please use ${FEEDBACK_MESSAGE_MAX_LENGTH} characters or fewer.`
  }
  if (field === "name") {
    return `Please use ${FEEDBACK_NAME_MAX_LENGTH} characters or fewer.`
  }
  return problem === "too_long"
    ? `Please use ${FEEDBACK_EMAIL_MAX_LENGTH} characters or fewer.`
    : "Please check this email address."
}

// ── Device-details disclosure (R9) ─────────────────────────────────────────

export type FeedbackDisclosureRow = { label: string; value: string }

/**
 * The list the disclosure renders AND the fields the submission carries, from
 * one read (AE4). The platform leads because it rides along whatever the switch
 * says; every other row depends on the switch.
 */
export function feedbackDisclosureRows(
  platform: FeedbackPlatform,
  details: FeedbackDeviceDetails,
): FeedbackDisclosureRow[] {
  return [
    { label: "Platform", value: FEEDBACK_PLATFORM_LABEL[platform] },
    { label: "App version", value: details.appVersion },
    { label: "App build", value: details.appBuild },
    { label: "OS version", value: details.osVersion },
    { label: "Device model", value: details.deviceModel },
  ]
}

export function feedbackDisclosureHint(
  rows: readonly FeedbackDisclosureRow[],
): string {
  return `This sends ${rows.map((row) => row.label).join(", ")}.`
}

// ── The machine ────────────────────────────────────────────────────────────

export type FeedbackPhase =
  | "pickKind"
  | "compose"
  | "sending"
  | "success"
  | "failed"

type FeedbackFormFields = {
  message: string
  name: string
  email: string
  includeDeviceDetails: boolean
  /** KD5: null once removed, and nothing puts it back (R6). */
  video: FeedbackVideoContext | null
  problems: FeedbackDraftProblems
}

/**
 * Step one is the only phase without a kind, so "sending without a kind" is
 * unrepresentable rather than guarded.
 */
export type FeedbackFlowState = FeedbackFormFields &
  (
    | { phase: "pickKind"; kind: FeedbackKind | null }
    | { phase: Exclude<FeedbackPhase, "pickKind">; kind: FeedbackKind }
  )

/** What a host knows when it opens the sheet. The Profile door passes none. */
export type FeedbackSheetContext = {
  kind?: FeedbackKind
  video?: FeedbackVideoContext | null
}

export function createFeedbackFlowState(
  context?: FeedbackSheetContext,
): FeedbackFlowState {
  const fields: FeedbackFormFields = {
    message: "",
    name: "",
    email: "",
    // R9: opt in, never opt out.
    includeDeviceDetails: false,
    video: context?.video ?? null,
    problems: {},
  }
  // A context without a kind still starts on step one and keeps its tag for the
  // moment the person picks one — step two cannot exist without a kind.
  return context?.kind
    ? { ...fields, phase: "compose", kind: context.kind }
    : { ...fields, phase: "pickKind", kind: null }
}

export type FeedbackFlowAction =
  | { type: "chooseKind"; kind: FeedbackKind }
  | { type: "back" }
  | { type: "editField"; field: FeedbackProblemField; value: string }
  | { type: "validateField"; field: "name" | "email" }
  | { type: "removeVideo" }
  | { type: "setIncludeDeviceDetails"; value: boolean }
  | { type: "sendBlocked"; problems: FeedbackDraftProblems }
  | { type: "sendStarted" }
  | { type: "sendSucceeded" }
  | { type: "sendFailed" }
  | { type: "edit" }

/**
 * Every case checks the phase it may run in and returns the state untouched
 * otherwise. That is what makes Back and the field edits inert while a
 * submission is in flight (R19) without a second guard at each control.
 */
export function feedbackFlowReducer(
  state: FeedbackFlowState,
  action: FeedbackFlowAction,
): FeedbackFlowState {
  switch (action.type) {
    case "chooseKind": {
      if (state.phase !== "pickKind") return state
      return { ...state, phase: "compose", kind: action.kind, problems: {} }
    }
    case "back": {
      if (state.phase !== "compose") return state
      // R5: the typed message survives the round trip; only the stale inline
      // problems from the previous Send are dropped.
      return { ...state, phase: "pickKind", problems: {} }
    }
    case "editField": {
      if (state.phase !== "compose") return state
      const problems = { ...state.problems }
      delete problems[action.field]
      const next: FeedbackFlowState = { ...state, problems }
      if (action.field === "message") next.message = action.value
      else if (action.field === "name") next.name = action.value
      else next.email = action.value
      return next
    }
    case "validateField": {
      if (state.phase !== "compose") return state
      const draft = feedbackDraftOf(state)
      if (!draft) return state
      const found = validateFeedbackDraft(draft)[action.field]
      const problems = { ...state.problems }
      if (found) problems[action.field] = found
      else delete problems[action.field]
      return { ...state, problems }
    }
    case "removeVideo": {
      if (state.phase !== "compose") return state
      return { ...state, video: null }
    }
    case "setIncludeDeviceDetails": {
      if (state.phase !== "compose") return state
      return { ...state, includeDeviceDetails: action.value }
    }
    case "sendBlocked": {
      if (state.phase !== "compose") return state
      return { ...state, problems: action.problems }
    }
    case "sendStarted": {
      if (state.phase !== "compose" && state.phase !== "failed") return state
      return { ...state, phase: "sending", problems: {} }
    }
    case "sendSucceeded": {
      if (state.phase !== "sending") return state
      return { ...state, phase: "success" }
    }
    case "sendFailed": {
      if (state.phase !== "sending") return state
      return { ...state, phase: "failed" }
    }
    case "edit": {
      if (state.phase !== "failed") return state
      return { ...state, phase: "compose" }
    }
  }
}

export function feedbackDraftOf(
  state: FeedbackFlowState,
): FeedbackDraft | null {
  if (state.kind === null) return null
  return {
    kind: state.kind,
    message: state.message,
    name: state.name,
    email: state.email,
  }
}

export type FeedbackSendDecision =
  | { status: "blocked"; problems: FeedbackDraftProblems }
  | { status: "ready"; draft: FeedbackDraft }

/**
 * KTD7/R18: the phone runs admin's own bounds before the request, so admin
 * never refuses a submission for a problem the person could have fixed.
 */
export function decideFeedbackSend(
  state: FeedbackFlowState,
): FeedbackSendDecision {
  const draft = feedbackDraftOf(state)
  if (!draft) return { status: "blocked", problems: {} }
  const problems = validateFeedbackDraft(draft)
  if (Object.keys(problems).length > 0) return { status: "blocked", problems }
  return { status: "ready", draft }
}

/** KTD11: the heading a step transition announces. Null where the step is
 *  unchanged, so sending and failure announce nothing. */
export function feedbackStepHeading(phase: FeedbackPhase): string | null {
  if (phase === "pickKind") return FEEDBACK_PICK_KIND_HEADING
  if (phase === "compose") return FEEDBACK_COMPOSE_HEADING
  return null
}
