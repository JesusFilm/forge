import { createHash, randomUUID } from "node:crypto"
import { statfs } from "node:fs/promises"
import { tmpdir } from "node:os"
import {
  Prisma,
  type PrismaClient,
  type RecommendationPrecomputedGeneration,
  type RecommendationPrecomputedGaCaptureImport,
} from "@prisma/client"
import { z } from "zod"
import { env } from "@/config/env"
import {
  PrecomputedRecommendationError,
  gaHistoricalQualification,
} from "./contract"
import {
  GA_CAPTURE_MAX_BYTES,
  canonicalGaCaptureJson,
  gaCaptureSnapshotRefSchema,
  hasSealedGaCapture,
  sealedGaCaptureQualificationSchema,
} from "./ga-capture-artifact"
import {
  configuredGaCaptureStore,
  gaCaptureStorageKey,
  type GaCaptureStore,
} from "./ga-capture-store"
import {
  verifyBoundGaCapture,
  withVerifiedGaCaptureFile,
} from "./ga-capture-transport"
import {
  deriveGaImportDestinationIdentity,
  type DestinationIdentity,
} from "./ga-capture-import-identity"

const id = z.string().trim().min(1).max(191)
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const date = z.iso.date()
const base = z.object({
  generationId: id,
  generationInputDigest: digest,
})
const originProbe = z
  .object({
    action: z.literal("ga_import_origin_probe_v1"),
    originGenerationId: id,
  })
  .strict()
const prepare = base
  .extend({
    action: z.literal("ga_import_prepare_v1"),
    attemptId: z.uuid(),
    candidatePoolDigest: digest,
    requestedStart: date,
    requestedEnd: date,
    usableStart: date,
    usableEnd: date,
    requestedCoverageDigest: digest,
    usableCoverageDigest: digest,
  })
  .strict()
const copyBind = base
  .extend({
    action: z.literal("ga_import_copy_bind_v1"),
    attemptId: z.uuid(),
    preparedDigest: digest,
    originGenerationId: id,
    originArtifactSha256: digest,
    originProofDigest: digest,
  })
  .strict()
const status = base
  .extend({ action: z.literal("ga_import_status_v1") })
  .strict()
const actions = z.discriminatedUnion("action", [
  originProbe,
  prepare,
  copyBind,
  status,
])
const destinationIdentitySchema = z
  .object({
    generationId: id,
    generationInputDigest: digest,
    sourceSetDigest: digest,
    inputCutoff: z.iso.datetime({ offset: true }),
    selectedCorpusDigest: digest,
    candidatePoolDigest: digest,
    routeMappingDigest: digest,
    sourcePatternTableDigest: digest,
    querySpecDigest: digest,
    propertyId: z.literal("320198532"),
    propertyTimeZone: z.literal("America/New_York"),
    qualificationPolicy: z.literal("referrer_navigation_v1"),
    requestedStart: date,
    requestedEnd: date,
    usableStart: date,
    usableEnd: date,
    requestedCoverageDigest: digest,
    usableCoverageDigest: digest,
  })
  .strict()
const originIdentitySchema = destinationIdentitySchema
  .omit({ qualificationPolicy: true })
  .extend({
    baseQualificationDigest: digest,
    artifactSha256: digest,
    artifactBytes: z.number().int().min(13).max(GA_CAPTURE_MAX_BYTES),
    headerSha256: digest,
    physicalHttpAttempts: z.number().int().nonnegative().safe(),
    physicalSucceededCalls: z.number().int().nonnegative().safe(),
  })
  .strict()
const copyIdentitySchema = z
  .object({
    artifactSha256: digest,
    artifactBytes: z.number().int().min(13).max(GA_CAPTURE_MAX_BYTES),
    headerSha256: digest,
  })
  .strict()
const bindingFields = z
  .object({
    version: z.literal("ga_capture_import_v1"),
    destination: destinationIdentitySchema,
    origin: originIdentitySchema,
    copy: copyIdentitySchema,
  })
  .strict()
export const gaCaptureImportBindingSchema = bindingFields
  .extend({ bindingDigest: digest })
  .strict()
export const importedGaCaptureQualificationSchema = gaHistoricalQualification
  .extend({ importBinding: gaCaptureImportBindingSchema })
  .strict()
export type GaCaptureImportBinding = z.infer<
  typeof gaCaptureImportBindingSchema
>

type Tx = Prisma.TransactionClient
type Generation = RecommendationPrecomputedGeneration
type ImportGeneration = Pick<
  Generation,
  | "id"
  | "protocolVersion"
  | "inputMode"
  | "historicalQualification"
  | "historicalQualificationDigest"
  | "inputDigest"
  | "sourceSetDigest"
  | "inputCutoff"
