import type {
  PromoteSearchEvalCandidateInput,
  SearchEvalCandidateDecisionInput,
} from "@/services/search-eval-candidates"

import { badRequest } from "../review-route-helpers"

function stringOrNullish(
  value: unknown,
  name: string,
): string | null | undefined | Response {
  if (value == null) return value as null | undefined
  if (typeof value === "string") return value
  return badRequest(`${name} must be a string`)
}

export function parseDecisionBody(
  body: unknown,
): SearchEvalCandidateDecisionInput | Response {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("JSON body must be an object")
  }
  const input = body as Record<string, unknown>
  const reviewerIdentity = stringOrNullish(
    input.reviewerIdentity,
    "reviewerIdentity",
  )
  if (reviewerIdentity instanceof Response) return reviewerIdentity
  if (reviewerIdentity == null || reviewerIdentity.trim().length === 0) {
    return badRequest("reviewerIdentity is required")
  }
  const reviewNotes = stringOrNullish(input.reviewNotes, "reviewNotes")
  if (reviewNotes instanceof Response) return reviewNotes

  return {
    reviewerIdentity,
    reviewNotes,
    promotionRunContext: input.promotionRunContext,
  }
}

export function parsePromoteBody(
  body: unknown,
): PromoteSearchEvalCandidateInput | Response {
  const decision = parseDecisionBody(body)
  if (decision instanceof Response) return decision
  const input = body as Record<string, unknown>

  const sanitizedQueryText = stringOrNullish(
    input.sanitizedQueryText,
    "sanitizedQueryText",
  )
  if (sanitizedQueryText instanceof Response) return sanitizedQueryText
  const sanitizedExpectedResultNotes = stringOrNullish(
    input.sanitizedExpectedResultNotes,
    "sanitizedExpectedResultNotes",
  )
  if (sanitizedExpectedResultNotes instanceof Response) {
    return sanitizedExpectedResultNotes
  }
  if (
    input.sanitizationStatus != null &&
    input.sanitizationStatus !== "sanitized"
  ) {
    return badRequest("promotion requires sanitizationStatus sanitized")
  }

  return {
    ...decision,
    sanitizedQueryText,
    sanitizedExpectedResultNotes,
    sanitizedSourceAnchors: input.sanitizedSourceAnchors,
    sanitizationStatus: input.sanitizationStatus as "sanitized" | undefined,
  }
}
