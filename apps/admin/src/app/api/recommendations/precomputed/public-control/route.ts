import { z } from "zod"
import { isTrustedReturnToOrigin } from "@/auth/origins"
import { hasPermission } from "@/auth/permissions"
import { resolveAdminSessionFromRequest } from "@/auth/session"
import { prisma } from "@/db/client"
import { ForbiddenError } from "@/services/errors"
import { evaluatePublicPrecomputedCtr } from "@/services/recommendations/precomputed/ctr-report"
import {
  PrecomputedPublicControlError,
  preparePrecomputedPublicExperiment,
  promotePrecomputedPublicExperiment,
  releaseRetainedPrecomputedPublicExperiment,
  rollbackPrecomputedPublicExperiment,
  startPrecomputedPublicExperiment,
} from "@/services/recommendations/precomputed/public-control"
import { loadPrecomputedPublicReadiness } from "@/services/recommendations/precomputed/public-readiness"
import {
  PrecomputedBaselineError,
  startPrecomputedIncumbentBaseline,
  stopPrecomputedIncumbentBaseline,
} from "@/services/recommendations/precomputed/incumbent-baseline"
import { readRecommendationOperatorBody } from "../../operator-body"

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,190}$/)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const version = z.number().int().positive()
const isoTime = z.string().datetime({ offset: true })
const authority = z.enum(["isolated_fixture", "live_verified"])
const policy = z
  .object({
    baselineHumanVisitCtr: z.number().min(0).max(1),
    minimumDetectableAbsoluteUplift: z.number().min(0).max(1),
    minimumPracticalAbsoluteUplift: z.number().min(0).max(1),
    plannedPower: z.number().gt(0).lt(1),
    minimumEligibleVisitsPerArm: version,
    minimumIndependentBrowsersPerArm: z.number().int().min(3),
    minimumDurationHours: version,
    lateEventCutoffHours: z.number().int().min(0).max(672),
    maximumActualFallbackRate: z.number().min(0).max(1),
    maximumUnlinkedDeliveryRate: z.number().min(0).max(1),
  })
  .strict()
const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start_baseline") }).strict(),
  z
    .object({
      action: z.literal("stop_baseline"),
      baselineId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("prepare"),
      experimentId: id,
      generationId: id,
      startsAt: isoTime,
      endsAt: isoTime,
      expectedControlRoutingDigest: digest,
      expectedSourceSetDigest: digest,
      policySettings: policy,
      authority,
    })
    .strict(),
  z
    .object({
      action: z.literal("start"),
      experimentId: id,
      expectedConfigurationDigest: digest,
      expectedControlVersion: version,
      authority,
    })
    .strict(),
  z.object({ action: z.literal("evaluate"), experimentId: id }).strict(),
  z
    .object({
      action: z.literal("promote"),
      expectedControlVersion: version,
      expectedExperimentId: id,
      expectedGenerationId: id,
      expectedReportRevision: version,
      expectedReportEvidenceDigest: digest,
    })
    .strict(),
  z
    .object({
      action: z.literal("rollback"),
      expectedControlVersion: version,
      expectedExperimentId: id,
      expectedGenerationId: id,
      expectedReportRevision: version.nullable(),
      expectedReportEvidenceDigest: digest.nullable().optional(),
      reasonCode: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal("release_retained"),
      expectedControlVersion: version,
      expectedExperimentId: id,
      reasonCode: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    })
    .strict(),
])

const NO_STORE = { "cache-control": "no-store" }
const RECENT_AUTH_MS = 15 * 60 * 1_000

/** Admin UI and session-authenticated agents read identical control state. */
export async function GET(request: Request): Promise<Response> {
  const session = await resolveAdminSessionFromRequest(request)
  if (!session) return error(401, "authentication_required")
  try {
    const readiness = await loadPrecomputedPublicReadiness(
      prisma,
      session.principal,
    )
    return Response.json({ ok: true, readiness }, { headers: NO_STORE })
  } catch (cause) {
    if (cause instanceof ForbiddenError) return error(403, "permission_denied")
    return error(503, "readiness_unavailable")
  }
}

/** No producer token is accepted here. Every state change needs an Admin
 * session, canonical same-origin CSRF proof, and an exact target/version. */