>
type ImportRow = RecommendationPrecomputedGaCaptureImport
const VERSION = "ga_capture_import_v1" as const
const STAGING_MS = 20 * 60_000
const CLAIM_MS = 15 * 60_000
const CLEANUP_GRACE_MS = 30 * 60_000
const CAPACITY_MAX_AGE_MS = 30 * 60_000
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
const canonicalHash = (value: unknown) =>
  createHash("sha256").update(canonicalGaCaptureJson(value)).digest("hex")
const json = (value: unknown) => value as Prisma.InputJsonValue
const same = (left: unknown, right: unknown) =>
  canonicalGaCaptureJson(left) === canonicalGaCaptureJson(right)
function invalid(message: string): never {
  throw new PrecomputedRecommendationError("invalid", message)
}
function conflict(message: string): never {
  throw new PrecomputedRecommendationError("conflict", message)
}

function requireCapacity(generation: Generation) {
  const capacity = generation.capacityPreflight as {
    status?: string
    measuredAt?: string
  } | null
  const age = Date.now() - Date.parse(capacity?.measuredAt ?? "")
  if (
    capacity?.status !== "passed" ||
    !Number.isFinite(age) ||
    age < -60_000 ||
    age > CAPACITY_MAX_AGE_MS
  )
    conflict("Fresh measured capacity is required for GA import")
}
function requireDestination(generation: Generation, inputDigest: string) {
  if (
    generation.inputDigest !== inputDigest ||
    generation.protocolVersion !== 4 ||
    generation.inputMode !== "historical_analytics" ||
    generation.executionBackend !== "codex_chatgpt_subscription" ||
    generation.modelId !== "gpt-6-astra" ||
    generation.status !== "incomplete" ||
    !generation.manifestCommittedAt
  )
    conflict("GA import destination is unavailable")
  requireCapacity(generation)
}
async function activeAttempt(tx: Tx, generationId: string, attemptId: string) {
  const attempt = await tx.recommendationPrecomputedExecutionAttempt.findUnique(
    {
      where: { generationId_attemptId: { generationId, attemptId } },
      select: { endedAt: true },
    },
  )
  if (!attempt || attempt.endedAt)
    conflict("GA import subscription attempt is inactive")
}
async function lockGenerations(tx: Tx, ids: string[]) {
  const ordered = [...new Set(ids)].sort()
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM recommendation_precomputed_generation
    WHERE id IN (${Prisma.join(ordered)}) ORDER BY id FOR UPDATE`)
  if (rows.length !== ordered.length)
    conflict("GA import generation is unavailable")
}
async function lockImport(tx: Tx, generationId: string) {
  await tx.$queryRaw(Prisma.sql`
    SELECT destination_generation_id FROM recommendation_precomputed_ga_capture_import
    WHERE destination_generation_id = ${generationId} FOR UPDATE`)
  return tx.recommendationPrecomputedGaCaptureImport.findUnique({
    where: { destinationGenerationId: generationId },
  })
}
async function globalBudgetLock(tx: Tx) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(590, 145)::text AS held`
}
async function requireNoWork(tx: Tx, generationId: string) {
  const [
    sources,
    historyCalls,
    modelCalls,
    profileCalls,
    profiles,
    edgeCalls,
    choices,
    finalSources,
  ] = await Promise.all([
    tx.recommendationPrecomputedBuildSource.findMany({
      where: { generationId },
      select: { sourceVideoId: true, state: true, checkpointRevision: true },
      orderBy: { sourceVideoId: "asc" },
    }),
    tx.recommendationPrecomputedHistoryCall.count({ where: { generationId } }),
    tx.recommendationPrecomputedModelCall.count({ where: { generationId } }),
    tx.recommendationPrecomputedProfileCall.count({ where: { generationId } }),
    tx.recommendationPrecomputedContentProfile.count({
      where: { generationId },
    }),
    tx.recommendationPrecomputedEdgeBatchCall.count({
      where: { generationId },
    }),
    tx.recommendationPrecomputedBuildChoice.count({ where: { generationId } }),
    tx.recommendationPrecomputedSource.count({ where: { generationId } }),
  ])
  if (
    historyCalls ||
    modelCalls ||
    profileCalls ||
    profiles ||
    edgeCalls ||
    choices ||
    finalSources ||
    sources.some(
      (source) => source.state !== "pending" || source.checkpointRevision !== 0,
    )
  )
    conflict("GA import must precede source and model work")
  return sources.map((source) => source.sourceVideoId)
}
function validIntent(input: z.infer<typeof prepare>) {
  if (
    input.requestedStart > input.requestedEnd ||
    input.usableStart > input.usableEnd ||
    input.usableStart < input.requestedStart ||
    input.usableEnd > input.requestedEnd
  )
    invalid("GA import date range is invalid")
}
function normalizedBinding(
  destination: z.infer<typeof destinationIdentitySchema>,
  origin: z.infer<typeof originIdentitySchema>,
): GaCaptureImportBinding {
  const fields = bindingFields.parse({
    version: VERSION,
    destination,
    origin,
    copy: {
      artifactSha256: origin.artifactSha256,
      artifactBytes: origin.artifactBytes,
      headerSha256: origin.headerSha256,
    },
  })
  const result = gaCaptureImportBindingSchema.parse({
    ...fields,
    bindingDigest: canonicalHash(fields),
  })
  if (Buffer.byteLength(canonicalGaCaptureJson(result)) > 4096)
    invalid("GA import binding is oversized")
  return result
}
function parsedDestination(row: ImportRow) {
  return destinationIdentitySchema.parse(row.destinationIdentity)
}
async function boundReply(
  prisma: PrismaClient,
  row: ImportRow,
  generation: Generation,
  replay: boolean,
) {
  const qualification = importedGaCaptureQualificationSchema.safeParse(
    generation.historicalQualification,
  )
  if (
    !qualification.success ||
    !generation.historicalQualificationDigest ||
    !(await verifiedImportedGaCapture(prisma, generation))
  )
    conflict("GA import qualification is missing")
  const binding = qualification.data.importBinding
  return {
    version: VERSION,
    state: "bound" as const,
    preparedDigest: row.preparedDigest,
    importBinding: binding,
    qualificationDigest: generation.historicalQualificationDigest,
    replay,
  }
}

