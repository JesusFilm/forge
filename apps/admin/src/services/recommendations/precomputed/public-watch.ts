import { RecommendationExperimentArm, type PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { env } from "@/config/env"
import { createRecommendationDeliveryService } from "@/services/recommendations/delivery.service"
import {
  runRecommendationDeliveryTransaction,
  unavailable,
} from "@/services/recommendations/delivery-runtime"
import type {
  DeliveryTokenService,
  SemanticRecommendationDelivery,
} from "@/services/recommendations/delivery.types"
import { createRuntimeRecommendationTokenService } from "@/services/recommendations/runtime-token"
import { assertWebRecommendationCaller } from "../caller"
import { chooseExperimentArm } from "../experiment/assignment"
import { recommendationManifestDigest } from "../promotion/manifest"
import {
  PRECOMPUTED_CTR_METHOD,
  precomputedCtrPolicyDigest,
} from "./ctr-report"
import type { CtrPolicySettings } from "./ctr-policy"
import { lockPrecomputedCtrEvidence } from "./ctr-fence"
import {
  assertIsolatedPrecomputedControlFixture,
  loadPrecomputedPublicControl,
  PRECOMPUTED_PUBLIC_CONTROL_ID,
  PRECOMPUTED_PUBLIC_ELIGIBILITY_POLICY,
  PRECOMPUTED_PUBLIC_LIVE_ELIGIBILITY_POLICY,
} from "./public-control"
import { verifyWatchHumanReceipt } from "./human-verification"
import {
  PRECOMPUTED_VISIT_ASSIGNMENT_POLICY,
  PRECOMPUTED_VISIT_DELIVERY_POLICY,
  readControlRouting,
  recordPrivatePrecomputedVisitDelivery,
} from "./visit-admission"
import { precomputedBrowserUnitDigest } from "./visit-identity"
import { deliverPrecomputedWatchPreview } from "./watch-delivery"
import { verifyPrecomputedSourceEligibility } from "./watch-reader"

const RAW_VISIT_MS = 29 * 86_400_000
const HEX_DIGEST = /^[a-f0-9]{64}$/
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type PrecomputedPublicWatchVisitInput = {
  visitId: string
  browserDigest: string | null
  consentReceiptDigest: string | null
  profileTokenDigest: string | null
  seedMediaId: string
  locale: string
  audioLanguageSlug: string
  sessionDigest: string
  clientDeliveryContract: string | null
  trafficCategory:
    | "declared_crawler"
    | "speculative_prefetch"
    | "speculative_prerender"
    | "ordinary_browser"
    | "unknown"
  humanVerificationReceipt?: string | null
  caller: Principal | null
  now?: Date
}

export type PrecomputedPublicWatchVisitResult = {
  disposition: "inactive" | "ab" | "promoted"
  status: "eligible" | "excluded" | "unavailable" | "not_applicable"
  visitId: string
  experimentId: string | null
  generationId: string | null
  arm: "control" | "challenger" | null
  reason: string | null
  qualification: string | null
  measurementStatus: "recorded" | "conflict" | "unavailable" | "not_applicable"
  delivery: SemanticRecommendationDelivery | null
}

type Admission = Omit<
  PrecomputedPublicWatchVisitResult,
  "measurementStatus" | "delivery"
>

function inactive(
  input: PrecomputedPublicWatchVisitInput,
  reason: string | null,
): Admission {
  return {
    disposition: "inactive",
    status: "not_applicable",
    visitId: input.visitId,
    experimentId: null,
    generationId: null,
    arm: null,
    reason,
    qualification: null,
  }
}

/** The pointer lock is shared with rollback/start. A visit cannot join an old
 * cohort after either operator transition commits. A duplicate UUID can only
 * replay the same browser, source, locale, generation and arm. */
async function admitPublicVisit(
  prisma: PrismaClient,
  input: PrecomputedPublicWatchVisitInput,
  deadlineAt: number,
): Promise<Admission> {
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
    return { ...inactive(input, "invalid_input"), status: "unavailable" }
  if (input.trafficCategory !== "ordinary_browser" || !input.browserDigest)
    return {
      ...inactive(input, "traffic_unqualified"),
      status: "excluded",
      qualification:
        input.trafficCategory === "ordinary_browser"
          ? "browser_identity_unavailable"
          : input.trafficCategory === "unknown"
            ? "unknown_signal"
            : "declared_automation",
    }
  const now = input.now ?? new Date()
  try {
    return await runRecommendationDeliveryTransaction(
      prisma,
      deadlineAt,
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM recommendation_precomputed_public_control
          WHERE id = ${PRECOMPUTED_PUBLIC_CONTROL_ID} FOR SHARE`
        const control = await loadPrecomputedPublicControl(tx, now)
        if (control.mode === "incumbent") return inactive(input, null)
        const base = {
          ...inactive(input, null),
          disposition: control.mode,
          experimentId: control.experimentId,
          generationId: control.generationId,
        } as Admission
        if (control.authority === "isolated_fixture")
          await assertIsolatedPrecomputedControlFixture(tx)
        else if (control.authority !== "live_verified")
          return {
            ...base,
            status: "unavailable",
            reason: "live_qualification_unavailable",
          }
        const live = control.authority === "live_verified"
        const eligibilityPolicy = live
          ? PRECOMPUTED_PUBLIC_LIVE_ELIGIBILITY_POLICY
          : PRECOMPUTED_PUBLIC_ELIGIBILITY_POLICY
        const qualification = live
          ? "turnstile_verified_browser"
          : "fixture_human"
        const experiment =
          await tx.recommendationPrecomputedExperiment.findUnique({
            where: { id: control.experimentId! },
            include: {
              generation: true,
              controlManifest: true,
              ctrPolicy: true,
            },
          })
        if (
          experiment?.state !== "public_ready" ||
          experiment.generation.status !== "complete" ||
          experiment.generation.sourceSetDigest !==
            experiment.sourceSetDigest ||
          experiment.configurationDigest !== control.configurationDigest ||
          experiment.assignmentPolicyVersion !==
            PRECOMPUTED_VISIT_ASSIGNMENT_POLICY ||
          experiment.eligibilityPolicyVersion !== eligibilityPolicy ||
          experiment.deliveryPolicyVersion !==
            PRECOMPUTED_VISIT_DELIVERY_POLICY ||
          recommendationManifestDigest(experiment.controlManifest) !==
            experiment.controlManifestDigest ||
          (await readControlRouting(tx))?.routingDigest !==
            experiment.controlRoutingDigest ||
          experiment.ctrPolicy?.version !== PRECOMPUTED_CTR_METHOD ||
          experiment.ctrPolicy?.settingsDigest !==
            precomputedCtrPolicyDigest(
              experiment.ctrPolicy.settings as CtrPolicySettings,
            )
        )
          return {
            ...base,
            status: "unavailable",
            reason: "frozen_configuration_unavailable",
          }
        if (control.mode === "promoted") return base
        if (now < experiment.startsAt || now >= experiment.endsAt)
          return {
            ...base,
            status: "unavailable",
            reason: "outside_cohort_window",
          }
        // Evaluation takes the same fence exclusively before its final read.
        // Recheck finality after acquiring it so a new denominator cannot
        // commit outside a final report's evidence snapshot.
        await lockPrecomputedCtrEvidence(tx, experiment.id, "shared")
        const finalReport =
          await tx.recommendationPrecomputedCtrReport.findFirst({
            where: { experimentId: experiment.id, isFinal: true },
            select: { revision: true },
          })
        if (finalReport)
          return { ...base, status: "unavailable", reason: "cohort_finalized" }
        const source = await tx.recommendationPrecomputedSource.findUnique({
          where: {
            generationId_sourceVideoId: {
              generationId: experiment.generationId,
              sourceVideoId: input.seedMediaId,
            },
          },
          select: { sourceVideoId: true },
        })
        if (!source)
          return {
            ...base,
            status: "excluded",
            reason: "outside_frozen_cohort",
          }
        if (!(await verifyPrecomputedSourceEligibility(tx, input)))
          return { ...base, status: "excluded", reason: "source_unavailable" }
        if (live) {
          if (!input.humanVerificationReceipt)
            return {
              ...base,
              status: "unavailable",
              reason: "verification_required",
            }
          if (
            !env.WATCH_RECOMMENDATION_HUMAN_PROOF_SECRET ||
            !env.WATCH_RECOMMENDATION_TURNSTILE_HOSTNAMES
          )
            return {
              ...base,
              status: "unavailable",
              reason: "live_qualification_unavailable",
            }
          if (
            !verifyWatchHumanReceipt(
              {
                receipt: input.humanVerificationReceipt,
                visitId: input.visitId,
                browserDigest: input.browserDigest,
                seedMediaId: input.seedMediaId,
                locale: input.locale,
                audioLanguageSlug: input.audioLanguageSlug,
                caller: input.caller,
                now,
              },
              {
                secret: env.WATCH_RECOMMENDATION_HUMAN_PROOF_SECRET,
                allowedHostnames: env.WATCH_RECOMMENDATION_TURNSTILE_HOSTNAMES,
              },
            )
          )
            return {
              ...base,
              status: "unavailable",
              reason: "verification_required",
            }
        }
        const browserUnitDigest = precomputedBrowserUnitDigest(
          experiment.id,
          input.browserDigest!,
        )
        const arm = chooseExperimentArm({
          unitDigest: browserUnitDigest,
          configurationDigest: experiment.configurationDigest,
          challengerProbability: 0.5,
        })
        await tx.recommendationPrecomputedVisit.createMany({
          data: [
            {
              id: input.visitId,
              experimentId: experiment.id,
              browserUnitDigest,
              consentBindingDigest: null,
              sourceVideoId: input.seedMediaId,
              locale: input.locale,
              audioLanguageSlug: input.audioLanguageSlug,
              eligibility: "eligible",
              qualification,
              exclusionReason: null,
              arm,
              deliveryResult: "not_attempted",
              createdAt: now,
              expiresAt: new Date(now.getTime() + RAW_VISIT_MS),
            },
          ],
          skipDuplicates: true,
        })
        const visit = await tx.recommendationPrecomputedVisit.findUniqueOrThrow(
          {
            where: { id: input.visitId },
          },
        )
        if (
          visit.experimentId !== experiment.id ||
          visit.browserUnitDigest !== browserUnitDigest ||
          visit.sourceVideoId !== input.seedMediaId ||
          visit.locale !== input.locale ||
          visit.audioLanguageSlug !== input.audioLanguageSlug ||
          visit.arm !== arm ||
          visit.eligibility !== "eligible" ||
          visit.qualification !== qualification
        )
          return {
            ...base,
            status: "unavailable",
            reason: "visit_identity_conflict",
          }
        return {
          ...base,
          status: "eligible",
          arm:
            arm === RecommendationExperimentArm.CONTROL
              ? "control"
              : "challenger",
          qualification: visit.qualification,
        }
      },
      Date.now,
    )
  } catch {
    return {
      ...inactive(input, "visit_persistence_unavailable"),
      status: "unavailable",
    }
  }
}

/** One Watch operation routes the incumbent or the saved generation. The
 * delivery actually shown is attached to the same persisted visit and request
 * lineage, including incumbent recovery from a technical challenger failure. */
export async function deliverPrecomputedPublicWatchVisit(
  prisma: PrismaClient,
  input: PrecomputedPublicWatchVisitInput,
  tokenService: DeliveryTokenService | null = createRuntimeRecommendationTokenService(
    prisma,
  ),
): Promise<PrecomputedPublicWatchVisitResult> {
  assertWebRecommendationCaller(input.caller)
  const deadlineAt = Date.now() + 3_000
  const deliveryDeadlineAt = deadlineAt - 250
  const admission = await admitPublicVisit(prisma, input, deliveryDeadlineAt)
  if (admission.reason === "verification_required")
    return { ...admission, measurementStatus: "not_applicable", delivery: null }
  const deliverControl = () =>
    createRecommendationDeliveryService(prisma).deliver({
      caller: input.caller,
      seedMediaId: input.seedMediaId,
      locale: input.locale,
      audioLanguageSlug: input.audioLanguageSlug,
      sessionDigest: input.sessionDigest,
      consentReceiptDigest: input.consentReceiptDigest,
      profileTokenDigest: input.profileTokenDigest,
      eligibleHuman: input.trafficCategory === "ordinary_browser",
      suppressExperimentEnrollment: admission.disposition !== "inactive",
      trafficCategory: input.trafficCategory,
      clientDeliveryContract: input.clientDeliveryContract,
      deadlineAt: deliveryDeadlineAt,
    })
  let delivery: SemanticRecommendationDelivery
  let fallbackReason: string | null = null
  try {
    if (Date.now() >= deliveryDeadlineAt)
      delivery = unavailable("public_watch_deadline_exhausted")
    else if (
      (admission.disposition === "ab" &&
        admission.status === "eligible" &&
        admission.arm === "challenger") ||
      (admission.disposition === "promoted" &&
        admission.status === "not_applicable")
    ) {
      delivery = await deliverPrecomputedWatchPreview(
        prisma,
        {
          seedMediaId: input.seedMediaId,
          locale: input.locale,
          audioLanguageSlug: input.audioLanguageSlug,
          sessionDigest: input.sessionDigest,
          generationId: admission.generationId!,
          deadlineAt: deliveryDeadlineAt,
          caller: input.caller,
        },
        tokenService,
      )
      if (
        delivery.result === "unavailable" &&
        delivery.reason !== "source_unavailable" &&
        delivery.reason !== "source_eligibility_unavailable"
      ) {
        fallbackReason = delivery.reason ?? "precomputed_unavailable"
        const sourceEligible = await runRecommendationDeliveryTransaction(
          prisma,
          Math.min(deliveryDeadlineAt, Date.now() + 350),
          (tx) => verifyPrecomputedSourceEligibility(tx, input),
          Date.now,
        )
        if (sourceEligible && Date.now() < deliveryDeadlineAt)
          delivery = await deliverControl()
      }
    } else delivery = await deliverControl()
  } catch {
    delivery = unavailable("public_watch_delivery_unavailable")
  }
  const measurementStatus =
    admission.disposition === "ab" &&
    admission.status === "eligible" &&
    input.browserDigest
      ? await recordPrivatePrecomputedVisitDelivery(prisma, {
          visitId: input.visitId,
          browserDigest: input.browserDigest,
          result: delivery.result,
          actualStrategy:
            delivery.result === "unavailable" ? null : delivery.strategyVersion,
          requestId: delivery.requestId,
          fallbackReason,
          caller: input.caller,
          deadlineAt,
        })
      : admission.reason === "visit_identity_conflict"
        ? "conflict"
        : "not_applicable"
  return { ...admission, measurementStatus, delivery }
}
