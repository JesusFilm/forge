/**
 * The one failure message (KD10/R13). Every refusal — rate limit, the
 * fleet-wide daily cap, a missing Linear key — and every thrown error render
 * this sentence. Admin's refusal log is where an operator tells them apart, so
 * nothing on the phone needs a second string.
 *
 * The apostrophe is a straight ASCII U+0027, matching SheetError.tsx. Only
 * `__tests__/feedbackSubmission.test.ts` pins the wording; everything else
 * compares against this constant.
 */
export const FEEDBACK_FAILURE_MESSAGE =
  "Couldn't send that. Try again in a few minutes."
