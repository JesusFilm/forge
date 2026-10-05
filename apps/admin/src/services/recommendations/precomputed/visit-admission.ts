import { createHash } from "node:crypto"
import {
  Prisma,
  RecommendationExperimentArm,
  type PrismaClient,
} from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { env } from "@/config/env"
import { ForbiddenError } from "@/services/errors"
import { assertWebRecommendationCaller } from "../caller"
import { RecommendationAuthenticationError } from "../errors"
import { runRecommendationDeliveryTransaction } from "../delivery-runtime"
import { chooseExperimentArm } from "../experiment/assignment"
import { recommendationManifestDigest } from "../promotion/manifest"
import { RECOMMENDATION_SERVING_CONTROL_ID } from "../manifest.service"
import { verifyPrecomputedSourceEligibility } from "./watch-reader"
import { PRECOMPUTED_WATCH_PREVIEW_MANIFEST_ID } from "./watch-delivery"

export const PRECOMPUTED_VISIT_ASSIGNMENT_POLICY = "browser-sha256-50-v1"
export const PRECOMPUTED_VISIT_ELIGIBILITY_POLICY =
  "private-watch-visit-unverified-bot-v1"
export const PRECOMPUTED_VISIT_DELIVERY_POLICY = "saved-or-control-v1"
const RAW_VISIT_MS = 29 * 86_400_000
const CONFIG_RETENTION_MS = 365 * 86_400_000
const HEX_DIGEST = /^[a-f0-9]{64}$/
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type PrivateVisitAdmission = {
  status: "eligible" | "excluded" | "unavailable"
  visitId: string
  experimentId: string | null
  generationId: string | null
  arm: "control" | "challenger" | null
  qualification:
    | "unverified_browser"
    | "unknown_signal"
    | "declared_automation"
    | "private_preview"
    | null
  reason: string | null
  deliveryResult: "not_attempted"
}

function digest(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex")
}

async function activePersonalizationReceipt(
  prisma: Prisma.TransactionClient,
  consentReceiptDigest: string | null,
  profileTokenDigest: string | null,
  now: Date,
): Promise<boolean> {
  if (
    !consentReceiptDigest ||
    !profileTokenDigest ||
    !HEX_DIGEST.test(consentReceiptDigest) ||
    !HEX_DIGEST.test(profileTokenDigest)
  )
    return false
  const receipt = await prisma.recommendationConsentReceipt.findUnique({
    where: { tokenDigest: consentReceiptDigest },
    include: { profile: true },
  })
  return Boolean(
    receipt?.state === "ACTIVE" &&
    receipt.contractVersion === "recommendation-consent-v1" &&
    receipt.choice === "PERSONALIZATION" &&
    receipt.expiresAt > now &&
    receipt.profile?.state === "ACTIVE" &&
    receipt.profile.tokenDigest === profileTokenDigest &&
    receipt.profile.privacyGeneration === receipt.privacyGeneration &&
    receipt.profile.expiresAt > now,
  )
}

/** The incumbent is the live serving route, including any promotion authority. */
async function readControlRouting(
  prisma: Prisma.TransactionClient | PrismaClient,
) {
  const [control, promotion] = await Promise.all([
    prisma.recommendationServingControl.findUnique({
      where: { id: RECOMMENDATION_SERVING_CONTROL_ID },
      include: { manifest: true },
    }),
    prisma.recommendationPromotionPointer.findUnique({
      where: { id: "recommendation-promotion-pointer" },
      include: { activeManifest: true, lastKnownGoodManifest: true },
    }),
  ])
  if (!control?.enabled || !control.manifest.enabled) return null
  const manifestDigest = recommendationManifestDigest(control.manifest)
  return {
    manifest: control.manifest,
    manifestDigest,
    routingDigest: digest([
      "precomputed-control-routing-v1",
      control.id,
      String(control.version),
      String(control.enabled),
      manifestDigest,
      control.reasonCode,
      ...(promotion
        ? [
            promotion.id,
            String(promotion.generation),
            promotion.stage,
            promotion.activeManifestId,
            recommendationManifestDigest(promotion.activeManifest),
            promotion.lastKnownGoodManifestId,
            recommendationManifestDigest(promotion.lastKnownGoodManifest),
            promotion.activeApprovalId ?? "",
            String(promotion.exposureCeilingBps),
            String(promotion.killSwitchEnabled),
            promotion.activeOwnerReleaseId ?? "",
            String(promotion.ownerInfluenceFloorGeneration),
          ]
        : ["no_promotion_pointer"]),
      env.RECOMMENDATION_SEMANTIC_SERVING_ENABLED,
      env.RECOMMENDATION_USER_SERVING_ENABLED,
      env.RECOMMENDATION_VIEWING_MODE_ENABLED,
    ]),
  }
}