export async function POST(request: Request): Promise<Response> {
  if (
    !isTrustedReturnToOrigin(request.headers.get("origin")) ||
    request.headers.get("x-forge-csrf") !== "precomputed-public-control-v1" ||
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    return error(403, "csrf_failed")
  const session = await resolveAdminSessionFromRequest(request)
  if (!session) return error(401, "authentication_required")
  const body = await readRecommendationOperatorBody(request)
  if (!body.ok) return error(body.status, body.error)
  const parsed = mutation.safeParse(body.value)
  if (!parsed.success) return error(400, "invalid_input")
  const input = parsed.data
  if (
    !hasPermission(
      session.principal,
      input.action === "rollback" || input.action === "release_retained"
        ? "rollback:recommendations"
        : "operate:recommendation-experiments",
    )
  )
    return error(403, "permission_denied")
  if (
    ["prepare", "start", "promote", "start_baseline"].includes(input.action) &&
    (!session.authenticatedAt ||
      Date.now() - session.authenticatedAt.getTime() > RECENT_AUTH_MS ||
      Date.now() - session.authenticatedAt.getTime() < -60_000)
  )
    return error(401, "recent_authentication_required")
  try {
    if (input.action === "start_baseline") {
      const baseline = await startPrecomputedIncumbentBaseline(prisma, {
        operator: session.principal,
      })
      return Response.json({ ok: true, baseline }, { headers: NO_STORE })
    }
    if (input.action === "stop_baseline") {
      const baseline = await stopPrecomputedIncumbentBaseline(prisma, {
        baselineId: input.baselineId,
        operator: session.principal,
      })
      return Response.json({ ok: true, baseline }, { headers: NO_STORE })
    }
    if (input.action === "prepare") {
      const prepared = await preparePrecomputedPublicExperiment(prisma, {
        id: input.experimentId,
        generationId: input.generationId,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        expectedControlRoutingDigest: input.expectedControlRoutingDigest,
        expectedSourceSetDigest: input.expectedSourceSetDigest,
        policySettings: input.policySettings,
        authority: input.authority,
        operator: session.principal,
      })
      return Response.json({ ok: true, prepared }, { headers: NO_STORE })
    }
    if (input.action === "start") {
      const control = await startPrecomputedPublicExperiment(prisma, {
        experimentId: input.experimentId,
        expectedConfigurationDigest: input.expectedConfigurationDigest,
        expectedControlVersion: input.expectedControlVersion,
        authority: input.authority,
        operator: session.principal,
      })
      return Response.json({ ok: true, control }, { headers: NO_STORE })
    }
    if (input.action === "evaluate") {
      const report = await evaluatePublicPrecomputedCtr(prisma, {
        experimentId: input.experimentId,
        operator: session.principal,
      })
      return Response.json({ ok: true, report }, { headers: NO_STORE })
    }
    if (input.action === "promote") {
      const control = await promotePrecomputedPublicExperiment(prisma, {
        ...input,
        operator: session.principal,
      })
      return Response.json({ ok: true, control }, { headers: NO_STORE })
    }
    const control =
      input.action === "rollback"
        ? await rollbackPrecomputedPublicExperiment(prisma, {
            ...input,
            operator: session.principal,
          })
        : await releaseRetainedPrecomputedPublicExperiment(prisma, {
            ...input,
            operator: session.principal,
          })
    return Response.json({ ok: true, control }, { headers: NO_STORE })
  } catch (cause) {
    if (cause instanceof ForbiddenError) return error(403, "permission_denied")
    if (cause instanceof PrecomputedPublicControlError) {
      const status =
        cause.code === "invalid_input"
          ? 400
          : cause.code === "readiness_unavailable" ||
              cause.code === "fixture_authority_unavailable"
            ? 423
            : 409
      return error(status, cause.code)
    }
    if (cause instanceof PrecomputedBaselineError)
      return error(
        cause.code === "invalid_input"
          ? 400
          : cause.code === "verification_unavailable"
            ? 423
            : 409,
        cause.code,
      )
    return error(503, "acknowledgement_unknown_reconcile_status")
  }
}

function error(status: number, code: string) {
  return Response.json(
    { ok: false, error: code },
    { status, headers: NO_STORE },
  )
}
