import { z } from "zod"
import { resolveAdminSessionFromRequest } from "@/auth/session"
import { hasPermission } from "@/auth/permissions"
import { prisma } from "@/db/client"
import { ForbiddenError } from "@/services/errors"
import {
  RecommendationConflictError,
  RecommendationInputError,
} from "@/services/recommendations/errors"
import { RecommendationStudyService } from "@/services/recommendations/experiment/study-service"
import { recommendationManifestDigest } from "@/services/recommendations/promotion/manifest"

const common = {
  studyId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  protocolDigest: z.string().regex(/^[a-f0-9]{64}$/),
}
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), protocol: z.unknown() }).strict(),
  z
    .object({
      action: z.literal("evidence"),
      ...common,
      evidenceId: z.string().uuid(),
      evidence: z.unknown(),
    })
    .strict(),
  z
    .object({
      action: z.literal("activate"),
      ...common,
      operationId: z.string().uuid(),
      evidenceId: z.string().uuid(),
      expectedPointerGeneration: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("evaluate"),
      ...common,
      operationId: z.string().uuid(),
      evidenceId: z.string().uuid(),
    })
    .strict(),
])
const response = (status: number, error: string) =>
  Response.json({ ok: false, error }, { status })
async function operator(request: Request) {
  const session = await resolveAdminSessionFromRequest(request)
  return session?.principal.id &&
    session.principal.role !== "SYSTEM" &&
    hasPermission(session.principal, "operate:recommendation-experiments")
    ? session
    : null
}
export async function GET(request: Request) {
  const session = await operator(request)
  if (!session) return response(403, "operator_required")
  const id = new URL(request.url).searchParams.get("studyId") ?? undefined
  if (id && !common.studyId.safeParse(id).success)
    return response(400, "invalid_study")
  const operationId = new URL(request.url).searchParams.get("operationId")
  if (operationId && (!id || !z.string().uuid().safeParse(operationId).success))
    return response(400, "invalid_operation")
  const [studies, pointer, manifests] = await Promise.all([
    new RecommendationStudyService(prisma).status(session.principal, id),
    prisma.recommendationPromotionPointer.findUnique({
      where: { id: "recommendation-promotion-pointer" },
    }),
    prisma.recommendationStrategyManifest.findMany({
      where: {
        id: {
          in: [
            "semantic-transcript-pgvector-v1",
            "semantic-experiment-aa-v1",
            "semantic-profile-hybrid-v1",
          ],
        },
      },
    }),
  ])
  const operation =
    operationId && id
      ? {
          evidence: await prisma.recommendationStudyEvidence.findFirst({
            where: { studyId: id, id: operationId },
            select: { id: true },
          }),
          evaluation: await prisma.recommendationStudyEvaluation.findFirst({
            where: { studyId: id, evaluation: { runId: operationId } },
            select: { evaluationId: true },
          }),
        }
      : null
  return Response.json(
    {
      ok: true,
      studies,
      pointer,
      operation,
      manifests: manifests.map((m) => ({
        id: m.id,
        digest: recommendationManifestDigest(m),
        enabled: m.enabled,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  )
}
export async function POST(request: Request) {
  if (
    request.headers.get("origin") !== new URL(request.url).origin ||
    request.headers.get("x-forge-csrf") !== "recommendation-study-v1" ||
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    return response(403, "csrf_failed")
  const session = await operator(request)
  if (!session) return response(403, "operator_required")
  const authenticatedAt = session.authenticatedAt
  const authenticationAge = authenticatedAt
    ? Date.now() - authenticatedAt.getTime()
    : Infinity
  if (
    !Number.isFinite(authenticationAge) ||
    authenticationAge < -60_000 ||
    authenticationAge > 15 * 60_000
  )
    return response(401, "recent_authentication_required")
  let input: z.infer<typeof inputSchema>
  try {
    const reader = request.body?.getReader()
    if (!reader) return response(400, "invalid_input")
    const decoder = new TextDecoder()
    let bytes = 0
    const chunks: string[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 65_536) {
        await reader.cancel()
        return response(413, "body_too_large")
      }
      chunks.push(decoder.decode(value, { stream: true }))
    }
    chunks.push(decoder.decode())
    input = inputSchema.parse(JSON.parse(chunks.join("")))
  } catch {
    return response(400, "invalid_input")
  }
  const service = new RecommendationStudyService(prisma)
  try {
    const result =
      input.action === "prepare"
        ? await service.prepare(session.principal, input.protocol)
        : input.action === "evidence"
          ? await service.recordEvidence(session.principal, input)
          : input.action === "activate"
            ? await service.activate(session.principal, input)
            : await service.evaluate(session.principal, input)
    return Response.json(
      { ok: true, result },
      { headers: { "cache-control": "no-store" } },
    )
  } catch (error) {
    if (error instanceof ForbiddenError)
      return response(403, "operator_required")
    if (error instanceof RecommendationConflictError)
      return response(409, "exact_operation_conflict")
    if (error instanceof RecommendationInputError)
      return response(400, error.message)
    // A commit response may have been lost. The client must reconcile the exact
    // study/operation ID; this response makes no claim that state is unchanged.
    return response(503, "acknowledgement_unknown_reconcile_status")
  }
}