async function inspectOrigin(
  prisma: PrismaClient,
  originGenerationId: string,
  store?: GaCaptureStore,
) {
  const generation =
    await prisma.recommendationPrecomputedGeneration.findUnique({
      where: { id: originGenerationId },
    })
  if (
    !generation ||
    generation.protocolVersion !== 3 ||
    generation.inputMode !== "historical_analytics" ||
    !["incomplete", "complete"].includes(generation.status)
  )
    conflict("GA import origin is unavailable")
  const qualification = sealedGaCaptureQualificationSchema.safeParse(
    generation.historicalQualification,
  )
  if (!qualification.success || !generation.historicalQualificationDigest)
    conflict("GA import origin is not sealed")
  const reference = qualification.data.snapshotRef
  if (
    reference.generationId !== generation.id ||
    reference.generationInputDigest !== generation.inputDigest ||
    reference.sourceSetDigest !== generation.sourceSetDigest ||
    reference.inputCutoff !== generation.inputCutoff.toISOString() ||
    reference.storageKey !==
      gaCaptureStorageKey(generation.id, reference.artifactSha256) ||
    hash(qualification.data) !== generation.historicalQualificationDigest
  )
    conflict("GA import origin qualification differs")
  const receipt =
    await prisma.recommendationPrecomputedGaCaptureArtifact.findUnique({
      where: {
        generationId_artifactSha256: {
          generationId: generation.id,
          artifactSha256: reference.artifactSha256,
        },
      },
    })
  if (
    !receipt?.boundAt ||
    receipt.storageKey !== reference.storageKey ||
    receipt.artifactBytes !== BigInt(reference.artifactBytes)
  )
    conflict("GA import origin receipt is not bound")
  const counts = await prisma.recommendationPrecomputedHistoryCall.groupBy({
    by: ["status"],
    where: { generationId: generation.id, sourceVideoId: null },
    _count: true,
  })
  const count = (status: string) =>
    counts.find((item) => item.status === status)?._count ?? 0
  if (
    count("pending") !== 0 ||
    reference.physicalHttpAttempts !== count("succeeded") + count("failed") ||
    reference.physicalSucceededCalls !== count("succeeded") ||
    (await prisma.recommendationPrecomputedHistoryCall.count({
      where: { generationId: generation.id, status: "pending" },
    })) !== 0
  )
    conflict("GA import origin physical receipts are unresolved")
  const verified = await verifyBoundGaCapture(
    reference,
    store ?? configuredGaCaptureStore(),
  )
  const { snapshotRef: _snapshotRef, ...baseQualification } = qualification.data
  void _snapshotRef
  if (!same(verified.header.baseQualification, baseQualification))
    conflict("GA import origin base qualification differs")
  const header = verified.header
  const origin = originIdentitySchema.parse({
    generationId: header.generationId,
    generationInputDigest: header.generationInputDigest,
    sourceSetDigest: header.sourceSetDigest,
    inputCutoff: header.inputCutoff,
    selectedCorpusDigest: header.selectedCorpusDigest,
    candidatePoolDigest: header.candidatePoolDigest,
    routeMappingDigest: header.routeMappingDigest,
    sourcePatternTableDigest: header.sourcePatternTableDigest,
    querySpecDigest: header.querySpecDigest,
    propertyId: header.propertyId,
    propertyTimeZone: header.propertyTimeZone,
    requestedStart: header.requestedStart,
    requestedEnd: header.requestedEnd,
    usableStart: header.usableStart,
    usableEnd: header.usableEnd,
    requestedCoverageDigest: header.requestedCoverageDigest,
    usableCoverageDigest: header.usableCoverageDigest,
    baseQualificationDigest: header.baseQualificationDigest,
    artifactSha256: verified.artifactSha256,
    artifactBytes: verified.artifactBytes,
    headerSha256: verified.headerSha256,
    physicalHttpAttempts: header.physicalHttpAttempts,
    physicalSucceededCalls: header.physicalSucceededCalls,
  })
  const originProofDigest = canonicalHash({
    version: "ga_import_origin_proof_v1",
    origin,
    qualificationDigest: generation.historicalQualificationDigest,
    storageKey: reference.storageKey,
    receiptCounts: {
      succeeded: count("succeeded"),
      failed: count("failed"),
    },
  })
  return {
    origin,
    originProofDigest,
    reference,
    baseQualification: header.baseQualification,
  }
}

