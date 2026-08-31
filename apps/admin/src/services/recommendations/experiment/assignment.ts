import { createHash, randomUUID } from "node:crypto"
import {
  Prisma,
  RecommendationExperimentArm,
  RecommendationExperimentAssignmentState,
  RecommendationExperimentState,
  RecommendationExperimentUnitKind,
  RecommendationProfileState,
  type PrismaClient,
} from "@prisma/client"
import {
  DELIVERY_RETRIEVAL_BUDGET_MS,
  RECOMMENDATION_RAW_RETENTION_DAYS,
} from "../contracts"
import {
  HYBRID_PERSONALIZED_MANIFEST_ID,
  isExactHybridPersonalizedManifest,
  recommendationManifestDigest,
} from "../promotion/manifest"
import { HYBRID_CANDIDATE_GENERATOR_SET_VERSION } from "../candidate"

export const RECOMMENDATION_ASSIGNMENT_POLICY_VERSION =
  "sticky-deterministic-assignment-v1" as const

export type ExperimentAssignmentContext = Readonly<{
  assignmentId: string
  experimentId: string
  experimentVersion: string
  experimentGeneration: number
  arm: "control" | "challenger"
  effectiveManifestId: string
  assignmentProbability: number
  configurationDigest: string
}>

export type ExperimentAssignmentResolution = Readonly<{
  assignment: ExperimentAssignmentContext | null
  bypassReason:
    | "machine_ineligible"
    | "personalization_not_consented"
    | "no_active_experiment"
    | "manifest_not_equivalent"
    | "shadow_decision_missing"
    | "promotion_not_active"
    | "promotion_not_approved"
    | "promotion_unavailable"
    | "assignment_fenced"
    | "assignment_unavailable"
    | null
}>

type ExperimentWithManifests = NonNullable<
  Awaited<ReturnType<typeof findActiveExperiment>>
>

