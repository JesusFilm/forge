import { createHash, randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { env } from "@/config/env"
import { ForbiddenError } from "@/services/errors"
import { recommendationManifestDigest } from "../promotion/manifest"
import {
  PRECOMPUTED_VISIT_ASSIGNMENT_POLICY,
  PRECOMPUTED_VISIT_DELIVERY_POLICY,
  readControlRouting,
} from "./visit-admission"
import { PRECOMPUTED_WATCH_PREVIEW_MANIFEST_ID } from "./watch-delivery"
import {
  PRECOMPUTED_CTR_METHOD,
  precomputedCtrPolicyDigest,
  type PrecomputedCtrReport,
} from "./ctr-report"
import { validateCtrPolicySettings, type CtrPolicySettings } from "./ctr-policy"
import { oneUtcCalendarMonthAfter } from "./cohort-window"

export const PRECOMPUTED_PUBLIC_CONTROL_ID = "precomputed-watch-public-control"
export const PRECOMPUTED_PUBLIC_ELIGIBILITY_POLICY =
  "public-watch-verified-human-v1"
export const PRECOMPUTED_PUBLIC_LIVE_ELIGIBILITY_POLICY =
  "public-watch-turnstile-verified-browser-v1"
const EXPERIMENT_RETENTION_MS = 365 * 86_400_000
const BROWSER_COOKIE_LIFETIME_MS = 180 * 86_400_000
const HEX_DIGEST = /^[a-f0-9]{64}$/
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,190}$/

export class PrecomputedPublicControlError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "stale_control"
      | "incompatible_target"
      | "readiness_unavailable"
      | "fixture_authority_unavailable",
  ) {
    super(code)
    this.name = "PrecomputedPublicControlError"
  }
}

function digest(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex")
}

/** A fixture result is never a live measurement certificate. Guard the
 * producer, not just the caller-provided authority label. */