function compatible(
  destination: DestinationIdentity,
  origin: z.infer<typeof originIdentitySchema>,
) {
  const fields = [
    "sourceSetDigest",
    "inputCutoff",
    "selectedCorpusDigest",
    "routeMappingDigest",
    "sourcePatternTableDigest",
    "querySpecDigest",
    "propertyId",
    "propertyTimeZone",
    "requestedStart",
    "requestedEnd",
    "usableStart",
    "usableEnd",
    "requestedCoverageDigest",
    "usableCoverageDigest",
  ] as const
  if (fields.some((field) => destination[field] !== origin[field]))
    conflict("GA import destination differs from sealed origin")
  if (destination.qualificationPolicy !== "referrer_navigation_v1")
    conflict("GA import qualification policy differs")
}

export type GaImportOptions = {
  store?: GaCaptureStore
  objectBudgetBytes?: number
  tempBudgetBytes?: number
  tempReserveBytes?: number
  availableTempBytes?: () => Promise<number>
}
function budgets(options: GaImportOptions) {
  const objectBudgetBytes =
    options.objectBudgetBytes ?? env.GA_CAPTURE_IMPORT_OBJECT_BUDGET_BYTES
  const tempBudgetBytes =
    options.tempBudgetBytes ?? env.GA_CAPTURE_IMPORT_TEMP_BUDGET_BYTES
  const tempReserveBytes =
    options.tempReserveBytes ?? env.GA_CAPTURE_IMPORT_TEMP_RESERVE_BYTES
  if (
    typeof objectBudgetBytes !== "number" ||
    !Number.isSafeInteger(objectBudgetBytes) ||
    objectBudgetBytes <= 0 ||
    typeof tempBudgetBytes !== "number" ||
    !Number.isSafeInteger(tempBudgetBytes) ||
    tempBudgetBytes <= 0 ||
    typeof tempReserveBytes !== "number" ||
    !Number.isSafeInteger(tempReserveBytes) ||
    tempReserveBytes < 0
  )
    conflict("GA import object and temporary storage budgets are unconfigured")
  return { objectBudgetBytes, tempBudgetBytes, tempReserveBytes }
}
async function availableTempBytes(options: GaImportOptions) {
  if (options.availableTempBytes) return options.availableTempBytes()
  const usage = await statfs(tmpdir())
  return Number(BigInt(usage.bavail) * BigInt(usage.bsize))
}
async function admitStorage(tx: Tx, bytes: number, options: GaImportOptions) {
  const budget = budgets(options)
  await globalBudgetLock(tx)
  const [totals] = await tx.$queryRaw<
    Array<{ retained: bigint; staged: bigint }>
  >`
    SELECT
      (SELECT COALESCE(sum(artifact_bytes), 0) FROM recommendation_precomputed_ga_capture_artifact) +
      (SELECT COALESCE(sum(artifact_bytes), 0) FROM recommendation_precomputed_ga_capture_import
       WHERE state IN ('copying','bound') OR (state = 'abandoned' AND cleaned_at IS NULL)) AS retained,
      (SELECT COALESCE(sum(temp_reserved_bytes), 0) FROM recommendation_precomputed_ga_capture_import
       WHERE state = 'copying' OR (state = 'abandoned' AND cleaned_at IS NULL)) AS staged`
  const observedTempBytes = await availableTempBytes(options)
  if (
    !totals ||
    BigInt(totals.retained) + BigInt(bytes) >
      BigInt(budget.objectBudgetBytes) ||
    BigInt(totals.staged) + BigInt(2 * bytes) >
      BigInt(budget.tempBudgetBytes) ||
    observedTempBytes < 2 * bytes + budget.tempReserveBytes
  )
    conflict("GA import object or temporary storage budget is exhausted")
}