export async function configurePrivatePrecomputedExperiment(
  prisma: PrismaClient,
  input: {
    id: string
    generationId: string
    startsAt: Date
    endsAt: Date
    operator: Principal | null
  },
) {
  if (!hasPermission(input.operator, "operate:recommendation-experiments"))
    throw new ForbiddenError()
  if (env.RECOMMENDATION_PRECOMPUTED_TEST_ENABLED !== "1")
    throw new RecommendationAuthenticationError()
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,190}$/.test(input.id) ||
    !Number.isFinite(input.startsAt.getTime()) ||
    !Number.isFinite(input.endsAt.getTime()) ||
    input.endsAt <= input.startsAt
  )
    throw new PrecomputedExperimentConfigurationError("invalid_configuration")
  const [generation, routing, challenger] = await Promise.all([
    prisma.recommendationPrecomputedGeneration.findUnique({
      where: { id: input.generationId },
      select: { id: true, status: true, sourceSetDigest: true },
    }),
    readControlRouting(prisma),
    prisma.recommendationStrategyManifest.findUnique({
      where: { id: PRECOMPUTED_WATCH_PREVIEW_MANIFEST_ID },
    }),
  ])
  if (
    generation?.status !== "complete" ||
    !routing ||
    !challenger ||
    challenger.enabled ||
    !HEX_DIGEST.test(generation.sourceSetDigest)
  )
    throw new PrecomputedExperimentConfigurationError(
      "dependencies_unavailable",
    )
  const control = routing.manifest
  const controlManifestDigest = routing.manifestDigest
  const configurationDigest = digest([
    input.id,
    generation.id,
    generation.sourceSetDigest,
    control.id,
    controlManifestDigest,
    routing.routingDigest,
    challenger.id,
    PRECOMPUTED_VISIT_ASSIGNMENT_POLICY,
    PRECOMPUTED_VISIT_ELIGIBILITY_POLICY,
    PRECOMPUTED_VISIT_DELIVERY_POLICY,
    input.startsAt.toISOString(),
    input.endsAt.toISOString(),
  ])
  return prisma.recommendationPrecomputedExperiment.create({
    data: {
      id: input.id,
      generationId: generation.id,
      controlManifestId: control.id,
      challengerManifestId: challenger.id,
      controlManifestDigest,
      controlRoutingDigest: routing.routingDigest,
      sourceSetDigest: generation.sourceSetDigest,
      assignmentPolicyVersion: PRECOMPUTED_VISIT_ASSIGNMENT_POLICY,
      eligibilityPolicyVersion: PRECOMPUTED_VISIT_ELIGIBILITY_POLICY,
      deliveryPolicyVersion: PRECOMPUTED_VISIT_DELIVERY_POLICY,
      configurationDigest,
      state: "private_test",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      expiresAt: new Date(input.endsAt.getTime() + CONFIG_RETENTION_MS),
    },
  })
}

export class PrecomputedExperimentConfigurationError extends Error {
  constructor(
    readonly code: "invalid_configuration" | "dependencies_unavailable",
  ) {
    super(code)
    this.name = "PrecomputedExperimentConfigurationError"
  }
}

type AdmissionInput = {
  visitId: string
  browserDigest: string | null
  consentReceiptDigest: string | null
  profileTokenDigest: string | null
  seedMediaId: string
  locale: string
  audioLanguageSlug: string
  trafficCategory:
    | "declared_crawler"
    | "speculative_prefetch"
    | "speculative_prerender"
    | "ordinary_browser"
    | "unknown"
  enrollmentMode: "private_test" | "preview" | "none"
  caller: Principal | null
  now?: Date
  deadlineAt?: number
}

