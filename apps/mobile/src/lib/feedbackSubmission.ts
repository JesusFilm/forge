/**
 * The feedback submission model: admin's bounds, the pre-Send check, the
 * per-draft id, the wire input, and the one outcome the sheet renders.
 *
 * KTD7 — every bound here MIRRORS `apps/admin/src/graphql/mutations/feedback.ts`
 * (`submissionSchema`). Both sides run the same zod major, so the phone refuses
 * first and admin never answers INVALID_INPUT for a problem the person could
 * fix (R18). Change one side and you must change the other.
 */
import { z } from "zod"

import { getApolloClient } from "./apolloClient"
import { FEEDBACK_FAILURE_MESSAGE } from "./feedbackCopy"
import {
  SUBMIT_FEEDBACK,
  type FeedbackDeviceDetails,
  type FeedbackKind,
  type FeedbackPlatform,
  type FeedbackRefusal,
  type FeedbackSubmissionAnswer,
  type FeedbackSubmissionInput,
  type FeedbackVideoContext,
} from "./feedbackQueries"
import { randomUUIDCompat } from "./viewer-id"

export const FEEDBACK_MESSAGE_MIN_LENGTH = 10
export const FEEDBACK_MESSAGE_MAX_LENGTH = 1000
export const FEEDBACK_NAME_MAX_LENGTH = 100
export const FEEDBACK_EMAIL_MAX_LENGTH = 254
export const FEEDBACK_VIDEO_TITLE_MAX_LENGTH = 200
export const FEEDBACK_DEVICE_FIELD_MAX_LENGTH = 100
export const FEEDBACK_POSITION_MAX_SECONDS = 1_000_000

/** Mirrors admin's SLUG: a bounded charset, not an exact slug shape. */
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u

const emailSchema = z.email().max(FEEDBACK_EMAIL_MAX_LENGTH)

/** What the person typed. The kind comes from the step-one tiles. */
export type FeedbackDraft = {
  kind: FeedbackKind
  message: string
  name: string
  email: string
}

export type FeedbackProblem = "too_short" | "too_long" | "invalid_email"

/** One problem per field, for the inline treatment (R18). Empty means valid. */
export type FeedbackDraftProblems = {
  message?: FeedbackProblem
  name?: FeedbackProblem
  email?: FeedbackProblem
}

export function validateFeedbackDraft(
  draft: FeedbackDraft,
): FeedbackDraftProblems {
  const problems: FeedbackDraftProblems = {}

  const message = draft.message.trim()
  if (message.length < FEEDBACK_MESSAGE_MIN_LENGTH) {
    problems.message = "too_short"
  } else if (message.length > FEEDBACK_MESSAGE_MAX_LENGTH) {
    problems.message = "too_long"
  }

  // R7/KD4: contact is optional, so a blank field is an ABSENT field, not a
  // problem. Admin bounds both at min(1) and would refuse an empty string.
  const name = draft.name.trim()
  if (name.length > FEEDBACK_NAME_MAX_LENGTH) problems.name = "too_long"

  const email = draft.email.trim()
  if (email.length > 0 && !emailSchema.safeParse(email).success) {
    problems.email =
      email.length > FEEDBACK_EMAIL_MAX_LENGTH ? "too_long" : "invalid_email"
  }

  return problems
}

function clamped(value: string, max: number): string {
  return value.trim().slice(0, max)
}

/** Truncate what is READ, drop what is FOLLOWED: a clipped title still reads,
 * but a clipped slug points at nothing and admin would refuse the whole
 * submission over a field the person never typed. */
function safeSlug(value: string | null | undefined): string | undefined {
  const slug = value?.trim()
  if (!slug || !SLUG_PATTERN.test(slug)) return undefined
  return slug
}

function safePosition(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  if (value < 0 || value > FEEDBACK_POSITION_MAX_SECONDS) return undefined
  return value
}

function safeVideo(
  video: FeedbackVideoContext | null | undefined,
): FeedbackVideoContext | undefined {
  if (!video) return undefined
  const title = clamped(video.title ?? "", FEEDBACK_VIDEO_TITLE_MAX_LENGTH)
  // Admin bounds the title at min(1), so a titleless tag would refuse the
  // whole submission. Losing the tag is better than losing the message.
  if (!title) return undefined

  const positionSeconds = safePosition(video.positionSeconds)
  const slug = safeSlug(video.slug)
  const languageSlug = safeSlug(video.languageSlug)
  return {
    title,
    ...(positionSeconds != null ? { positionSeconds } : {}),
    ...(slug != null ? { slug } : {}),
    ...(languageSlug != null ? { languageSlug } : {}),
  }
}