async function prepareImport(
  prisma: PrismaClient,
  input: z.infer<typeof prepare>,
  authorizationHeader: string,
  options: GaImportOptions,
) {
  validIntent(input)
  budgets(options)
  const generation =
    await prisma.recommendationPrecomputedGeneration.findUnique({
      where: { id: input.generationId },
    })
  if (!generation) conflict("GA import destination is unavailable")
  requireDestination(generation, input.generationInputDigest)
  const destination = destinationIdentitySchema.parse(
    await deriveGaImportDestinationIdentity(
      prisma,
      authorizationHeader,
      generation,
      input,
    ),
  )
  const preparedDigest = canonicalHash({
    version: "ga_capture_import_prepare_v1",
    destination,
  })
  return prisma.$transaction(
    async (tx) => {
      await lockGenerations(tx, [input.generationId])
      const current =
        await tx.recommendationPrecomputedGeneration.findUniqueOrThrow({
          where: { id: input.generationId },
        })
      requireDestination(current, input.generationInputDigest)
      await activeAttempt(tx, input.generationId, input.attemptId)
      if (current.historicalQualification)
        conflict("GA import qualification already exists")
      const sourceIds = await requireNoWork(tx, input.generationId)
      if (
        sourceIds.length !== current.expectedSourceCount ||
        hash(sourceIds) !== current.sourceSetDigest ||
        current.sourceSetDigest !== destination.sourceSetDigest ||
        current.inputCutoff.toISOString() !== destination.inputCutoff
      )
        conflict("GA import destination manifest differs")
      const previous = await lockImport(tx, input.generationId)
      if (previous) {
        if (previous.state !== "prepared")
          conflict("GA import preparation has advanced; use status")
        if (
          previous.preparedDigest !== preparedDigest ||
          !same(previous.destinationIdentity, destination)
        )
          conflict("GA import preparation retry differs")
        return {
          version: VERSION,
          state: "prepared" as const,
          preparedDigest,
          destination,
          replay: true,
        }
      }
      await tx.recommendationPrecomputedGaCaptureImport.create({
        data: {
          destinationGenerationId: input.generationId,
          destinationIdentity: json(destination),
          preparedDigest,
          state: "prepared",
        },
      })
      return {
        version: VERSION,
        state: "prepared" as const,
        preparedDigest,
        destination,
        replay: false,
      }
    },
    { timeout: 30_000 },
  )
}