function result(
  input: AdmissionInput,
  status: PrivateVisitAdmission["status"],
  reason: string | null,
  experimentId: string | null = null,
  generationId: string | null = null,
  arm: PrivateVisitAdmission["arm"] = null,
  qualification: PrivateVisitAdmission["qualification"] = null,
): PrivateVisitAdmission {
  return {
    status,
    visitId: input.visitId,
    experimentId,
    generationId,
    arm,
    qualification,
    reason,
    deliveryResult: "not_attempted",
  }
}

export async function admitPrivatePrecomputedVisit(
  prisma: PrismaClient,
  input: AdmissionInput,
): Promise<PrivateVisitAdmission> {
  assertWebRecommendationCaller(input.caller)
  if (env.RECOMMENDATION_PRECOMPUTED_TEST_ENABLED !== "1")
    throw new RecommendationAuthenticationError()
  if (
    !UUID_V4.test(input.visitId) ||
    (input.browserDigest != null && !HEX_DIGEST.test(input.browserDigest)) ||
    (input.consentReceiptDigest != null &&
      !HEX_DIGEST.test(input.consentReceiptDigest)) ||
    (input.profileTokenDigest != null &&
      !HEX_DIGEST.test(input.profileTokenDigest)) ||
    !input.seedMediaId ||
    input.seedMediaId.length > 191 ||
    !/^[A-Za-z0-9-]{1,32}$/.test(input.locale) ||
    !/^[a-z0-9-]{1,64}$/.test(input.audioLanguageSlug)
  )
    return result(input, "unavailable", "invalid_input")
  const now = input.now ?? new Date()
  const deadlineAt = Math.min(input.deadlineAt ?? Infinity, Date.now() + 2_000)
  if (deadlineAt <= Date.now())
    return result(input, "unavailable", "visit_deadline_exhausted")
  try {
    return await runRecommendationDeliveryTransaction(
      prisma,
      deadlineAt,
      async (tx) => {
        const experiment =
          await tx.recommendationPrecomputedExperiment.findFirst({
            where: {
              state: "private_test",
              startsAt: { lte: now },
              endsAt: { gt: now },
            },
            include: { generation: true, controlManifest: true },
          })
        if (!experiment)
          return result(input, "unavailable", "test_configuration_unavailable")
        if (
          experiment.generation.status !== "complete" ||
          experiment.generation.sourceSetDigest !==
            experiment.sourceSetDigest ||
          recommendationManifestDigest(experiment.controlManifest) !==
            experiment.controlManifestDigest ||
          (await readControlRouting(tx))?.routingDigest !==
            experiment.controlRoutingDigest ||
          experiment.assignmentPolicyVersion !==
            PRECOMPUTED_VISIT_ASSIGNMENT_POLICY ||
          experiment.eligibilityPolicyVersion !==
            PRECOMPUTED_VISIT_ELIGIBILITY_POLICY ||
          experiment.deliveryPolicyVersion !== PRECOMPUTED_VISIT_DELIVERY_POLICY
        )
          return result(
            input,
            "unavailable",
            "frozen_configuration_unavailable",
          )

        let qualification: Exclude<
          PrivateVisitAdmission["qualification"],
          null
        > = "unverified_browser"
        let exclusionReason: string | null = null
        if (input.enrollmentMode !== "private_test") {
          qualification = "private_preview"
          exclusionReason =
            input.enrollmentMode === "preview"
              ? "preview_excluded"
              : "not_test_enrolled"
        } else if (
          input.trafficCategory === "declared_crawler" ||
          input.trafficCategory === "speculative_prefetch" ||
          input.trafficCategory === "speculative_prerender"
        ) {
          qualification = "declared_automation"
          exclusionReason = "automation_excluded"
        } else if (input.trafficCategory === "unknown") {
          qualification = "unknown_signal"
          exclusionReason = "traffic_unqualified"
        } else if (!input.browserDigest) {
          exclusionReason = "browser_identity_unavailable"
        } else if (
          !(await activePersonalizationReceipt(
            tx,
            input.consentReceiptDigest,
            input.profileTokenDigest,
            now,
          ))
        ) {
          exclusionReason = "consent_unverified"
        }
        if (!exclusionReason) {
          const source = await tx.recommendationPrecomputedSource.findUnique({
            where: {
              generationId_sourceVideoId: {
                generationId: experiment.generationId,
                sourceVideoId: input.seedMediaId,
              },
            },
            select: { sourceVideoId: true },
          })
          if (!source) exclusionReason = "outside_frozen_cohort"
          else if (!(await verifyPrecomputedSourceEligibility(tx, input)))
            exclusionReason = "source_unavailable"
        }
        const browserUnitDigest =
          exclusionReason == null
            ? digest([
                "precomputed-browser-unit-v1",
                experiment.id,
                input.browserDigest!,
              ])
            : null
        const arm =
          browserUnitDigest == null
            ? null
            : chooseExperimentArm({
                unitDigest: browserUnitDigest,
                configurationDigest: experiment.configurationDigest,
                challengerProbability: 0.5,
              })
        const data = {
          id: input.visitId,
          experimentId: experiment.id,
          browserUnitDigest,
          consentBindingDigest:
            exclusionReason == null
              ? digest([
                  "precomputed-consent-binding-v1",
                  experiment.id,
                  input.consentReceiptDigest!,
                ])
              : null,
          sourceVideoId: input.seedMediaId,
          locale: input.locale,
          audioLanguageSlug: input.audioLanguageSlug,
          eligibility: exclusionReason ? "excluded" : "eligible",
          qualification,
          exclusionReason,
          arm,
          deliveryResult: "not_attempted",
          createdAt: now,
          expiresAt: new Date(now.getTime() + RAW_VISIT_MS),
        } as const
        await tx.recommendationPrecomputedVisit.createMany({
          data: [data],
          skipDuplicates: true,
        })
        const visit = await tx.recommendationPrecomputedVisit.findUniqueOrThrow(
          {
            where: { id: input.visitId },
          },
        )
        if (
          visit.experimentId !== experiment.id ||
          visit.sourceVideoId !== input.seedMediaId ||
          visit.locale !== input.locale ||
          visit.audioLanguageSlug !== input.audioLanguageSlug ||
          visit.browserUnitDigest !== browserUnitDigest ||
          visit.consentBindingDigest !== data.consentBindingDigest
        )
          return result(input, "unavailable", "visit_identity_conflict")
        return result(
          input,
          visit.eligibility === "eligible" ? "eligible" : "excluded",
          visit.exclusionReason,
          experiment.id,
          experiment.generationId,
          visit.arm === RecommendationExperimentArm.CONTROL
            ? "control"
            : visit.arm === RecommendationExperimentArm.CHALLENGER
              ? "challenger"
              : null,
          visit.qualification as PrivateVisitAdmission["qualification"],
        )
      },
      Date.now,
    )
  } catch {
    return result(input, "unavailable", "visit_persistence_unavailable")
  }
}

