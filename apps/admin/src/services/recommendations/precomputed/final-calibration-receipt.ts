import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { env } from "@/config/env"
import { ForbiddenError } from "@/services/errors"
import { lockPrecomputedCtrEvidence } from "./ctr-fence"
import { validateCtrPolicySettings, type CtrPolicySettings } from "./ctr-policy"
import {
  FinalCalibrationError,
  verifyFinalCalibrationAssertion,
  type VerifiedFinalCalibration,
} from "./final-calibration"

const HOUR_MS = 3_600_000

/** Test-supplied keys are accepted only inside the repository's isolated
 * PostgreSQL fixture. Public operators never submit or select a trust key. */
async function trustedKeyring(
  prisma: PrismaClient | Prisma.TransactionClient,
  testTrustedKeyring: string | undefined,
): Promise<string | undefined> {
  if (testTrustedKeyring === undefined)
    return env.PRECOMPUTED_FINAL_CALIBRATION_PUBLIC_KEYS
  const url = new URL(env.DATABASE_URL)
  if (
    env.NODE_ENV !== "test" ||
    env.RECOMMENDATION_DB_TEST !== "1" ||
    env.RECOMMENDATION_PRECOMPUTED_TEST_ENABLED !== "1" ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
  )
    throw new FinalCalibrationError("untrusted_attestor")
  const [database] = await prisma.$queryRaw<
    Array<{ name: string; schema: string }>
  >`SELECT current_database()::text AS name, current_schema()::text AS schema`
  if (
    !["forge_capacity", "forge_precomputed_control_test"].includes(
      database?.name ?? "",
    ) ||
    !/^precomputed_public_[a-zA-Z0-9_]+$/.test(database?.schema ?? "")
  )
    throw new FinalCalibrationError("untrusted_attestor")
  return testTrustedKeyring
}

export type FinalCalibrationReceiptRead = {
  receiptDigest: string
  sourceId: string
  sourceRunId: string
  keyId: string
  lossUpperBoundRate: number
  quietHours: ReadonlySet<string>
  deliveryInitiated: number
  deliveryReachedWeb: number
  clickInitiated: number
  clickReachedWeb: number
}

function sameFrozenTarget(
  verified: VerifiedFinalCalibration,
  target: {
    id: string
    generationId: string
    configurationDigest: string
    startsAt: Date
    endsAt: Date
    policyDigest: string
    lateEventCutoffHours: number
  },
) {
  const claims = verified.claims
  return (
    claims.experimentId === target.id &&
    claims.generationId === target.generationId &&
    claims.configurationDigest === target.configurationDigest &&
    claims.policyDigest === target.policyDigest &&
    claims.startsAt === target.startsAt.toISOString() &&
    claims.endsAt === target.endsAt.toISOString() &&
    claims.finalAt ===
      new Date(
        target.endsAt.getTime() + target.lateEventCutoffHours * HOUR_MS,
      ).toISOString()
  )
}

/** The authenticated operator transports an attestor-signed, bounded claim.
 * Verification occurs before the one-row immutable insert. */
export async function attestPrecomputedFinalCalibration(
  prisma: PrismaClient,
  input: {
    assertion: string
    operator: Principal | null
    now?: Date
    testTrustedKeyring?: string
  },
): Promise<FinalCalibrationReceiptRead> {
  if (!hasPermission(input.operator, "operate:recommendation-experiments"))
    throw new ForbiddenError()
  const now = input.now ?? new Date()
  const keyring = await trustedKeyring(prisma, input.testTrustedKeyring)
  const verified = await verifyFinalCalibrationAssertion(
    input.assertion,
    keyring,
    now,
  )
  return prisma.$transaction(async (tx) => {
    await lockPrecomputedCtrEvidence(
      tx,
      verified.claims.experimentId,
      "exclusive",
    )
    const experiment = await tx.recommendationPrecomputedExperiment.findUnique({
      where: { id: verified.claims.experimentId },
      include: { ctrPolicy: true },
    })
    const policy = experiment?.ctrPolicy
    if (
      !experiment ||
      experiment.state !== "public_ready" ||
      experiment.liveEvidence == null ||
      !policy ||
      policy.authority !== "prelaunch_agreed" ||
      experiment.expiresAt <= now ||
      !sameFrozenTarget(verified, {
        ...experiment,
        policyDigest: policy.settingsDigest,
        lateEventCutoffHours: policy.lateEventCutoffHours,
      })
    )
      throw new FinalCalibrationError("incompatible_target")
    const settings = policy.settings as CtrPolicySettings
    validateCtrPolicySettings(settings)
    if (
      settings.maximumEndToEndLossRate == null ||
      now < new Date(verified.claims.finalAt)
    )
      throw new FinalCalibrationError("incompatible_target")
    const finalReport = await tx.recommendationPrecomputedCtrReport.findFirst({
      where: { experimentId: experiment.id, isFinal: true },
      select: { revision: true },
    })
    if (finalReport) throw new FinalCalibrationError("already_final")
    if (
      await tx.recommendationPrecomputedFinalCalibration.findUnique({
        where: { experimentId: experiment.id },
        select: { experimentId: true },
      })
    )
      throw new FinalCalibrationError("already_attested")
    await tx.recommendationPrecomputedFinalCalibration.create({
      data: {
        experimentId: experiment.id,
        generationId: experiment.generationId,
        configurationDigest: experiment.configurationDigest,
        policyDigest: policy.settingsDigest,
        startsAt: experiment.startsAt,
        endsAt: experiment.endsAt,
        finalAt: new Date(verified.claims.finalAt),
        sourceId: verified.sourceId,
        sourceRunId: verified.claims.sourceRunId,
        keyId: verified.keyId,
        publicKeyDigest: verified.publicKeyDigest,
        assertion: input.assertion,
        assertionDigest: verified.assertionDigest,
        lossUpperBound: verified.claims.lossUpperBoundRate,
        observedAt: new Date(verified.claims.observedAt),
        actorId: input.operator!.id!,
        expiresAt: experiment.expiresAt,
      },
    })
    return {
      receiptDigest: verified.assertionDigest,
      sourceId: verified.sourceId,
      sourceRunId: verified.claims.sourceRunId,
      keyId: verified.keyId,
      lossUpperBoundRate: verified.claims.lossUpperBoundRate,
      quietHours: verified.quietHours,
      deliveryInitiated: verified.claims.deliveryInitiated,
      deliveryReachedWeb: verified.claims.deliveryReachedWeb,
      clickInitiated: verified.claims.clickInitiated,
      clickReachedWeb: verified.claims.clickReachedWeb,
    }
  })
}