function safeDeviceDetails(
  details: FeedbackDeviceDetails | null | undefined,
): FeedbackDeviceDetails | undefined {
  if (!details) return undefined
  return {
    appVersion: clamped(details.appVersion, FEEDBACK_DEVICE_FIELD_MAX_LENGTH),
    appBuild: clamped(details.appBuild, FEEDBACK_DEVICE_FIELD_MAX_LENGTH),
    osVersion: clamped(details.osVersion, FEEDBACK_DEVICE_FIELD_MAX_LENGTH),
    deviceModel: clamped(details.deviceModel, FEEDBACK_DEVICE_FIELD_MAX_LENGTH),
  }
}

export type FeedbackSubmissionArgs = {
  draft: FeedbackDraft
  platform: FeedbackPlatform
  /** R9: present only while the opt-in switch is on. */
  deviceDetails?: FeedbackDeviceDetails | null
  /** KD5: present only while the person keeps the tag. */
  video?: FeedbackVideoContext | null
}

/** R8: carries only what the person typed, tagged, or switched on. Nothing
 * is read from the account, so an empty optional is OMITTED, not sent blank. */
export function buildFeedbackSubmissionInput(
  args: FeedbackSubmissionArgs & { submissionId: string },
): FeedbackSubmissionInput {
  const { draft } = args
  const name = clamped(draft.name, FEEDBACK_NAME_MAX_LENGTH)
  const email = clamped(draft.email, FEEDBACK_EMAIL_MAX_LENGTH)
  const video = safeVideo(args.video)
  const deviceDetails = safeDeviceDetails(args.deviceDetails)

  return {
    submissionId: args.submissionId,
    kind: draft.kind,
    platform: args.platform,
    message: clamped(draft.message, FEEDBACK_MESSAGE_MAX_LENGTH),
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(video ? { video } : {}),
    ...(deviceDetails ? { deviceDetails } : {}),
  }
}

/** One outcome, two states. `refusal` rides along for a future reader and
 * NEVER selects different text (KD10); admin's refusal log is its sink (KTD9). */
export type FeedbackOutcome =
  | { status: "accepted" }
  | {
      status: "failed"
      refusal: FeedbackRefusal | null
      message: string
    }

function failed(refusal: FeedbackRefusal | null): FeedbackOutcome {
  return { status: "failed", refusal, message: FEEDBACK_FAILURE_MESSAGE }
}

export function classifyFeedbackResult(
  answer: FeedbackSubmissionAnswer | null | undefined,
): FeedbackOutcome {
  if (answer?.accepted === true) return { status: "accepted" }
  return failed(answer?.refusal ?? null)
}

/** Resolves on EVERY path: U4 has one failure branch, so a rejection would
 * escape it (R13). A refusal is data on HTTP 200 and never reaches the
 * ErrorLink; a real fault throws and files its RUM error before this catch (KTD9). */
export async function sendFeedback(
  input: FeedbackSubmissionInput,
): Promise<FeedbackOutcome> {
  try {
    const result = await getApolloClient().mutate({
      mutation: SUBMIT_FEEDBACK,
      variables: { input },
      // A submission ack has nothing to normalize into the long-lived cache.
      fetchPolicy: "no-cache",
    })
    return classifyFeedbackResult(result.data?.submitFeedback)
  } catch {
    return failed(null)
  }
}

/** One draft, one id (KTD8). The sheet creates this on open and every Retry
 * reuses it, so a duplicate ticket is VISIBLE rather than silent; there is no
 * server-side dedupe behind it (KD9). */
export type FeedbackSubmissionModel = {
  readonly submissionId: string
  buildInput(args: FeedbackSubmissionArgs): FeedbackSubmissionInput
  send(args: FeedbackSubmissionArgs): Promise<FeedbackOutcome>
}

export function createFeedbackSubmission(): FeedbackSubmissionModel {
  const submissionId = randomUUIDCompat()
  const buildInput = (args: FeedbackSubmissionArgs) =>
    buildFeedbackSubmissionInput({ ...args, submissionId })
  return {
    submissionId,
    buildInput,
    send: (args) => sendFeedback(buildInput(args)),
  }
}
