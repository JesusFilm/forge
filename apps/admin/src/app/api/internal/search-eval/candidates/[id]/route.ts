import { prisma } from "@/db/client"
import {
  getSearchEvalCandidateForReview,
  updateSearchEvalCandidateReviewFields,
  type UpdateSearchEvalCandidateReviewInput,
} from "@/services/search-eval/candidates"

import {
  authorizeSearchEvalCandidateRequest,
  badRequest,
  logValue,
  readJsonBody,
  responseForCandidateError,
  serviceUnavailable,
} from "../review-route-helpers"

function stringOrNullish(
  value: unknown,
  name: string,
): string | null | undefined | Response {
  if (value == null) return value as null | undefined
  if (typeof value === "string") return value
  return badRequest(`${name} must be a string`)
}

function parsePatchBody(
  body: unknown,
): UpdateSearchEvalCandidateReviewInput | Response {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("JSON body must be an object")
  }
  const input = body as Record<string, unknown>
  if ("promotionStatus" in input) {
    return badRequest("promotionStatus is server-owned")
  }
  if (
    input.sanitizationStatus != null &&
    input.sanitizationStatus !== "pending" &&
    input.sanitizationStatus !== "sanitized" &&
    input.sanitizationStatus !== "unsafe"
  ) {
    return badRequest(
      "sanitizationStatus must be pending, sanitized, or unsafe",
    )
  }

  const reviewerIdentity = stringOrNullish(
    input.reviewerIdentity,
    "reviewerIdentity",
  )
  if (reviewerIdentity instanceof Response) return reviewerIdentity
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
  const reviewNotes = stringOrNullish(input.reviewNotes, "reviewNotes")
  if (reviewNotes instanceof Response) return reviewNotes

  return {
    reviewerIdentity,
    sanitizedQueryText,
    sanitizedExpectedResultNotes,
    sanitizedSourceAnchors: input.sanitizedSourceAnchors,
    sanitizationStatus: input.sanitizationStatus as
      | UpdateSearchEvalCandidateReviewInput["sanitizationStatus"]
      | undefined,
    reviewNotes,
    promotionRunContext: input.promotionRunContext,
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authorizeSearchEvalCandidateRequest(
    request,
    "search-eval-candidate-detail",
  )
  if (auth instanceof Response) return auth

  const { id } = await params
  try {
    const candidate = await getSearchEvalCandidateForReview(prisma, id)
    console.info(
      `[search] event=eval_candidate_detail auth=bearer route=internal rl=${auth.rateLimitSource} candidate_id=${logValue(id)}`,
    )
    return Response.json({ candidate }, { status: 200 })
  } catch (error) {
    const response = responseForCandidateError(error)
    if (response) return response
    console.error(
      `[search] event=eval_candidate_detail_failed route=internal error_class=${logValue(error instanceof Error ? error.name : typeof error)}`,
    )
    return serviceUnavailable()
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authorizeSearchEvalCandidateRequest(
    request,
    "search-eval-candidate-edit",
  )
  if (auth instanceof Response) return auth

  const body = await readJsonBody(request)
  if (body instanceof Response) return body

  const parsed = parsePatchBody(body)
  if (parsed instanceof Response) return parsed

  const { id } = await params
  try {
    const candidate = await updateSearchEvalCandidateReviewFields(
      prisma,
      id,
      parsed,
    )
    console.info(
      `[search] event=eval_candidate_edit auth=bearer route=internal rl=${auth.rateLimitSource} candidate_id=${logValue(id)}`,
    )
    return Response.json({ candidate }, { status: 200 })
  } catch (error) {
    const response = responseForCandidateError(error)
    if (response) return response
    console.error(
      `[search] event=eval_candidate_edit_failed route=internal error_class=${logValue(error instanceof Error ? error.name : typeof error)}`,
    )
    return serviceUnavailable()
  }
}
