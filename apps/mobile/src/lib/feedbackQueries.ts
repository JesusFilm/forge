/**
 * The public feedback mutation (U3) and the wire contract around it.
 * Operations live in the app, never in the client package.
 *
 * Every type below DERIVES from the generated schema types rather than being
 * hand-written (KTD10). Admin's enums are UPPERCASE on both sides; feat-335
 * ported a lowercase literal across apps with the whole suite green, so a
 * hand-typed union is the exact mistake this file avoids.
 */
import {
  type AdminResultOf,
  type AdminVariablesOf,
  adminGraphql,
} from "@forge/admin-graphql"

export const SUBMIT_FEEDBACK = adminGraphql(`
  mutation SubmitFeedback($input: FeedbackSubmissionInput!) {
    submitFeedback(input: $input) {
      accepted
      refusal
    }
  }
`)

/**
 * The fleet-bearer allowlist in `authHeaders.ts` matches on this exact string.
 * `__tests__/authHeaders.test.ts` pins it to the document above.
 */
export const SUBMIT_FEEDBACK_OPERATION_NAME = "SubmitFeedback"

type SubmitFeedbackVariables = AdminVariablesOf<typeof SUBMIT_FEEDBACK>
type SubmitFeedbackResult = AdminResultOf<typeof SUBMIT_FEEDBACK>

export type FeedbackSubmissionInput = SubmitFeedbackVariables["input"]
export type FeedbackKind = FeedbackSubmissionInput["kind"]
export type FeedbackPlatform = FeedbackSubmissionInput["platform"]
export type FeedbackVideoContext = NonNullable<FeedbackSubmissionInput["video"]>
export type FeedbackDeviceDetails = NonNullable<
  FeedbackSubmissionInput["deviceDetails"]
>
export type FeedbackSubmissionAnswer = SubmitFeedbackResult["submitFeedback"]
export type FeedbackRefusal = NonNullable<FeedbackSubmissionAnswer["refusal"]>

/**
 * Tile order for the kind step. Typed against the derived union, so a lowercase
 * or misspelled value cannot compile.
 */
export const FEEDBACK_KINDS = [
  "BROKEN",
  "IDEA",
  "OTHER",
] as const satisfies readonly FeedbackKind[]