type Db = PrismaClient | Prisma.TransactionClient

/** An immutable receipt is still checked against the current frozen target;
 * historical signatures cannot be pasted onto another cohort or policy. */
export async function loadPrecomputedFinalCalibration(
  db: Db,
  target: {
    id: string
    generationId: string
    configurationDigest: string
    startsAt: Date
    endsAt: Date
    expiresAt: Date
    policyDigest: string
    lateEventCutoffHours: number
  },
  asOf: Date,
  trustedKeyringOverride?: string,
): Promise<FinalCalibrationReceiptRead | null> {
  const row = await db.recommendationPrecomputedFinalCalibration.findUnique({
    where: { experimentId: target.id },
  })
  if (!row) return null
  const expectedFinalAt = new Date(
    target.endsAt.getTime() + target.lateEventCutoffHours * HOUR_MS,
  )
  if (
    row.generationId !== target.generationId ||
    row.configurationDigest !== target.configurationDigest ||
    row.policyDigest !== target.policyDigest ||
    row.startsAt.getTime() !== target.startsAt.getTime() ||
    row.endsAt.getTime() !== target.endsAt.getTime() ||
    row.finalAt.getTime() !== expectedFinalAt.getTime() ||
    row.expiresAt.getTime() !== target.expiresAt.getTime() ||
    row.createdAt > asOf ||
    row.observedAt < expectedFinalAt ||
    row.observedAt > row.createdAt ||
    row.assertionDigest !==
      createHash("sha256").update(row.assertion).digest("hex") ||
    row.lossUpperBound < 0 ||
    row.lossUpperBound > 1
  )
    return null
  try {
    // The signed assertion was verified before this append-only write. Parse
    // it again only to recover bounded quiet hours and cross-check metadata.
    const payload = row.assertion.split(".")[1]
    if (!payload) return null
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as Record<string, unknown> | null
    if (
      !claims ||
      claims.experimentId !== target.id ||
      claims.sourceId !== row.sourceId ||
      claims.sourceRunId !== row.sourceRunId ||
      claims.lossUpperBoundRate !== row.lossUpperBound ||
      claims.generationId !== target.generationId ||
      claims.configurationDigest !== target.configurationDigest ||
      claims.policyDigest !== target.policyDigest ||
      claims.startsAt !== target.startsAt.toISOString() ||
      claims.endsAt !== target.endsAt.toISOString() ||
      claims.finalAt !== expectedFinalAt.toISOString() ||
      claims.observedAt !== row.observedAt.toISOString()
    )
      return null
    // The statement's required counts/bitset were validated before insert.
    const verified = await verifyFinalCalibrationAssertion(
      row.assertion,
      await trustedKeyring(db, trustedKeyringOverride),
      asOf,
      { allowHistorical: true },
    )
    if (
      verified.keyId !== row.keyId ||
      verified.publicKeyDigest !== row.publicKeyDigest ||
      verified.assertionDigest !== row.assertionDigest
    )
      return null
    return {
      receiptDigest: row.assertionDigest,
      sourceId: row.sourceId,
      sourceRunId: row.sourceRunId,
      keyId: row.keyId,
      lossUpperBoundRate: row.lossUpperBound,
      quietHours: verified.quietHours,
      deliveryInitiated: verified.claims.deliveryInitiated,
      deliveryReachedWeb: verified.claims.deliveryReachedWeb,
      clickInitiated: verified.claims.clickInitiated,
      clickReachedWeb: verified.claims.clickReachedWeb,
    }
  } catch {
    return null
  }
}