async function copyBindImport(
  prisma: PrismaClient,
  input: z.infer<typeof copyBind>,
  authorizationHeader: string,
  options: GaImportOptions,
) {
  const store = options.store ?? configuredGaCaptureStore()
  const inspected = await inspectOrigin(prisma, input.originGenerationId, store)
  if (
    inspected.origin.artifactSha256 !== input.originArtifactSha256 ||
    inspected.originProofDigest !== input.originProofDigest
  )
    conflict("GA import origin proof differs")
  const prepared =
    await prisma.recommendationPrecomputedGaCaptureImport.findUnique({
      where: { destinationGenerationId: input.generationId },
    })
  if (!prepared || prepared.preparedDigest !== input.preparedDigest)
    conflict("GA import destination has not been prepared")
  const destination = parsedDestination(prepared)
  compatible(destination, inspected.origin)
  const generation =
    await prisma.recommendationPrecomputedGeneration.findUnique({
      where: { id: input.generationId },
    })
  if (!generation) conflict("GA import destination is unavailable")
  requireDestination(generation, input.generationInputDigest)
  const actualDestination = destinationIdentitySchema.parse(
    await deriveGaImportDestinationIdentity(
      prisma,
      authorizationHeader,
      generation,
      destination,
    ),
  )
  if (!same(actualDestination, destination))
    conflict("GA import destination catalog changed after preparation")
  const storageKey = gaCaptureStorageKey(
    input.generationId,
    inspected.origin.artifactSha256,
  )
  const copyRequestDigest = canonicalHash(input)
  const reservation = await prisma.$transaction(
    async (tx) => {
      await lockGenerations(tx, [input.generationId, input.originGenerationId])
      const [current, originGeneration] = await Promise.all([
        tx.recommendationPrecomputedGeneration.findUniqueOrThrow({
          where: { id: input.generationId },
        }),
        tx.recommendationPrecomputedGeneration.findUniqueOrThrow({
          where: { id: input.originGenerationId },
        }),
      ])
      requireDestination(current, input.generationInputDigest)
      await activeAttempt(tx, input.generationId, input.attemptId)
      if (
        originGeneration.protocolVersion !== 3 ||
        !["incomplete", "complete"].includes(originGeneration.status) ||
        !sealedGaCaptureQualificationSchema.safeParse(
          originGeneration.historicalQualification,
        ).success
      )
        conflict("GA import origin became unavailable")
      const row = await lockImport(tx, input.generationId)
      if (
        !row ||
        row.preparedDigest !== input.preparedDigest ||
        !same(row.destinationIdentity, destination)
      )
        conflict("GA import preparation changed")
      if (row.state === "bound") {
        if (
          row.copyRequestDigest !== copyRequestDigest ||
          row.copyAttemptId !== input.attemptId
        )
          conflict("Bound GA import replay differs; use status")
        return { state: "bound" as const, row, generation: current }
      }
      if (row.state === "abandoned") conflict("GA import copy was abandoned")
      const now = new Date()
      if (row.state === "copying") {
        if (
          row.copyRequestDigest !== copyRequestDigest ||
          row.copyAttemptId !== input.attemptId ||
          row.originProofDigest !== input.originProofDigest ||
          !same(row.originIdentity, inspected.origin) ||
          row.artifactSha256 !== inspected.origin.artifactSha256 ||
          row.artifactBytes !== BigInt(inspected.origin.artifactBytes) ||
          row.storageKey !== storageKey
        )
          conflict("GA import copy replay differs")
        if (!row.stagingDeadlineAt || row.stagingDeadlineAt <= now)
          conflict("GA import copy staging deadline expired")
        if (row.copyLeaseExpiresAt && row.copyLeaseExpiresAt > now)
          return { state: "copying" as const, row, replay: true }
        const claimId = randomUUID()
        const claimEpoch = row.copyClaimEpoch + 1
        const claimed =
          await tx.recommendationPrecomputedGaCaptureImport.update({
            where: { destinationGenerationId: input.generationId },
            data: {
              copyClaimId: claimId,
              copyClaimEpoch: claimEpoch,
              copyLeaseExpiresAt: new Date(
                Math.min(
                  now.getTime() + CLAIM_MS,
                  row.stagingDeadlineAt.getTime(),
                ),
              ),
              updatedAt: now,
            },
          })
        return { state: "owned" as const, row: claimed, claimId, claimEpoch }
      }
      await requireNoWork(tx, input.generationId)
      if (current.historicalQualification)
        conflict("GA import qualification already exists")
      await admitStorage(tx, inspected.origin.artifactBytes, options)
      const claimId = randomUUID()
      const deadline = new Date(now.getTime() + STAGING_MS)
      const claimed = await tx.recommendationPrecomputedGaCaptureImport.update({
        where: { destinationGenerationId: input.generationId },
        data: {
          originGenerationId: input.originGenerationId,
          originIdentity: json(inspected.origin),
          originProofDigest: input.originProofDigest,
          copyRequestDigest,
          copyAttemptId: input.attemptId,
          artifactSha256: inspected.origin.artifactSha256,
          artifactBytes: BigInt(inspected.origin.artifactBytes),
          storageKey,
          state: "copying",
          copyClaimId: claimId,
          copyClaimEpoch: 1,
          copyLeaseExpiresAt: new Date(now.getTime() + CLAIM_MS),
          tempReservedBytes: BigInt(2 * inspected.origin.artifactBytes),
          stagingDeadlineAt: deadline,
          updatedAt: now,
        },
      })
      return { state: "owned" as const, row: claimed, claimId, claimEpoch: 1 }
    },
    { timeout: 30_000 },
  )
  if (reservation.state === "bound")
    return boundReply(prisma, reservation.row, reservation.generation, true)
  if (reservation.state === "copying")
    return {
      version: VERSION,
      state: "copying" as const,
      preparedDigest: reservation.row.preparedDigest,
      stagingDeadlineAt: reservation.row.stagingDeadlineAt!.toISOString(),
      replay: true,
    }
  const { claimId, claimEpoch } = reservation
  const claimIsLive = async () => {
    const row =
      await prisma.recommendationPrecomputedGaCaptureImport.findUnique({
        where: { destinationGenerationId: input.generationId },
      })
    if (
      row?.state !== "copying" ||
      row.copyClaimId !== claimId ||
      row.copyClaimEpoch !== claimEpoch ||
      !row.copyLeaseExpiresAt ||
      row.copyLeaseExpiresAt <= new Date() ||
      !row.stagingDeadlineAt ||
      row.stagingDeadlineAt <= new Date()
    )
      conflict("GA import copy claim expired or changed")
  }
  await withVerifiedGaCaptureFile(
    inspected.reference,
    store,
    async (path, verified) => {
      await claimIsLive()
      if (
        verified.artifactSha256 !== inspected.origin.artifactSha256 ||
        verified.headerSha256 !== inspected.origin.headerSha256 ||
        verified.artifactBytes !== inspected.origin.artifactBytes
      )
        conflict("GA import origin bytes changed during copy")
      await store.putIfAbsent(storageKey, path, inspected.origin.artifactBytes)
      await claimIsLive()
      const destinationRef = gaCaptureSnapshotRefSchema.parse({
        ...inspected.reference,
        storageKey,
      })
      await verifyBoundGaCapture(destinationRef, store)
    },
  )
  return prisma.$transaction(
    async (tx) => {
      await lockGenerations(tx, [input.generationId, input.originGenerationId])
      const current =
        await tx.recommendationPrecomputedGeneration.findUniqueOrThrow({
          where: { id: input.generationId },
        })
      requireDestination(current, input.generationInputDigest)
      await activeAttempt(tx, input.generationId, input.attemptId)
      const row = await lockImport(tx, input.generationId)
      if (
        row?.state !== "copying" ||
        row.copyClaimId !== claimId ||
        row.copyClaimEpoch !== claimEpoch ||
        !row.copyLeaseExpiresAt ||
        row.copyLeaseExpiresAt <= new Date() ||
        !row.stagingDeadlineAt ||
        row.stagingDeadlineAt <= new Date() ||
        row.copyRequestDigest !== copyRequestDigest
      )
        conflict("GA import copy claim expired or changed")
      await requireNoWork(tx, input.generationId)
      if (current.historicalQualification)
        conflict("GA import qualification already exists")
      const binding = normalizedBinding(destination, inspected.origin)
      const qualification = importedGaCaptureQualificationSchema.parse({
        ...inspected.baseQualification,
        importBinding: binding,
      })
      const qualificationDigest = hash(qualification)
      const now = new Date()
      await tx.recommendationPrecomputedGaCaptureImport.update({
        where: { destinationGenerationId: input.generationId },
        data: {
          state: "bound",
          copyLeaseExpiresAt: null,
          tempReservedBytes: 0n,
          confirmedAt: now,
          boundAt: now,
          updatedAt: now,
        },
      })
      await tx.recommendationPrecomputedGeneration.update({
        where: { id: input.generationId },
        data: {
          historicalQualification: json(qualification),
          historicalQualificationDigest: qualificationDigest,
        },
      })
      return {
        version: VERSION,
        state: "bound" as const,
        preparedDigest: row.preparedDigest,
        importBinding: binding,
        qualificationDigest,
        replay: false,
      }
    },
    { timeout: 30_000 },
  )
}