export async function recordPrivatePrecomputedVisitDelivery(
  prisma: PrismaClient,
  input: {
    visitId: string
    browserDigest: string
    consentReceiptDigest: string | null
    profileTokenDigest: string | null
    result: "served" | "fallback" | "empty" | "unavailable"
    actualStrategy: string | null
    requestId: string | null
    fallbackReason: string | null
    caller: Principal | null
    deadlineAt?: number
  },
): Promise<"recorded" | "conflict" | "unavailable"> {
  assertWebRecommendationCaller(input.caller)
  if (env.RECOMMENDATION_PRECOMPUTED_TEST_ENABLED !== "1")
    throw new RecommendationAuthenticationError()
  if (
    !UUID_V4.test(input.visitId) ||
    !HEX_DIGEST.test(input.browserDigest) ||
    (input.actualStrategy != null && input.actualStrategy.length > 64) ||
    (input.requestId != null && input.requestId.length > 191) ||
    (input.fallbackReason != null && input.fallbackReason.length > 64)
  )
    return "unavailable"
  try {
    const deadlineAt = Math.min(
      input.deadlineAt ?? Infinity,
      Date.now() + 2_000,
    )
    if (deadlineAt <= Date.now()) return "unavailable"
    return await runRecommendationDeliveryTransaction(
      prisma,
      deadlineAt,
      async (tx) => {
        const now = new Date()
        const visit = await tx.recommendationPrecomputedVisit.findUnique({
          where: { id: input.visitId },
          include: { experiment: { select: { id: true } } },
        })
        if (
          !visit ||
          visit.eligibility !== "eligible" ||
          visit.expiresAt <= now ||
          (await readControlRouting(tx))?.routingDigest !==
            (
              await tx.recommendationPrecomputedExperiment.findUnique({
                where: { id: visit.experimentId },
                select: { controlRoutingDigest: true },
              })
            )?.controlRoutingDigest ||
          visit.browserUnitDigest !==
            digest([
              "precomputed-browser-unit-v1",
              visit.experiment.id,
              input.browserDigest,
            ]) ||
          visit.consentBindingDigest !==
            digest([
              "precomputed-consent-binding-v1",
              visit.experiment.id,
              input.consentReceiptDigest ?? "",
            ]) ||
          !(await activePersonalizationReceipt(
            tx,
            input.consentReceiptDigest,
            input.profileTokenDigest,
            now,
          ))
        )
          return "unavailable"
        if (input.requestId) {
          const request = await tx.recommendationRequest.findUnique({
            where: { id: input.requestId },
            select: { seedMediaId: true, expiresAt: true },
          })
          if (
            !request ||
            request.seedMediaId !== visit.sourceVideoId ||
            request.expiresAt <= now
          )
            return "conflict"
          await tx.recommendationPrecomputedVisitRequest.createMany({
            data: [
              {
                requestId: input.requestId,
                visitId: visit.id,
                createdAt: now,
                expiresAt: new Date(
                  Math.min(
                    visit.expiresAt.getTime(),
                    request.expiresAt.getTime(),
                  ),
                ),
              },
            ],
            skipDuplicates: true,
          })
          const binding =
            await tx.recommendationPrecomputedVisitRequest.findUniqueOrThrow({
              where: { requestId: input.requestId },
            })
          if (binding.visitId !== visit.id) return "conflict"
        }
        const priority = {
          not_attempted: 0,
          unavailable: 1,
          empty: 2,
          served: 3,
          fallback: 3,
        } as const
        const priorPriority =
          priority[visit.deliveryResult as keyof typeof priority] ?? -1
        const nextPriority = priority[input.result]
        const replaceSummary = nextPriority > priorPriority
        const preserveFallback =
          visit.fallbackReason == null && input.fallbackReason != null
        if (replaceSummary || preserveFallback) {
          await tx.recommendationPrecomputedVisit.updateMany({
            where: {
              id: visit.id,
              deliveryResult: visit.deliveryResult,
            },
            data: {
              ...(replaceSummary
                ? {
                    deliveryResult: input.result,
                    actualStrategy: input.actualStrategy,
                    deliveryRequestId: input.requestId,
                  }
                : {}),
              ...(preserveFallback
                ? { fallbackReason: input.fallbackReason }
                : {}),
            },
          })
        }
        return "recorded"
      },
      Date.now,
    )
  } catch {
    return "unavailable"
  }
}

