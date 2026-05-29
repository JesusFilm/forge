import { prisma } from "@/db/client"
import { rejectSearchEvalCandidate } from "@/services/search-eval/candidates"

import { parseDecisionBody } from "../action-helpers"
import {
  authorizeSearchEvalCandidateRequest,
  logValue,
  readJsonBody,
  responseForCandidateError,
  serviceUnavailable,
} from "../../review-route-helpers"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authorizeSearchEvalCandidateRequest(
    request,
    "search-eval-candidate-reject",
  )
  if (auth instanceof Response) return auth

  const body = await readJsonBody(request)
  if (body instanceof Response) return body

  const parsed = parseDecisionBody(body)
  if (parsed instanceof Response) return parsed

  const { id } = await params
  try {
    const candidate = await rejectSearchEvalCandidate(prisma, id, parsed)
    console.info(
      `[search] event=eval_candidate_reject auth=bearer route=internal rl=${auth.rateLimitSource} candidate_id=${logValue(id)}`,
    )
    return Response.json({ candidate }, { status: 200 })
  } catch (error) {
    const response = responseForCandidateError(error)
    if (response) return response
    console.error(
      `[search] event=eval_candidate_reject_failed route=internal error_class=${logValue(error instanceof Error ? error.name : typeof error)}`,
    )
    return serviceUnavailable()
  }
}