async function statusImport(
  prisma: PrismaClient,
  input: z.infer<typeof status>,
) {
  const generation =
    await prisma.recommendationPrecomputedGeneration.findUnique({
      where: { id: input.generationId },
    })
  if (!generation || generation.inputDigest !== input.generationInputDigest)
    conflict("GA import destination is unavailable")
  const row = await prisma.recommendationPrecomputedGaCaptureImport.findUnique({
    where: { destinationGenerationId: input.generationId },
  })
  if (!row) return { version: VERSION, state: "absent" as const }
  if (row.state === "prepared")
    return {
      version: VERSION,
      state: "prepared" as const,
      preparedDigest: row.preparedDigest,
    }
  if (row.state === "copying")
    return {
      version: VERSION,
      state: "copying" as const,
      preparedDigest: row.preparedDigest,
      stagingDeadlineAt: row.stagingDeadlineAt!.toISOString(),
    }
  if (row.state === "bound") {
    const { replay: _replay, ...reply } = await boundReply(
      prisma,
      row,
      generation,
      true,
    )
    void _replay
    return reply
  }
  return {
    version: VERSION,
    state: "abandoned" as const,
    preparedDigest: row.preparedDigest,
    ...(row.stagingDeadlineAt
      ? { stagingDeadlineAt: row.stagingDeadlineAt.toISOString() }
      : {}),
  }
}

/** Shared private bearer is authenticated by the existing route before dispatch. */
export async function submitGaCaptureImport(
  prisma: PrismaClient,
  raw: unknown,
  authorizationHeader: string,
  options: GaImportOptions = {},
): Promise<Record<string, unknown>> {
  if (Buffer.byteLength(JSON.stringify(raw)) > 65_536)
    invalid("GA import action body exceeds 64 KiB")
  const parsed = actions.safeParse(raw)
  if (!parsed.success) invalid("Invalid GA import action")
  const input = parsed.data
  if (input.action === "ga_import_origin_probe_v1") {
    const inspected = await inspectOrigin(
      prisma,
      input.originGenerationId,
      options.store,
    )
    return {
      version: VERSION,
      origin: inspected.origin,
      originProofDigest: inspected.originProofDigest,
    }
  }
  if (input.action === "ga_import_prepare_v1")
    return prepareImport(prisma, input, authorizationHeader, options)
  if (input.action === "ga_import_copy_bind_v1")
    return copyBindImport(prisma, input, authorizationHeader, options)
  return statusImport(prisma, input)
}