export async function resolveExperimentAssignment(
  prisma: PrismaClient,
  input: {
    surfaceVersion: string
    sessionDigest: string
    profileTokenDigest: string | null
    eligibleHuman: boolean
    now?: Date
  },
): Promise<ExperimentAssignmentResolution> {
  if (!input.eligibleHuman) {
    return { assignment: null, bypassReason: "machine_ineligible" }
  }
  const now = input.now ?? new Date()
  const [experiment, promotion] = await Promise.all([
    findActiveExperiment(prisma, input.surfaceVersion, now),
    findPromotionPointer(prisma).catch(() => null),
  ])
  if (!experiment) {
    return { assignment: null, bypassReason: "no_active_experiment" }
  }
  const semanticAa = areSemanticAaManifestsEquivalent(experiment)
  const hybridExperiment = isHybridPersonalizedExperiment(experiment)
  if (!semanticAa && !hybridExperiment) {
    return { assignment: null, bypassReason: "manifest_not_equivalent" }
  }
  if (hybridExperiment && input.profileTokenDigest == null) {
    return {
      assignment: null,
      bypassReason: "personalization_not_consented",
    }
  }
  if (hybridExperiment && !(await hasExactHybridShadowDecision(prisma, now))) {
    return { assignment: null, bypassReason: "shadow_decision_missing" }
  }
  if (!promotion) {
    return { assignment: null, bypassReason: "promotion_unavailable" }
  }
  if (
    promotion.killSwitchEnabled ||
    (promotion.stage !== "BOUNDED" && promotion.stage !== "PERMANENT") ||
    promotion.activeManifestId !== experiment.challengerManifestId
  ) {
    return { assignment: null, bypassReason: "promotion_not_active" }
  }
  const effectiveChallengerProbability =
    promotion.stage === "PERMANENT" ? 1 : promotion.exposureCeilingBps / 10_000
  if (
    !promotion.activeApproval ||
    promotion.activeApprovalId !== promotion.activeApproval.id ||
    promotion.activeApproval.manifestId !== promotion.activeManifestId ||
    promotion.activeApproval.manifestDigest !==
      recommendationManifestDigest(promotion.activeManifest) ||
    promotion.activeApproval.expiresAt <= now ||
    (promotion.stage === "BOUNDED" &&
      (promotion.exposureCeilingBps > promotion.activeApproval.maxExposureBps ||
        effectiveChallengerProbability !== experiment.challengerProbability))
  ) {
    return { assignment: null, bypassReason: "promotion_not_approved" }
  }

  const profile =
    hybridExperiment && input.profileTokenDigest
      ? await prisma.recommendationProfile.findFirst({
          where: {
            tokenDigest: input.profileTokenDigest,
            state: RecommendationProfileState.ACTIVE,
            expiresAt: { gt: now },
          },
          select: { id: true, privacyGeneration: true },
        })
      : null
  if (hybridExperiment && profile == null) {
    return {
      assignment: null,
      bypassReason: "personalization_not_consented",
    }
  }
  const unitKind = profile
    ? RecommendationExperimentUnitKind.ANONYMOUS_PROFILE
    : RecommendationExperimentUnitKind.ANONYMOUS_SESSION
  const unitDigest = digestAssignmentUnit(
    experiment.id,
    profile
      ? `profile:${profile.id}:${profile.privacyGeneration}`
      : `session:${input.sessionDigest}`,
  )
  const where = {
    experimentId_unitDigest_generation: {
      experimentId: experiment.id,
      unitDigest,
      generation: experiment.generation,
    },
  } as const
  const existing = await prisma.recommendationExperimentAssignment.findUnique({
    where,
  })
  if (existing) {
    if (
      existing.state !== RecommendationExperimentAssignmentState.ACTIVE ||
      existing.configurationDigest !== experiment.configurationDigest ||
      existing.generation !== experiment.generation ||
      existing.expiresAt <= now ||
      (profile != null &&
        (existing.profileId !== profile.id ||
          existing.privacyGeneration !== profile.privacyGeneration))
    ) {
      return { assignment: null, bypassReason: "assignment_fenced" }
    }
    return {
      assignment: assignmentContext(existing, experiment),
      bypassReason: null,
    }
  }

  const arm = chooseExperimentArm({
    unitDigest,
    configurationDigest: experiment.configurationDigest,
    challengerProbability: effectiveChallengerProbability,
  })
  const assignmentProbability =
    arm === RecommendationExperimentArm.CHALLENGER
      ? effectiveChallengerProbability
      : 1 - effectiveChallengerProbability
  const expiresAt = new Date(
    Math.min(
      experiment.endsAt.getTime(),
      now.getTime() + RECOMMENDATION_RAW_RETENTION_DAYS * 86_400_000,
    ),
  )
  try {
    const created = await prisma.recommendationExperimentAssignment.create({
      data: {
        id: randomUUID(),
        experimentId: experiment.id,
        unitKind,
        unitDigest,
        profileId: profile?.id ?? null,
        privacyGeneration: profile?.privacyGeneration ?? null,
        arm,
        assignmentProbability,
        configurationDigest: experiment.configurationDigest,
        generation: experiment.generation,
        expiresAt,
      },
    })
    return {
      assignment: assignmentContext(created, experiment),
      bypassReason: null,
    }
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    const winner = await prisma.recommendationExperimentAssignment.findUnique({
      where,
    })
    if (
      !winner ||
      winner.state !== RecommendationExperimentAssignmentState.ACTIVE ||
      winner.configurationDigest !== experiment.configurationDigest ||
      winner.generation !== experiment.generation ||
      winner.expiresAt <= now
    ) {
      return { assignment: null, bypassReason: "assignment_fenced" }
    }
    return {
      assignment: assignmentContext(winner, experiment),
      bypassReason: null,
    }
  }
}

async function findActiveExperiment(
  prisma: PrismaClient,
  surfaceVersion: string,
  now: Date,
) {
  return prisma.recommendationExperiment.findFirst({
    where: {
      state: RecommendationExperimentState.ACTIVE,
      surfaceVersion,
      startsAt: { lte: now },
      endsAt: { gt: now },
      expiresAt: { gt: now },
    },
    include: { controlManifest: true, challengerManifest: true },
    orderBy: [{ startsAt: "desc" }, { id: "asc" }],
  })
}

