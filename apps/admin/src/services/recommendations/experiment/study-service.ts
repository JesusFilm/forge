import { HYBRID_CANDIDATE_GENERATOR_SET_VERSION } from "../candidate"
import { randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { hasPermission } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { ForbiddenError } from "@/services/errors"
import {
  RecommendationConflictError,
  RecommendationInputError,
} from "../errors"
import { digestValue } from "../promotion/manifest"
import { promotionEventData } from "../promotion/workflow"
import { invalidateRecommendationCandidatePools } from "../delivery.service"
import {
  PROFILE_USEFULNESS_ASSIGNMENT_POLICY_VERSION,
  PROFILE_USEFULNESS_OUTCOME_POLICY_VERSION,
} from "./assignment"
import { extractUsefulnessSnapshotInTransaction } from "./usefulness-extractor"
import {
  evaluateUsefulnessSnapshot,
  evaluateUsefulnessCalibration,
} from "./usefulness-offline"
import { assertCalibrationForProtocol } from "./study-authority"
import { lockStudyAdmissionAuthority } from "./active-study-authority"
import {
  studyCowatchBinding,
  studyManifestPairIsExact,
  studyDependencyInterruption,
  lockStudyDependenciesForEvaluation,
} from "./study-dependencies"
import { resolveCompositionQualification } from "../composition/service"
import { qualifyCowatchTrialAuthority } from "../cowatch/trial-authority.service"
import {
  parseStudyProtocol,
  parseStudyEvidence,
  studyProtocolDigest,
  studyChallengerCeilingBps,
  studyGuardrails,
  studyMatchesIncumbent,
  STUDY_POLICY_VERSION,
  type StudyProtocol,
} from "./study-protocol"

const POINTER = "recommendation-promotion-pointer"
const LOCK = 505_000_001
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
function operator(actor: Principal) {
  if (
    !actor.id ||
    actor.role === "SYSTEM" ||
    actor.studioAuthority === "delegated" ||
    !hasPermission(actor, "operate:recommendation-experiments")
  )
    throw new ForbiddenError("Study operator permission required")
  return actor.id
}

export class RecommendationStudyService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async prepare(actor: Principal, value: unknown) {
    const actorId = operator(actor),
      protocol = parseStudyProtocol(value),
      digest = studyProtocolDigest(protocol),
      now = this.now()
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK})`
        const existing = await tx.recommendationStudy.findUnique({
          where: { experimentId: protocol.studyId },
        })
        if (existing) {
          if (existing.protocolDigest !== digest)
            throw new RecommendationConflictError(
              "Study identity already binds another protocol",
            )
          return existing
        }
        if (Date.parse(protocol.startsAt) <= now.getTime())
          throw new RecommendationInputError(
            "Prepare a future enrollment interval",
          )
        await this.validateManifests(tx, protocol, now)
        if (protocol.mode === "efficacy")
          await assertCalibrationForProtocol(tx, protocol, now)
        if (protocol.composition) {
          const composition = await resolveCompositionQualification(
            tx,
            protocol.composition,
            now,
          )
          if (
            !composition ||
            composition.validUntil.getTime() <
              Date.parse(protocol.cowatch!.earliestDependencyExpiresAt)
          )
            throw new RecommendationInputError(
              "Exact reviewed composition authority does not cover the study horizon",
            )
        }
        await tx.recommendationExperiment.create({
          data: {
            id: protocol.studyId,
            experimentVersion: protocol.studyId,
            surfaceVersion: protocol.surface,
            controlManifestId: protocol.controlManifestId,
            challengerManifestId: protocol.challengerManifestId,
            assignmentPolicyVersion:
              PROFILE_USEFULNESS_ASSIGNMENT_POLICY_VERSION,
            outcomePolicyVersion: PROFILE_USEFULNESS_OUTCOME_POLICY_VERSION,
            integrityPolicyVersion: "recommendation-integrity-v1",
            evaluationPolicyVersion: STUDY_POLICY_VERSION,
            configurationDigest: digest,
            challengerProbability: 0.5,
            state: "CLOSED",
            startsAt: new Date(protocol.startsAt),
            endsAt: new Date(protocol.endsAt),
            expiresAt: new Date(protocol.expiresAt),
            retentionDays: 29,
            purpose: `profile_${protocol.mode}`,
            identityClass: "pseudonymous_assignment_digest",
            deletionBehavior: "fence_assignment_and_rebuild_evaluation",
          },
        })
        return tx.recommendationStudy.create({
          data: {
            experimentId: protocol.studyId,
            protocol: json(protocol),
            protocolDigest: digest,
            preparedById: actorId,
            expiresAt: new Date(protocol.expiresAt),
          },
        })
      },
      { isolationLevel: "Serializable" },
    )
  }

  async recordEvidence(
    actor: Principal,
    input: {
      studyId: string
      protocolDigest: string
      evidenceId: string
      evidence: unknown
    },
  ) {
    const actorId = operator(actor),
      now = this.now()
    const study = await this.prisma.recommendationStudy.findUniqueOrThrow({
      where: { experimentId: input.studyId },
    })
    if (study.protocolDigest !== input.protocolDigest)
      throw new RecommendationConflictError("Protocol changed")
    const evidence = parseStudyEvidence(
      input.evidence,
      parseStudyProtocol(study.protocol),
      now,
    )
    const inputDigest = digestValue({
      protocolDigest: study.protocolDigest,
      evidence,
    })
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK})`
      const existing = await tx.recommendationStudyEvidence.findUnique({
        where: { id: input.evidenceId },
      })
      if (existing) {
        if (
          existing.studyId !== study.experimentId ||
          existing.inputDigest !== inputDigest ||
          existing.reviewedById !== actorId
        )
          throw new RecommendationConflictError(
            "Evidence identity already used",
          )
        return existing
      }
      return tx.recommendationStudyEvidence.create({
        data: {
          id: input.evidenceId,
          studyId: study.experimentId,
          protocolDigest: study.protocolDigest,
          kind: evidence.kind,
          payload: json(evidence),
          inputDigest,
          reviewedById: actorId,
          reviewedAt: now,
          expiresAt: study.expiresAt,
        },
      })
    })
  }

  async activate(
    actor: Principal,
    input: {
      studyId: string
      protocolDigest: string
      operationId: string
      evidenceId: string
      expectedPointerGeneration: number
    },
  ) {
    const actorId = operator(actor),
      now = this.now()
    const activationInputDigest = digestValue({
      studyId: input.studyId,
      protocolDigest: input.protocolDigest,
      operationId: input.operationId,
      evidenceId: input.evidenceId,
      expectedPointerGeneration: input.expectedPointerGeneration,
      actorId,
    })
    const prepared = await this.prisma.recommendationStudy.findUniqueOrThrow({
      where: { experimentId: input.studyId },
      include: { experiment: true },
    })
    if (prepared.protocolDigest !== input.protocolDigest)
      throw new RecommendationConflictError("Protocol changed")
    const preparedProtocol = parseStudyProtocol(prepared.protocol)
    const binding = studyCowatchBinding(preparedProtocol, {
      experimentId: prepared.experimentId,
      experimentGeneration: prepared.experiment.generation,
      protocolDigest: prepared.protocolDigest,
    })
    if (binding && !prepared.activatedAt) {
      const qualification = await qualifyCowatchTrialAuthority(
        this.prisma,
        binding,
        now,
      )
      if (qualification.status === "refused")
        throw new RecommendationInputError(qualification.reason)
    }
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK})`
        const study = await tx.recommendationStudy.findUniqueOrThrow({
          where: { experimentId: input.studyId },
          include: { experiment: true },
        })
        if (study.protocolDigest !== input.protocolDigest)
          throw new RecommendationConflictError("Protocol changed")
        if (study.activationId) {
          if (
            study.activationId !== input.operationId ||
            study.activationInputDigest !== activationInputDigest
          )
            throw new RecommendationConflictError(
              "Study was already activated by another operation",
            )
          return {
            operationId: study.activationId,
            activatedAt: study.activatedAt,
            replay: true,
          }
        }
        const protocol = parseStudyProtocol(study.protocol)
        if (now >= new Date(protocol.startsAt))
          throw new RecommendationInputError(
            "Activation must precede the frozen enrollment start",
          )
        const evidence = await tx.recommendationStudyEvidence.findUniqueOrThrow(
          { where: { id: input.evidenceId } },
        )
        if (
          evidence.studyId !== study.experimentId ||
          evidence.protocolDigest !== study.protocolDigest ||
          evidence.kind !== "readiness" ||
          evidence.expiresAt <= now
        )
          throw new RecommendationInputError("Reviewed readiness is required")
        const readiness = parseStudyEvidence(evidence.payload, protocol, now)
        if (Date.parse(readiness.validUntil) <= Date.parse(protocol.startsAt))
          throw new RecommendationInputError(
            "Readiness must remain valid at enrollment start",
          )
        await this.validateManifests(tx, protocol, now)
        await lockStudyAdmissionAuthority(tx, {
          protocol,
          identity: {
            experimentId: study.experimentId,
            experimentGeneration: study.experiment.generation,
            protocolDigest: study.protocolDigest,
          },
          now,
        })
        if (protocol.mode === "efficacy")
          await assertCalibrationForProtocol(tx, protocol, now)
        const overlap = await tx.recommendationExperiment.findFirst({
          where: {
            id: { not: study.experimentId },
            assignmentPolicyVersion:
              PROFILE_USEFULNESS_ASSIGNMENT_POLICY_VERSION,
            state: "ACTIVE",
            startsAt: {
              lt: new Date(Date.parse(protocol.endsAt) + 86_400_000),
            },
            endsAt: {
              gt: new Date(Date.parse(protocol.startsAt) - 86_400_000),
            },
          },
          select: { id: true },
        })
        if (overlap)
          throw new RecommendationConflictError(
            "Study overlaps an enrolled cohort or its follow-up",
          )
        const pointer =
          await tx.recommendationPromotionPointer.findUniqueOrThrow({
            where: { id: POINTER },
          })
        if (
          pointer.generation !== input.expectedPointerGeneration ||
          pointer.killSwitchEnabled ||
          pointer.stage === "PERMANENT"
        )
          throw new RecommendationConflictError(
            "Promotion state changed or is held",
          )
        if (pointer.stage === "BOUNDED") {
          const active = await tx.recommendationExperiment.findFirst({
            where: {
              state: "ACTIVE",
              challengerManifestId: pointer.activeManifestId,
              endsAt: { gt: new Date(now.getTime() - 86_400_000) },
            },
            select: { id: true },
          })
          if (active)
            throw new RecommendationConflictError(
              "Existing bounded follow-up is still active",
            )
        }
        const ceiling = studyChallengerCeilingBps(protocol)
        const approval = await tx.recommendationPromotionApproval.upsert({
          where: {
            manifestId_manifestDigest_maxExposureBps: {
              manifestId: protocol.challengerManifestId,
              manifestDigest: protocol.challengerManifestDigest,
              maxExposureBps: ceiling,
            },
          },
          update: {},
          create: {
            manifestId: protocol.challengerManifestId,
            manifestDigest: protocol.challengerManifestDigest,
            maxExposureBps: ceiling,
            approvedById: actorId,
            expiresAt: new Date(now.getTime() + 2555 * 86_400_000),
          },
        })
        const updated = await tx.recommendationPromotionPointer.updateMany({
          where: { id: POINTER, generation: pointer.generation },
          data: {
            activeManifestId: protocol.challengerManifestId,
            activeApprovalId: approval.id,
            stage: "BOUNDED",
            exposureCeilingBps: ceiling,
            generation: { increment: 1 },
            reasonCode: `profile_${protocol.mode}_active`,
          },
        })
        if (updated.count !== 1)
          throw new RecommendationConflictError("Promotion state changed")
        await tx.recommendationExperiment.update({
          where: { id: study.experimentId },
          data: { state: "ACTIVE" },
        })
        await tx.recommendationStudy.update({
          where: { experimentId: study.experimentId },
          data: {
            activationId: input.operationId,
            activationInputDigest,
            activatedAt: now,
          },
        })
        await tx.recommendationPromotionEvent.create({
          data: promotionEventData({
            id: randomUUID(),
            dedupeKey: `study-activation:${input.operationId}`,
            eventType: "ACTIVATION_EFFECTIVE",
            approvalId: approval.id,
            fromManifestId: pointer.activeManifestId,
            toManifestId: protocol.challengerManifestId,
            fromStage: pointer.stage,
            toStage: "BOUNDED",
            pointerGeneration: pointer.generation + 1,
            exposureCeilingBps: ceiling,
            actorClass: "admin",
            actorId,
            reasonCode: `profile_${protocol.mode}_active`,
            inputDigest: study.protocolDigest,
            details: {
              studyId: study.experimentId,
              operationId: input.operationId,
              readinessEvidenceId: evidence.id,
              admissionBps: protocol.admissionBps,
              challengerProbability: 0.5,
              notUsefulnessEvidence: protocol.mode === "calibration",
            },
            now,
          }),
        })
        return {
          operationId: input.operationId,
          activatedAt: now,
          replay: false,
        }
      },
      { isolationLevel: "Serializable" },
    )
    invalidateRecommendationCandidatePools()
    return result
  }

  async status(actor: Principal, studyId?: string) {
    operator(actor)
    return this.prisma.recommendationStudy.findMany({
      where: studyId ? { experimentId: studyId } : {},
      take: studyId ? 1 : 20,
      orderBy: { preparedAt: "desc" },
      include: {
        experiment: true,
        evidence: { orderBy: { reviewedAt: "desc" }, take: 4 },
        evaluations: {
          orderBy: { evaluation: { revision: "desc" } },
          take: 1,
          include: { evaluation: true },
        },
      },
    })
  }

  async evaluate(
    actor: Principal,
    input: {
      studyId: string
      protocolDigest: string
      operationId: string
      evidenceId: string
    },
  ) {
    const actorId = operator(actor)
    const existing =
      await this.prisma.recommendationExperimentEvaluation.findUnique({
        where: { runId: input.operationId },
      })
    if (existing) {
      if (existing.experimentId !== input.studyId)
        throw new RecommendationConflictError(
          "Evaluation operation belongs to another study",
        )
      const authority =
        await this.prisma.recommendationStudyEvaluation.findUniqueOrThrow({
          where: { evaluationId: existing.id },
        })
      if (
        authority.protocolDigest !== input.protocolDigest ||
        authority.evidenceId !== input.evidenceId ||
        authority.publishedById !== actorId
      )
        throw new RecommendationConflictError(
          "Evaluation operation inputs changed",
        )
      return authority
    }
    const study = await this.prisma.recommendationStudy.findUniqueOrThrow({
      where: { experimentId: input.studyId },
      include: { experiment: true },
    })
    const protocol = parseStudyProtocol(study.protocol)
    if (!study.activatedAt || input.protocolDigest !== study.protocolDigest)
      throw new RecommendationInputError("An activated exact study is required")
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK})`
        await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
        await lockStudyDependenciesForEvaluation(
          tx,
          protocol,
          {
            experimentId: study.experimentId,
            experimentGeneration: study.experiment.generation,
            protocolDigest: study.protocolDigest,
          },
          this.now(),
        )
        // Source writers use the matching shared lock. READ COMMITTED observes
        // every writer that committed while this publication was waiting.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${study.experimentId}, 505505))`
        await tx.$queryRaw`SELECT experiment_id FROM recommendation_study WHERE experiment_id = ${study.experimentId} FOR UPDATE`
        const replay = await tx.recommendationStudyEvaluation.findFirst({
          where: { evaluation: { runId: input.operationId } },
        })
        if (replay) {
          if (
            replay.studyId !== input.studyId ||
            replay.protocolDigest !== input.protocolDigest ||
            replay.evidenceId !== input.evidenceId ||
            replay.publishedById !== actorId
          )
            throw new RecommendationConflictError(
              "Evaluation operation inputs changed",
            )
          return replay
        }
        const current = await tx.recommendationStudy.findUniqueOrThrow({
          where: { experimentId: study.experimentId },
          include: { experiment: true },
        })
        if (current.experiment.generation !== study.experiment.generation)
          throw new RecommendationConflictError(
            "Study generation changed before extraction",
          )
        const now = this.now()
        const { snapshot, sourceAuthorityExpiresAt } =
          await extractUsefulnessSnapshotInTransaction(tx, {
            experimentId: study.experimentId,
            configurationDigest: study.protocolDigest,
            enrollmentStart: new Date(protocol.startsAt),
            enrollmentEnd: new Date(protocol.endsAt),
            plannedAssignmentsPerArm: protocol.plannedAssignmentsPerArm,
            minimumUsefulDelta: protocol.minimumUsefulDelta,
          })
        const receipt = await tx.recommendationStudyEvidence.findUniqueOrThrow({
          where: { id: input.evidenceId },
        })
        if (
          receipt.studyId !== study.experimentId ||
          receipt.protocolDigest !== study.protocolDigest
        )
          throw new RecommendationInputError(
            "Evidence belongs to another protocol",
          )
        const evidence = parseStudyEvidence(receipt.payload, protocol, now)
        if (evidence.kind !== "outcomes")
          throw new RecommendationInputError(
            "Mature outcome guardrail evidence is required",
          )
        const interruptions: string[] = []
        if (sourceAuthorityExpiresAt <= new Date(snapshot.capturedAt))
          interruptions.push("captured_source_expiry_unhealthy")
        try {
          await this.validateManifests(tx, protocol, now)
        } catch (error) {
          if (!(error instanceof RecommendationInputError)) throw error
          interruptions.push("study_manifest_or_shadow_authority_interrupted")
        }
        let aaPassed = protocol.mode === "calibration"
        if (protocol.mode === "efficacy") {
          try {
            // Retrospective proof needs coverage through the frozen horizon,
            // not a fresh serving authorization after follow-up has ended.
            await assertCalibrationForProtocol(
              tx,
              protocol,
              new Date(Date.parse(protocol.endsAt) + 30 * 3_600_000 - 1),
            )
            aaPassed = true
          } catch (error) {
            if (!(error instanceof RecommendationInputError)) throw error
            interruptions.push("calibration_authority_interrupted")
          }
        }
        const sourceInterruption = await studyDependencyInterruption(
          tx,
          protocol,
          {
            experimentId: study.experimentId,
            experimentGeneration: study.experiment.generation,
            protocolDigest: study.protocolDigest,
          },
        )
        if (sourceInterruption) interruptions.push(sourceInterruption)
        const guardrails = studyGuardrails(evidence)
        snapshot.health.assignmentLedgerCount = current.enrolledCount
        snapshot.health.aaPassed = aaPassed
        snapshot.health.guardrailsPassed = guardrails.passed
        let assessment =
          protocol.mode === "calibration"
            ? evaluateUsefulnessCalibration(snapshot)
            : evaluateUsefulnessSnapshot(snapshot)
        if (interruptions.length)
          assessment = {
            ...assessment,
            decision: "data_unhealthy",
            reasonCodes: [...assessment.reasonCodes, ...interruptions],
            uncertainty: null,
          }
        const decision = assessment.decision
        const result = {
          ...assessment,
          decision,
          mode: protocol.mode,
          comparatorMatchesIncumbent: studyMatchesIncumbent(protocol),
          effectAttribution:
            protocol.comparison === "incumbent-cowatch-mmr"
              ? "combined-cowatch-and-mmr-only"
              : protocol.comparison,
          permanentDefaultAuthority: false,
          calibration:
            protocol.mode === "calibration"
              ? calibrationSummary(snapshot.units)
              : null,
          externalEvidenceDigest: receipt.inputDigest,
          externalGuardrails: guardrails,
        }
        const previous = await tx.recommendationExperimentEvaluation.findFirst({
          where: { experimentId: study.experimentId },
          orderBy: { revision: "desc" },
        })
        const revision = (previous?.revision ?? 0) + 1
        const expiresAt = new Date(
          Math.min(
            sourceAuthorityExpiresAt.getTime(),
            study.expiresAt.getTime(),
            protocol.mode === "calibration"
              ? Infinity
              : Date.parse(evidence.validUntil),
          ),
        )
        // Publication changes the row once, so a source writer using an older
        // repeatable snapshot cannot miss the first published authority.
        const publishedStudy = await tx.recommendationStudy.update({
          where: { experimentId: study.experimentId },
          data: { privacyRevision: { increment: 1 } },
        })
        await tx.recommendationExperimentEvaluationRun.create({
          data: {
            id: input.operationId,
            experimentId: study.experimentId,
            windowStart: new Date(protocol.startsAt),
            windowEnd: new Date(protocol.endsAt),
            generation: revision,
            state: "COMPLETED",
            completedAt: now,
            expiresAt: study.expiresAt,
          },
        })
        const evaluation = await tx.recommendationExperimentEvaluation.create({
          data: {
            experimentId: study.experimentId,
            runId: input.operationId,
            revision,
            supersedesId: previous?.id ?? null,
            state:
              decision === "improve" || decision === "calibration_pass"
                ? "PASS"
                : decision === "no_benefit"
                  ? "FAIL"
                  : decision === "data_unhealthy"
                    ? "DATA_UNHEALTHY"
                    : "INCONCLUSIVE",
            windowStart: new Date(protocol.startsAt),
            windowEnd: new Date(protocol.endsAt),
            inputCapturedAt: new Date(snapshot.capturedAt),
            assignmentPolicyVersion: study.experiment.assignmentPolicyVersion,
            outcomePolicyVersion: study.experiment.outcomePolicyVersion,
            integrityPolicyVersion: study.experiment.integrityPolicyVersion,
            evaluationPolicyVersion: STUDY_POLICY_VERSION,
            purpose: `profile_${protocol.mode}_v2`,
            retentionDays: 29,
            inputDigest: digestValue({
              input: assessment.inputDigest,
              evidence: receipt.inputDigest,
              privacyRevision: publishedStudy.privacyRevision,
              protocol: study.protocolDigest,
            }),
            counts: json({
              control: assessment.control,
              challenger: assessment.challenger,
              health: snapshot.health,
            }),
            intentToTreat: json(result),
            exposedOnly: {},
            uncertainty: json(assessment.uncertainty ?? { available: false }),
            guardrails: json(guardrails),
            sampleRatio: json(assessment.sampleRatio),
            reasonCodes: assessment.reasonCodes,
            evaluatedAt: now,
            expiresAt: study.expiresAt,
          },
        })
        return tx.recommendationStudyEvaluation.create({
          data: {
            evaluationId: evaluation.id,
            studyId: study.experimentId,
            protocolDigest: study.protocolDigest,
            experimentGeneration: study.experiment.generation,
            privacyRevision: publishedStudy.privacyRevision,
            evidenceId: receipt.id,
            publishedById: actorId,
            mode: protocol.mode,
            result: json(result),
            expiresAt,
          },
        })
      },
      { isolationLevel: "ReadCommitted", timeout: 20_000, maxWait: 2_000 },
    )
  }

  private async validateManifests(
    tx: Prisma.TransactionClient,
    p: StudyProtocol,
    now: Date,
  ) {
    const [control, challenger] = await Promise.all([
      tx.recommendationStrategyManifest.findUnique({
        where: { id: p.controlManifestId },
      }),
      tx.recommendationStrategyManifest.findUnique({
        where: { id: p.challengerManifestId },
      }),
    ])
    if (
      !control ||
      !challenger ||
      !studyManifestPairIsExact(p, control, challenger)
    )
      throw new RecommendationInputError(
        "Exact study manifests are unavailable or changed",
      )
    if (p.comparison === "semantic-profile") {
      const decision = await tx.recommendationShadowDecision.findFirst({
        where: {
          decision: "PROMOTE_TO_EXPERIMENT",
          expiresAt: { gt: now },
          evaluation: {
            manifestId: p.challengerManifestId,
            generatorVersion: HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
          },
        },
        select: { id: true },
      })
      if (!decision)
        throw new RecommendationInputError(
          "Exact challenger shadow authority is missing",
        )
    }
  }
}
function calibrationSummary(units: { arm: string; qualifiedViews: number }[]) {
  return ["control", "challenger"].map((arm) => {
    const values = units
      .filter((u) => u.arm === arm)
      .map((u) => u.qualifiedViews)
    const mean = values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : 0
    return {
      arm,
      assigned: values.length,
      mean,
      variance:
        values.length > 1
          ? values.reduce((a, b) => a + (b - mean) ** 2, 0) /
            (values.length - 1)
          : null,
    }
  })
}