export async function assertIsolatedPrecomputedControlFixture(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<void> {
  const url = new URL(env.DATABASE_URL)
  if (
    env.NODE_ENV !== "test" ||
    env.RECOMMENDATION_DB_TEST !== "1" ||
    env.RECOMMENDATION_PRECOMPUTED_TEST_ENABLED !== "1" ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
  )
    throw new PrecomputedPublicControlError("fixture_authority_unavailable")
  const [database] = await prisma.$queryRaw<
    Array<{ name: string; schema: string }>
  >`SELECT current_database() AS name, current_schema() AS schema`
  if (
    !["forge_capacity", "forge_precomputed_control_test"].includes(
      database?.name ?? "",
    ) ||
    !/^(precomputed_public_|catalog_producer_)[a-zA-Z0-9_]+$/.test(
      database?.schema ?? "",
    )
  )
    throw new PrecomputedPublicControlError("fixture_authority_unavailable")
}

export type PrecomputedPublicControl = {
  mode: "incumbent" | "ab" | "promoted"
  version: number
  experimentId: string | null
  generationId: string | null
  configurationDigest: string | null
  controlRoutingDigest: string | null
  sourceSetDigest: string | null
  startsAt: string | null
  endsAt: string | null
  authority: "isolated_fixture" | "live_verified" | null
  reportRevision: number | null
  reportEvidenceDigest: string | null
  retainedExperimentId: string | null
  pendingManualReview: {
    experimentId: string
    generationId: string
    endsAt: string
  } | null
}

/** Builds, CTR reads, and model workers cannot change this pointer. A missing
 * or incompatible row always reads as incumbent. The version remains visible
 * so an operator can diagnose a stale control instead of accepting it. */
export async function loadPrecomputedPublicControl(
  prisma: PrismaClient | Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<PrecomputedPublicControl> {
  const row = await prisma.recommendationPrecomputedPublicControl.findUnique({
    where: { id: PRECOMPUTED_PUBLIC_CONTROL_ID },
    include: { activeExperiment: { include: { generation: true } } },
  })
  const experiment = row?.activeExperiment
  const pendingManualReview =
    row?.mode === "ab" && experiment && now >= experiment.endsAt
      ? {
          experimentId: experiment.id,
          generationId: experiment.generationId,
          endsAt: experiment.endsAt.toISOString(),
        }
      : null
  const active =
    !pendingManualReview &&
    experiment?.state === "public_ready" &&
    experiment.generation.status === "complete" &&
    experiment.generation.sourceSetDigest === experiment.sourceSetDigest &&
    (row?.authority !== "isolated_fixture" ||
      (env.NODE_ENV === "test" &&
        env.RECOMMENDATION_DB_TEST === "1" &&
        env.RECOMMENDATION_PRECOMPUTED_TEST_ENABLED === "1"))
  const mode =
    active && (row?.mode === "ab" || row?.mode === "promoted")
      ? row.mode
      : "incumbent"
  return {
    mode,
    version: row?.version ?? 1,
    experimentId: mode === "incumbent" ? null : experiment!.id,
    generationId: mode === "incumbent" ? null : experiment!.generationId,
    configurationDigest:
      mode === "incumbent" ? null : experiment!.configurationDigest,
    controlRoutingDigest:
      mode === "incumbent" ? null : experiment!.controlRoutingDigest,
    sourceSetDigest: mode === "incumbent" ? null : experiment!.sourceSetDigest,
    startsAt: mode === "incumbent" ? null : experiment!.startsAt.toISOString(),
    endsAt: mode === "incumbent" ? null : experiment!.endsAt.toISOString(),
    authority:
      mode === "incumbent"
        ? null
        : (row?.authority as PrecomputedPublicControl["authority"]),
    reportRevision: mode === "promoted" ? row!.reportRevision : null,
    reportEvidenceDigest:
      mode === "promoted" ? row!.reportEvidenceDigest : null,
    retainedExperimentId: row?.retainedExperimentId ?? null,
    pendingManualReview,
  }
}

/** Freeze a separate public candidate. No serving pointer changes here. The
 * live evidence verifier is intentionally absent until trusted human/bot,
 * tracking-loss, build and capacity reports can be bound to this identity. */
export async function preparePrecomputedPublicExperiment(
  prisma: PrismaClient,
  input: {
    id: string
    generationId: string
    startsAt: Date
    endsAt: Date
    expectedControlRoutingDigest: string
    expectedSourceSetDigest: string
    policySettings: CtrPolicySettings
    authority: "isolated_fixture" | "live_verified"
    operator: Principal | null
  },
) {
  if (!hasPermission(input.operator, "operate:recommendation-experiments"))
    throw new ForbiddenError()
  if (
    !ID.test(input.id) ||
    !ID.test(input.generationId) ||
    !HEX_DIGEST.test(input.expectedControlRoutingDigest) ||
    !HEX_DIGEST.test(input.expectedSourceSetDigest) ||
    !Number.isFinite(input.startsAt.getTime()) ||
    !Number.isFinite(input.endsAt.getTime()) ||
    input.endsAt.getTime() !==
      oneUtcCalendarMonthAfter(input.startsAt).getTime() ||
    input.endsAt.getTime() - input.startsAt.getTime() >=
      BROWSER_COOKIE_LIFETIME_MS
  )
    throw new PrecomputedPublicControlError("invalid_input")
  validateCtrPolicySettings(input.policySettings)
  if (input.authority !== "isolated_fixture")
    throw new PrecomputedPublicControlError("readiness_unavailable")
  await assertIsolatedPrecomputedControlFixture(prisma)
  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM recommendation_precomputed_generation
      WHERE id = ${input.generationId} FOR SHARE`
    if (!locked) throw new PrecomputedPublicControlError("incompatible_target")
    const [generation, routing, challenger] = await Promise.all([
      tx.recommendationPrecomputedGeneration.findUnique({
        where: { id: input.generationId },
      }),
      readControlRouting(tx),
      tx.recommendationStrategyManifest.findUnique({
        where: { id: PRECOMPUTED_WATCH_PREVIEW_MANIFEST_ID },
      }),
    ])
    if (
      generation?.status !== "complete" ||
      generation.sourceSetDigest !== input.expectedSourceSetDigest ||
      routing?.routingDigest !== input.expectedControlRoutingDigest ||
      !challenger ||
      challenger.enabled
    )
      throw new PrecomputedPublicControlError("incompatible_target")
    const sources = await tx.recommendationPrecomputedSource.count({
      where: { generationId: generation.id },
    })
    if (sources !== generation.expectedSourceCount)
      throw new PrecomputedPublicControlError("incompatible_target")
    const configurationDigest = digest([
      "precomputed-public-configuration-v1",
      input.id,
      generation.id,
      generation.sourceSetDigest,
      routing.manifest.id,
      routing.manifestDigest,
      routing.routingDigest,
      challenger.id,
      PRECOMPUTED_VISIT_ASSIGNMENT_POLICY,
      PRECOMPUTED_PUBLIC_ELIGIBILITY_POLICY,
      PRECOMPUTED_VISIT_DELIVERY_POLICY,
      precomputedCtrPolicyDigest(input.policySettings),
      input.startsAt.toISOString(),
      input.endsAt.toISOString(),
    ])
    const prepared = await tx.recommendationPrecomputedExperiment.create({
      data: {
        id: input.id,
        generationId: generation.id,
        controlManifestId: routing.manifest.id,
        challengerManifestId: challenger.id,
        controlManifestDigest: recommendationManifestDigest(routing.manifest),
        controlRoutingDigest: routing.routingDigest,
        sourceSetDigest: generation.sourceSetDigest,
        assignmentPolicyVersion: PRECOMPUTED_VISIT_ASSIGNMENT_POLICY,
        eligibilityPolicyVersion: PRECOMPUTED_PUBLIC_ELIGIBILITY_POLICY,
        deliveryPolicyVersion: PRECOMPUTED_VISIT_DELIVERY_POLICY,
        configurationDigest,
        state: "public_ready",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        expiresAt: new Date(input.endsAt.getTime() + EXPERIMENT_RETENTION_MS),
      },
    })
    await tx.recommendationPrecomputedCtrPolicy.create({
      data: {
        experimentId: input.id,
        version: PRECOMPUTED_CTR_METHOD,
        method: PRECOMPUTED_CTR_METHOD,
        settings: input.policySettings,
        lateEventCutoffHours: input.policySettings.lateEventCutoffHours,
        settingsDigest: precomputedCtrPolicyDigest(input.policySettings),
        authority: "fixture_only",
      },
    })
    return prepared
  })
}

/** The first public selection is an explicit compare-and-swap. It requires a
 * frozen complete cohort, intact incumbent routing, predeclared policy and a
 * capacity receipt. Native fixtures can rehearse this transition; live use
 * remains unavailable until an authenticated measurement qualifier exists. */
export async function startPrecomputedPublicExperiment(
  prisma: PrismaClient,
  input: {
    experimentId: string
    expectedConfigurationDigest: string
    expectedControlVersion: number
    authority: "isolated_fixture" | "live_verified"
    operator: Principal | null
    now?: Date
  },
): Promise<PrecomputedPublicControl> {
  if (!hasPermission(input.operator, "operate:recommendation-experiments"))
    throw new ForbiddenError()
  if (
    !input.operator?.id ||
    !ID.test(input.experimentId) ||
    !HEX_DIGEST.test(input.expectedConfigurationDigest) ||
    !Number.isSafeInteger(input.expectedControlVersion) ||
    input.expectedControlVersion < 1
  )
    throw new PrecomputedPublicControlError("invalid_input")
  if (input.authority !== "isolated_fixture")
    throw new PrecomputedPublicControlError("readiness_unavailable")
  await assertIsolatedPrecomputedControlFixture(prisma)
  const now = input.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    const [pointer] = await tx.$queryRaw<
      Array<{ version: number; mode: string }>
    >`SELECT version, mode FROM recommendation_precomputed_public_control
      WHERE id = ${PRECOMPUTED_PUBLIC_CONTROL_ID} FOR UPDATE`
    if (!pointer || pointer.version !== input.expectedControlVersion)
      throw new PrecomputedPublicControlError("stale_control")
    if (pointer.mode !== "incumbent")
      throw new PrecomputedPublicControlError("incompatible_target")
    const [experiment] = await tx.$queryRaw<Array<{ generation_id: string }>>`
      SELECT generation_id FROM recommendation_precomputed_experiment
      WHERE id = ${input.experimentId} FOR SHARE`
    if (!experiment)
      throw new PrecomputedPublicControlError("incompatible_target")
    await tx.$queryRaw`SELECT id FROM recommendation_precomputed_generation
      WHERE id = ${experiment.generation_id} FOR SHARE`
    await tx.$queryRaw`SELECT id FROM recommendation_serving_control
      WHERE id = 'recommendation-serving-control' FOR SHARE`
    await tx.$queryRaw`SELECT id FROM recommendation_promotion_pointer
      WHERE id = 'recommendation-promotion-pointer' FOR SHARE`
    const [frozen, routing, policy, visits, reports] = await Promise.all([
      tx.recommendationPrecomputedExperiment.findUnique({
        where: { id: input.experimentId },
        include: { generation: true },
      }),
      readControlRouting(tx),
      tx.recommendationPrecomputedCtrPolicy.findUnique({
        where: { experimentId: input.experimentId },
      }),
      tx.recommendationPrecomputedVisit.count({
        where: { experimentId: input.experimentId },
      }),
      tx.recommendationPrecomputedCtrReport.count({
        where: { experimentId: input.experimentId },
      }),
    ])
    if (
      frozen?.state !== "public_ready" ||
      frozen.configurationDigest !== input.expectedConfigurationDigest ||
      frozen.generation.status !== "complete" ||
      frozen.generation.protocolVersion !== 2 ||
      frozen.generation.sourceSetDigest !== frozen.sourceSetDigest ||
      (frozen.generation.capacityPreflight as { status?: string } | null)
        ?.status !== "passed" ||
      routing?.routingDigest !== frozen.controlRoutingDigest ||
      routing.manifest.id !== frozen.controlManifestId ||
      routing.manifestDigest !== frozen.controlManifestDigest ||
      policy?.authority !== "fixture_only" ||
      policy.method !== PRECOMPUTED_CTR_METHOD ||
      policy.version !== PRECOMPUTED_CTR_METHOD ||
      policy.settingsDigest !==
        precomputedCtrPolicyDigest(policy.settings as CtrPolicySettings) ||
      visits !== 0 ||
      reports !== 0 ||
      now < frozen.startsAt ||
      now >= frozen.endsAt
    )
      throw new PrecomputedPublicControlError("incompatible_target")
    const updated = await tx.recommendationPrecomputedPublicControl.updateMany({
      where: {
        id: PRECOMPUTED_PUBLIC_CONTROL_ID,
        version: input.expectedControlVersion,
        mode: "incumbent",
      },
      data: {
        version: { increment: 1 },
        mode: "ab",
        activeExperimentId: frozen.id,
        retainedExperimentId: null,
        authority: input.authority,
        reportRevision: null,
        reportEvidenceDigest: null,
      },
    })
    if (updated.count !== 1)
      throw new PrecomputedPublicControlError("stale_control")
    await tx.recommendationPrecomputedPublicControlEvent.create({
      data: {
        id: randomUUID(),
        controlVersion: input.expectedControlVersion + 1,
        action: "start",
        actorId: input.operator!.id!,
        experimentId: frozen.id,
        generationId: frozen.generationId,
        authority: input.authority,
        expiresAt: new Date(now.getTime() + EXPERIMENT_RETENTION_MS),
      },
    })
    return loadPrecomputedPublicControl(tx, now)
  })
}

/** Manual CAS promotion consumes an immutable final CTR revision. A report
 * cannot select its own winner or move traffic; only this operator action
 * changes the pointer after checking the exact saved evidence digest. */
export async function promotePrecomputedPublicExperiment(
  prisma: PrismaClient,
  input: {
    expectedControlVersion: number
    expectedExperimentId: string
    expectedGenerationId: string
    expectedReportRevision: number
    expectedReportEvidenceDigest: string
    operator: Principal | null
    now?: Date
  },
): Promise<PrecomputedPublicControl> {
  if (!hasPermission(input.operator, "operate:recommendation-experiments"))
    throw new ForbiddenError()
  if (
    !input.operator?.id ||
    !Number.isSafeInteger(input.expectedControlVersion) ||
    input.expectedControlVersion < 1 ||
    !ID.test(input.expectedExperimentId) ||
    !ID.test(input.expectedGenerationId) ||
    !Number.isSafeInteger(input.expectedReportRevision) ||
    input.expectedReportRevision < 1 ||
    !HEX_DIGEST.test(input.expectedReportEvidenceDigest)
  )
    throw new PrecomputedPublicControlError("invalid_input")
  const now = input.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ version: number }>>`
      SELECT version FROM recommendation_precomputed_public_control
      WHERE id = ${PRECOMPUTED_PUBLIC_CONTROL_ID} FOR UPDATE`
    if (!locked || locked.version !== input.expectedControlVersion)
      throw new PrecomputedPublicControlError("stale_control")
    const pointer =
      await tx.recommendationPrecomputedPublicControl.findUniqueOrThrow({
        where: { id: PRECOMPUTED_PUBLIC_CONTROL_ID },
        include: { activeExperiment: { include: { generation: true } } },
      })
    const experiment = pointer.activeExperiment
    if (
      pointer.mode !== "ab" ||
      !experiment ||
      experiment.id !== input.expectedExperimentId ||
      experiment.generationId !== input.expectedGenerationId ||
      experiment.state !== "public_ready" ||
      experiment.generation.status !== "complete" ||
      experiment.generation.sourceSetDigest !== experiment.sourceSetDigest
    )
      throw new PrecomputedPublicControlError("incompatible_target")
    if (pointer.authority === "isolated_fixture")
      await assertIsolatedPrecomputedControlFixture(tx)
    else throw new PrecomputedPublicControlError("readiness_unavailable")
    await tx.$queryRaw`SELECT id FROM recommendation_precomputed_generation
      WHERE id = ${experiment.generationId} FOR SHARE`
    await tx.$queryRaw`SELECT id FROM recommendation_serving_control
      WHERE id = 'recommendation-serving-control' FOR SHARE`
    await tx.$queryRaw`SELECT id FROM recommendation_promotion_pointer
      WHERE id = 'recommendation-promotion-pointer' FOR SHARE`
    const [reportRow, routing] = await Promise.all([
      tx.recommendationPrecomputedCtrReport.findUnique({
        where: {
          experimentId_revision: {
            experimentId: experiment.id,
            revision: input.expectedReportRevision,
          },
        },
      }),
      readControlRouting(tx),
    ])
    const report = reportRow?.result as PrecomputedCtrReport | undefined
    if (
      !reportRow?.isFinal ||
      reportRow.evidenceDigest !== input.expectedReportEvidenceDigest ||
      report?.isFinal !== true ||
      report.revision !== reportRow.revision ||
      report.experimentId !== experiment.id ||
      report.generationId !== experiment.generationId ||
      report.configurationDigest !== experiment.configurationDigest ||
      report.sourceSetDigest !== experiment.sourceSetDigest ||
      report.controlRoutingDigest !== experiment.controlRoutingDigest ||
      report.policy.digest !== reportRow.policyDigest ||
      report.evidenceBasis !== "isolated_fixture" ||
      report.outcome !== "challenger" ||
      report.reasons.length !== 0 ||
      routing?.routingDigest !== experiment.controlRoutingDigest
    )
      throw new PrecomputedPublicControlError("incompatible_target")
    const updated = await tx.recommendationPrecomputedPublicControl.updateMany({
      where: {
        id: PRECOMPUTED_PUBLIC_CONTROL_ID,
        version: input.expectedControlVersion,
        mode: "ab",
        activeExperimentId: experiment.id,
      },
      data: {
        version: { increment: 1 },
        mode: "promoted",
        reportRevision: reportRow.revision,
        reportEvidenceDigest: reportRow.evidenceDigest,
      },
    })
    if (updated.count !== 1)
      throw new PrecomputedPublicControlError("stale_control")
    await tx.recommendationPrecomputedPublicControlEvent.create({
      data: {
        id: randomUUID(),
        controlVersion: input.expectedControlVersion + 1,
        action: "promote",
        actorId: input.operator!.id!,
        experimentId: experiment.id,
        generationId: experiment.generationId,
        reportRevision: reportRow.revision,
        reportEvidenceDigest: reportRow.evidenceDigest,
        authority: pointer.authority,
        expiresAt: new Date(now.getTime() + EXPERIMENT_RETENTION_MS),
      },
    })
    return loadPrecomputedPublicControl(tx)
  })
}

/** Rollback only changes the public selection. The frozen experiment, CTR
 * revisions and issued request/visit bindings remain available through their
 * ordinary lifetimes. A retained FK pins the old generation for later review. */
export async function rollbackPrecomputedPublicExperiment(
  prisma: PrismaClient,
  input: {
    expectedControlVersion: number
    expectedExperimentId: string
    expectedGenerationId: string
    expectedReportRevision: number | null
    expectedReportEvidenceDigest?: string | null
    reasonCode: string
    operator: Principal | null
    now?: Date
  },
): Promise<PrecomputedPublicControl> {
  if (!hasPermission(input.operator, "rollback:recommendations"))
    throw new ForbiddenError()
  if (
    !input.operator?.id ||
    !Number.isSafeInteger(input.expectedControlVersion) ||
    input.expectedControlVersion < 1 ||
    !ID.test(input.expectedExperimentId) ||
    !ID.test(input.expectedGenerationId) ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(input.reasonCode) ||
    (input.expectedReportRevision !== null &&
      (!Number.isSafeInteger(input.expectedReportRevision) ||
        input.expectedReportRevision < 1)) ||
    (input.expectedReportEvidenceDigest != null &&
      !HEX_DIGEST.test(input.expectedReportEvidenceDigest))
  )
    throw new PrecomputedPublicControlError("invalid_input")
  const now = input.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ version: number }>>`
      SELECT version FROM recommendation_precomputed_public_control
      WHERE id = ${PRECOMPUTED_PUBLIC_CONTROL_ID} FOR UPDATE`
    if (!locked || locked.version !== input.expectedControlVersion)
      throw new PrecomputedPublicControlError("stale_control")
    const pointer =
      await tx.recommendationPrecomputedPublicControl.findUniqueOrThrow({
        where: { id: PRECOMPUTED_PUBLIC_CONTROL_ID },
        include: { activeExperiment: true },
      })
    if (
      !["ab", "promoted"].includes(pointer.mode) ||
      !pointer.activeExperiment ||
      pointer.activeExperimentId !== input.expectedExperimentId ||
      pointer.activeExperiment.generationId !== input.expectedGenerationId ||
      pointer.reportRevision !== input.expectedReportRevision ||
      (pointer.mode === "promoted" &&
        pointer.reportEvidenceDigest !== input.expectedReportEvidenceDigest)
    )
      throw new PrecomputedPublicControlError("incompatible_target")
    if (pointer.authority === "isolated_fixture")
      await assertIsolatedPrecomputedControlFixture(tx)
    const updated = await tx.recommendationPrecomputedPublicControl.updateMany({
      where: {
        id: PRECOMPUTED_PUBLIC_CONTROL_ID,
        version: input.expectedControlVersion,
        activeExperimentId: input.expectedExperimentId,
      },
      data: {
        version: { increment: 1 },
        mode: "incumbent",
        activeExperimentId: null,
        retainedExperimentId: pointer.activeExperimentId,
        reportRevision: null,
        reportEvidenceDigest: null,
        authority: null,
      },
    })
    if (updated.count !== 1)
      throw new PrecomputedPublicControlError("stale_control")
    await tx.recommendationPrecomputedPublicControlEvent.create({
      data: {
        id: randomUUID(),
        controlVersion: input.expectedControlVersion + 1,
        action: "rollback",
        actorId: input.operator!.id!,
        reasonCode: input.reasonCode,
        experimentId: pointer.activeExperimentId,
        generationId: pointer.activeExperiment.generationId,
        reportRevision: pointer.reportRevision,
        reportEvidenceDigest: pointer.reportEvidenceDigest,
        authority: pointer.authority,
        expiresAt: new Date(now.getTime() + EXPERIMENT_RETENTION_MS),
      },
    })
    return loadPrecomputedPublicControl(tx)
  })
}

/** Once the configured one-year review horizon has passed, explicitly remove
 * the rollback pin so ordinary bounded retention may retire the cohort and
 * generation. This never changes the incumbent selection. */
export async function releaseRetainedPrecomputedPublicExperiment(
  prisma: PrismaClient,
  input: {
    expectedControlVersion: number
    expectedExperimentId: string
    reasonCode: string
    operator: Principal | null
    now?: Date
  },
): Promise<PrecomputedPublicControl> {
  if (!hasPermission(input.operator, "rollback:recommendations"))
    throw new ForbiddenError()
  if (
    !input.operator?.id ||
    !Number.isSafeInteger(input.expectedControlVersion) ||
    input.expectedControlVersion < 1 ||
    !ID.test(input.expectedExperimentId) ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(input.reasonCode)
  )
    throw new PrecomputedPublicControlError("invalid_input")
  const now = input.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ version: number }>>`
      SELECT version FROM recommendation_precomputed_public_control
      WHERE id = ${PRECOMPUTED_PUBLIC_CONTROL_ID} FOR UPDATE`
    if (!locked || locked.version !== input.expectedControlVersion)
      throw new PrecomputedPublicControlError("stale_control")
    const pointer =
      await tx.recommendationPrecomputedPublicControl.findUniqueOrThrow({
        where: { id: PRECOMPUTED_PUBLIC_CONTROL_ID },
        include: { retainedExperiment: true },
      })
    const retained = pointer.retainedExperiment
    if (
      pointer.mode !== "incumbent" ||
      !retained ||
      retained.id !== input.expectedExperimentId ||
      now < retained.expiresAt
    )
      throw new PrecomputedPublicControlError("incompatible_target")
    const updated = await tx.recommendationPrecomputedPublicControl.updateMany({
      where: {
        id: PRECOMPUTED_PUBLIC_CONTROL_ID,
        version: input.expectedControlVersion,
        mode: "incumbent",
        retainedExperimentId: retained.id,
      },
      data: {
        version: { increment: 1 },
        retainedExperimentId: null,
      },
    })
    if (updated.count !== 1)
      throw new PrecomputedPublicControlError("stale_control")
    await tx.recommendationPrecomputedPublicControlEvent.create({
      data: {
        id: randomUUID(),
        controlVersion: input.expectedControlVersion + 1,
        action: "release_retained",
        actorId: input.operator!.id!,
        reasonCode: input.reasonCode,
        experimentId: retained.id,
        generationId: retained.generationId,
        expiresAt: new Date(now.getTime() + EXPERIMENT_RETENTION_MS),
      },
    })
    return loadPrecomputedPublicControl(tx)
  })
}