async function findPromotionPointer(prisma: PrismaClient) {
  return prisma.recommendationPromotionPointer.findUnique({
    where: { id: "recommendation-promotion-pointer" },
    include: { activeManifest: true, activeApproval: true },
  })
}

export function areSemanticAaManifestsEquivalent(
  experiment: ExperimentWithManifests,
): boolean {
  const control = experiment.controlManifest
  const challenger = experiment.challengerManifest
  const configuration = challenger.configuration
  if (!isRecord(configuration)) return false
  return (
    experiment.assignmentPolicyVersion ===
      RECOMMENDATION_ASSIGNMENT_POLICY_VERSION &&
    control.enabled &&
    challenger.enabled &&
    control.generator === "semantic" &&
    challenger.generator === control.generator &&
    challenger.contractVersion === control.contractVersion &&
    challenger.surfaceVersion === control.surfaceVersion &&
    challenger.maxItems === control.maxItems &&
    configuration.behaviorallyEquivalentTo === control.id &&
    configuration.completeServiceDeadlineMs === DELIVERY_RETRIEVAL_BUDGET_MS &&
    configuration.learningReads === false
  )
}

export function isHybridPersonalizedExperiment(
  experiment: ExperimentWithManifests,
): boolean {
  const control = experiment.controlManifest
  return (
    experiment.assignmentPolicyVersion ===
      RECOMMENDATION_ASSIGNMENT_POLICY_VERSION &&
    control.enabled &&
    control.generator === "semantic" &&
    control.id === "semantic-transcript-pgvector-v1" &&
    experiment.challengerManifestId === HYBRID_PERSONALIZED_MANIFEST_ID &&
    isExactHybridPersonalizedManifest(experiment.challengerManifest)
  )
}

async function hasExactHybridShadowDecision(
  prisma: PrismaClient,
  now: Date,
): Promise<boolean> {
  const decision = await prisma.recommendationShadowDecision.findFirst({
    where: {
      decision: "PROMOTE_TO_EXPERIMENT",
      expiresAt: { gt: now },
      evaluation: {
        manifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
        generatorVersion: HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
      },
    },
    select: { id: true },
  })
  return decision != null
}

export function chooseExperimentArm(input: {
  unitDigest: string
  configurationDigest: string
  challengerProbability: number
}): RecommendationExperimentArm {
  const digest = createHash("sha256")
    .update("recommendation-experiment-assignment:v1\0")
    .update(input.configurationDigest)
    .update("\0")
    .update(input.unitDigest)
    .digest()
  const bucket = digest.readUIntBE(0, 6) / 2 ** 48
  return bucket < input.challengerProbability
    ? RecommendationExperimentArm.CHALLENGER
    : RecommendationExperimentArm.CONTROL
}

function assignmentContext(
  assignment: {
    id: string
    arm: RecommendationExperimentArm
    assignmentProbability: number
    configurationDigest: string
  },
  experiment: ExperimentWithManifests,
): ExperimentAssignmentContext {
  return {
    assignmentId: assignment.id,
    experimentId: experiment.id,
    experimentVersion: experiment.experimentVersion,
    experimentGeneration: experiment.generation,
    arm:
      assignment.arm === RecommendationExperimentArm.CHALLENGER
        ? "challenger"
        : "control",
    effectiveManifestId:
      assignment.arm === RecommendationExperimentArm.CHALLENGER
        ? experiment.challengerManifestId
        : experiment.controlManifestId,
    assignmentProbability: assignment.assignmentProbability,
    configurationDigest: assignment.configurationDigest,
  }
}

function digestAssignmentUnit(experimentId: string, unit: string): string {
  return createHash("sha256")
    .update("recommendation-experiment-unit:v1\0")
    .update(experimentId)
    .update("\0")
    .update(unit)
    .digest("hex")
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}