/** One authoritative v4 predicate; never reinterpret a v3 origin ref as destination. */
export async function verifiedImportedGaCapture(
  tx: Tx | PrismaClient,
  generation: ImportGeneration,
): Promise<GaCaptureImportBinding | null> {
  if (
    generation.protocolVersion !== 4 ||
    generation.inputMode !== "historical_analytics"
  )
    return null
  const row = await tx.recommendationPrecomputedGaCaptureImport.findUnique({
    where: { destinationGenerationId: generation.id },
  })
  const qualification = importedGaCaptureQualificationSchema.safeParse(
    generation.historicalQualification,
  )
  if (
    row?.state !== "bound" ||
    !row.boundAt ||
    !row.confirmedAt ||
    !row.artifactSha256 ||
    !row.artifactBytes ||
    !row.storageKey ||
    !row.originIdentity ||
    !qualification.success ||
    hash(qualification.data) !== generation.historicalQualificationDigest
  )
    return null
  const binding = qualification.data.importBinding
  const { bindingDigest: _digest, ...fields } = binding
  void _digest
  const mismatchedPool = await tx.recommendationPrecomputedBuildSource.count({
    where: {
      generationId: generation.id,
      AND: [
        { edgeCandidatePoolDigest: { not: null } },
        {
          NOT: {
            edgeCandidatePoolDigest: binding.destination.candidatePoolDigest,
          },
        },
      ],
    },
  })
  if (
    canonicalHash(fields) !== binding.bindingDigest ||
    !same(row.destinationIdentity, binding.destination) ||
    !same(row.originIdentity, binding.origin) ||
    row.artifactSha256 !== binding.copy.artifactSha256 ||
    row.artifactBytes !== BigInt(binding.copy.artifactBytes) ||
    row.storageKey !== gaCaptureStorageKey(generation.id, row.artifactSha256) ||
    binding.destination.generationId !== generation.id ||
    binding.destination.generationInputDigest !== generation.inputDigest ||
    binding.destination.sourceSetDigest !== generation.sourceSetDigest ||
    binding.destination.inputCutoff !== generation.inputCutoff.toISOString() ||
    mismatchedPool > 0
  )
    return null
  return binding
}

export async function hasQualifiedGaCapture(
  tx: Tx | PrismaClient,
  generation: ImportGeneration,
): Promise<boolean> {
  if (generation.protocolVersion === 3)
    return hasSealedGaCapture(generation.historicalQualification, generation)
  if (generation.protocolVersion === 4)
    return Boolean(await verifiedImportedGaCapture(tx, generation))
  return false
}

export async function purgeAbandonedGaCaptureImports(
  prisma: PrismaClient,
  now: Date,
  options: GaImportOptions = {},
  limit = 10,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    invalid("Invalid GA import cleanup limit")
  const cutoff = new Date(now.getTime() - CLEANUP_GRACE_MS)
  const candidates =
    await prisma.recommendationPrecomputedGaCaptureImport.findMany({
      where: {
        OR: [
          { state: "copying", stagingDeadlineAt: { lte: cutoff } },
          { state: "abandoned", stagingDeadlineAt: { lte: cutoff } },
        ],
      },
      orderBy: [
        { stagingDeadlineAt: "asc" },
        { destinationGenerationId: "asc" },
      ],
      take: limit,
    })
  let cleaned = 0
  if (candidates.length === 0) return { cleaned }
  const store = options.store ?? configuredGaCaptureStore()
  for (const candidate of candidates) {
    const fenced = await prisma.$transaction(async (tx) => {
      await lockGenerationsIfPresent(tx, [candidate.destinationGenerationId])
      const row = await lockImport(tx, candidate.destinationGenerationId)
      if (
        !row ||
        row.state === "bound" ||
        !row.stagingDeadlineAt ||
        row.stagingDeadlineAt > cutoff ||
        !row.storageKey ||
        !row.artifactSha256
      )
        return null
      if (
        row.storageKey !==
        gaCaptureStorageKey(row.destinationGenerationId, row.artifactSha256)
      )
        conflict("GA import cleanup key differs")
      await globalBudgetLock(tx)
      await tx.recommendationPrecomputedGaCaptureImport.update({
        where: { destinationGenerationId: row.destinationGenerationId },
        data: {
          state: "abandoned",
          copyLeaseExpiresAt: null,
          lastCleanupAt: now,
          updatedAt: now,
        },
      })
      return {
        storageKey: row.storageKey,
        destinationGenerationId: row.destinationGenerationId,
      }
    })
    if (!fenced) continue
    await store.delete(fenced.storageKey)
    await prisma.$transaction(async (tx) => {
      await globalBudgetLock(tx)
      await tx.recommendationPrecomputedGaCaptureImport.updateMany({
        where: {
          destinationGenerationId: fenced.destinationGenerationId,
          state: "abandoned",
        },
        data: { cleanedAt: now, lastCleanupAt: now, tempReservedBytes: 0n },
      })
    })
    cleaned++
  }
  return { cleaned }
}

async function lockGenerationsIfPresent(tx: Tx, ids: string[]) {
  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM recommendation_precomputed_generation
    WHERE id IN (${Prisma.join([...new Set(ids)].sort())}) ORDER BY id FOR UPDATE`)
}