type ArmCounts = {
  total: number
  served: number
  empty: number
  unavailable: number
  notAttempted: number
  fallback: number
}

function blankArm(): ArmCounts {
  return {
    total: 0,
    served: 0,
    empty: 0,
    unavailable: 0,
    notAttempted: 0,
    fallback: 0,
  }
}

export type PrivateVisitDiagnostics =
  | {
      status: "unavailable"
      reason: string
    }
  | {
      status: "observed_private_only" | "incomplete_raw_window"
      experimentId: string
      generationId: string
      configurationDigest: string
      controlManifestId: string
      controlRoutingDigest: string
      sourceSetDigest: string
      startsAt: Date
      endsAt: Date
      measurementQualification: "unverified_edge_bot_signal"
      eligible: ArmCounts & {
        byArm: { control: ArmCounts; challenger: ArmCounts }
      }
      excluded: {
        total: number
        automation: number
        preview: number
        unknownSignal: number
        outsideCohort: number
        other: number
      }
    }

/** These are observed private admissions, never certified public human visits. */
export async function loadPrivatePrecomputedVisitDiagnostics(
  prisma: PrismaClient,
  input: { experimentId: string; reviewer: Principal | null; now?: Date },
): Promise<PrivateVisitDiagnostics> {
  if (!hasPermission(input.reviewer, "read:recommendation-aggregates"))
    throw new ForbiddenError()
  const now = input.now ?? new Date()
  try {
    const experiment =
      await prisma.recommendationPrecomputedExperiment.findUnique({
        where: { id: input.experimentId },
        select: {
          id: true,
          generationId: true,
          configurationDigest: true,
          controlManifestId: true,
          controlRoutingDigest: true,
          sourceSetDigest: true,
          startsAt: true,
          endsAt: true,
        },
      })
    if (!experiment)
      return { status: "unavailable", reason: "experiment_not_found" }
    const rows = await prisma.recommendationPrecomputedVisit.groupBy({
      by: [
        "eligibility",
        "arm",
        "qualification",
        "exclusionReason",
        "deliveryResult",
        "fallbackReason",
      ],
      where: { experimentId: input.experimentId, expiresAt: { gt: now } },
      _count: { _all: true },
    })
    const byArm = { control: blankArm(), challenger: blankArm() }
    const excluded = {
      total: 0,
      automation: 0,
      preview: 0,
      unknownSignal: 0,
      outsideCohort: 0,
      other: 0,
    }
    for (const row of rows) {
      const count = row._count._all
      if (!Number.isSafeInteger(count))
        return { status: "unavailable", reason: "count_overflow" }
      if (row.eligibility === "excluded") {
        excluded.total += count
        if (row.qualification === "declared_automation")
          excluded.automation += count
        else if (row.qualification === "private_preview")
          excluded.preview += count
        else if (row.qualification === "unknown_signal")
          excluded.unknownSignal += count
        else if (row.exclusionReason === "outside_frozen_cohort")
          excluded.outsideCohort += count
        else excluded.other += count
        continue
      }
      const arm =
        row.arm === RecommendationExperimentArm.CONTROL
          ? byArm.control
          : row.arm === RecommendationExperimentArm.CHALLENGER
            ? byArm.challenger
            : null
      if (!arm) return { status: "unavailable", reason: "invalid_arm_row" }
      arm.total += count
      if (row.deliveryResult === "served" || row.deliveryResult === "fallback")
        arm.served += count
      else if (row.deliveryResult === "empty") arm.empty += count
      else if (row.deliveryResult === "unavailable") arm.unavailable += count
      else if (row.deliveryResult === "not_attempted") arm.notAttempted += count
      if (row.fallbackReason != null) arm.fallback += count
    }
    const eligible = blankArm()
    for (const arm of [byArm.control, byArm.challenger]) {
      eligible.total += arm.total
      eligible.served += arm.served
      eligible.empty += arm.empty
      eligible.unavailable += arm.unavailable
      eligible.notAttempted += arm.notAttempted
      eligible.fallback += arm.fallback
    }
    return {
      status:
        experiment.startsAt.getTime() < now.getTime() - RAW_VISIT_MS
          ? "incomplete_raw_window"
          : "observed_private_only",
      experimentId: experiment.id,
      generationId: experiment.generationId,
      configurationDigest: experiment.configurationDigest,
      controlManifestId: experiment.controlManifestId,
      controlRoutingDigest: experiment.controlRoutingDigest,
      sourceSetDigest: experiment.sourceSetDigest,
      startsAt: experiment.startsAt,
      endsAt: experiment.endsAt,
      measurementQualification: "unverified_edge_bot_signal",
      eligible: { ...eligible, byArm },
      excluded,
    }
  } catch {
    return { status: "unavailable", reason: "measurement_read_unavailable" }
  }
}
