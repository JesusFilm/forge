import { createHash } from "node:crypto"
import { z } from "zod"
import { RecommendationInputError } from "./errors"
import type { ConversionHolds } from "./legacy-candidate-trace-conversion.service"
import type { LegacyDetailRetirementManifest } from "./legacy-detail-retirement.service"

const RunId = z.string().min(1).max(191)
const Hash = z.string().regex(/^[a-f0-9]{64}$/)
const PlanBody = z.object({
  version: z.literal(1),
  targetDatabaseHash: Hash,
  createdBefore: z.string().datetime(),
  frozenAt: z.string().datetime(),
  stopAfter: z.string().datetime(),
  minFilesystemAvailableBytes: z.number().int().positive(),
  maxWalBytes: z.number().int().positive(),
  runIds: z.array(RunId).min(1).max(300_000),
})
export type RetirementCampaignPlan = z.infer<typeof PlanBody> & {
  digest: string
}

const Capacity = z.object({
  measuredAt: z.string().datetime(),
  targetDatabaseHash: Hash,
  filesystemAvailableBytes: z.number().int().nonnegative(),
  walBytes: z.number().int().nonnegative(),
  httpHealthy: z.literal(true),
  workerHealthy: z.literal(true),
  compactWritersConverged: z.literal(true),
  retentionHealthy: z.literal(true),
})
const HoldsEnvelope = z.object({
  reviewedAt: z.string().datetime(),
  sourceReceiptSha256: Hash,
  holds: z.object({
    qualitySelectorSha256: Hash,
    qualityRunIds: z.array(RunId).length(64),
    activeInvestigationRunIds: z.array(RunId).max(10_000),
  }),
})

function hash(body: object): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex")
}

export function makeRetirementCampaignPlan(
  body: z.infer<typeof PlanBody>,
): RetirementCampaignPlan {
  const parsed = PlanBody.parse(body)
  const plan = { ...parsed, digest: hash(parsed) }
  validateRetirementCampaignPlan(plan)
  return plan
}

export function validateRetirementCampaignPlan(
  input: unknown,
): asserts input is RetirementCampaignPlan {
  const parsed = PlanBody.extend({ digest: Hash }).parse(input)
  const { digest, ...body } = parsed
  if (
    digest !== hash(body) ||
    Date.parse(body.createdBefore) > Date.parse(body.frozenAt) ||
    Date.parse(body.stopAfter) <= Date.parse(body.frozenAt) ||
    Date.parse(body.stopAfter) - Date.parse(body.frozenAt) > 72 * 60 * 60_000 ||
    body.runIds.some((id, index) => index > 0 && id <= body.runIds[index - 1]!)
  )
    throw new RecommendationInputError(
      "Invalid finite retirement campaign plan",
    )
}

/** A fresh external capacity/fleet receipt is mandatory before every batch. */
export function assertRetirementCampaignCapacity(
  input: unknown,
  plan: RetirementCampaignPlan,
  now = Date.now(),
): void {
  const capacity = Capacity.parse(input)
  const age = now - Date.parse(capacity.measuredAt)
  if (
    capacity.targetDatabaseHash !== plan.targetDatabaseHash ||
    age < 0 ||
    age > 2 * 60_000 ||
    now >= Date.parse(plan.stopAfter) ||
    capacity.filesystemAvailableBytes < plan.minFilesystemAvailableBytes ||
    capacity.walBytes > plan.maxWalBytes
  )
    throw new RecommendationInputError(
      "Retirement campaign capacity, fleet or time gate failed",
    )
}

export function assertRetirementCampaignHolds(
  input: unknown,
  now = Date.now(),
): { sourceReceiptSha256: string; holds: ConversionHolds } {
  const envelope = HoldsEnvelope.parse(input)
  const age = now - Date.parse(envelope.reviewedAt)
  if (age < 0 || age > 2 * 60_000)
    throw new RecommendationInputError(
      "Private investigation and quality hold review is stale",
    )
  return envelope
}

export function retirementCampaignBatches(plan: RetirementCampaignPlan) {
  const batches: string[][] = []
  for (let offset = 0; offset < plan.runIds.length; offset += 10)
    batches.push(plan.runIds.slice(offset, offset + 10))
  return batches
}

export type RetirementCampaignProgress = {
  planDigest: string
  nextBatch: number
  converted: number
  retired: number
  rows: number
  bytes: number
}

export type RetirementCampaignAdapter = {
  readCapacity: () => unknown
  readHolds: () => unknown
  readProgress: () => RetirementCampaignProgress | undefined
  saveProgress: (progress: RetirementCampaignProgress) => void
  readManifest: (index: number) => LegacyDetailRetirementManifest | undefined
  hasCompletedReceipt: (
    manifest: LegacyDetailRetirementManifest,
  ) => Promise<boolean>
  saveManifest: (
    index: number,
    manifest: LegacyDetailRetirementManifest,
  ) => void
  freeze: (
    runIds: string[],
    holds: ConversionHolds,
  ) => Promise<LegacyDetailRetirementManifest>
  execute: (manifest: LegacyDetailRetirementManifest) => Promise<{
    status: "completed" | "already-completed" | "retention-busy" | "dry-run"
    converted: number
    retired: number
    rows: number
    bytes: number
  }>
}

/** The adapter stores manifests before execution and progress only after commit. */
export async function executeRetirementCampaign(
  plan: RetirementCampaignPlan,
  maxBatches: number,
  adapter: RetirementCampaignAdapter,
  now: () => number = Date.now,
): Promise<{
  status: "roster-complete" | "paused"
  progress: RetirementCampaignProgress
  totalBatches: number
}> {
  validateRetirementCampaignPlan(plan)
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 1_000)
    throw new RecommendationInputError("Require 1–1000 batches per invocation")
  const totalBatches = Math.ceil(plan.runIds.length / 10)
  let progress = adapter.readProgress() ?? {
    planDigest: plan.digest,
    nextBatch: 0,
    converted: 0,
    retired: 0,
    rows: 0,
    bytes: 0,
  }
  if (
    progress.planDigest !== plan.digest ||
    progress.nextBatch > totalBatches ||
    !Number.isInteger(progress.nextBatch) ||
    progress.nextBatch < 0
  )
    throw new RecommendationInputError(
      "Campaign progress does not match the reviewed plan",
    )

  let processed = 0
  while (progress.nextBatch < totalBatches && processed < maxBatches) {
    const runIds = plan.runIds.slice(
      progress.nextBatch * 10,
      progress.nextBatch * 10 + 10,
    )
    const existing = adapter.readManifest(progress.nextBatch)
    const matchesRoster = (manifest: LegacyDetailRetirementManifest) =>
      manifest.version === 2 &&
      manifest.targetDatabaseHash === plan.targetDatabaseHash &&
      manifest.createdBefore === plan.createdBefore &&
      manifest.candidates.map((candidate) => candidate.runId).join("\0") ===
        runIds.join("\0")
    const tally = (manifest: LegacyDetailRetirementManifest) => {
      const converted = manifest.candidates.filter(
        (candidate) => candidate.action !== "retire",
      ).length
      return {
        converted,
        retired: manifest.candidates.length - converted,
        rows: manifest.candidates.reduce(
          (sum, candidate) => sum + candidate.rows,
          0,
        ),
        bytes: manifest.candidates.reduce(
          (sum, candidate) => sum + candidate.bytes,
          0,
        ),
      }
    }
    const advance = (manifest: LegacyDetailRetirementManifest) => {
      const counts = tally(manifest)
      progress = {
        planDigest: plan.digest,
        nextBatch: progress.nextBatch + 1,
        converted: progress.converted + counts.converted,
        retired: progress.retired + counts.retired,
        rows: progress.rows + counts.rows,
        bytes: progress.bytes + counts.bytes,
      }
      adapter.saveProgress(progress)
      processed++
    }
    if (existing) {
      if (!matchesRoster(existing))
        throw new RecommendationInputError(
          "Saved batch differs from the finite roster",
        )
      // The database receipt is authoritative if a commit succeeded before
      // the private progress file was saved. No write or current hold review is
      // needed to record a batch already committed under its frozen manifest.
      if (await adapter.hasCompletedReceipt(existing)) {
        advance(existing)
        continue
      }
    }
    assertRetirementCampaignCapacity(adapter.readCapacity(), plan, now())
    const reviewedHolds = assertRetirementCampaignHolds(
      adapter.readHolds(),
      now(),
    )
    const holds = reviewedHolds.holds
    const manifest = existing ?? (await adapter.freeze(runIds, holds))
    if (
      !matchesRoster(manifest) ||
      JSON.stringify(manifest.holds) !== JSON.stringify(holds)
    )
      throw new RecommendationInputError(
        "Batch manifest differs from current holds or finite roster",
      )
    if (!existing) adapter.saveManifest(progress.nextBatch, manifest)
    // Freezing may spend most of the receipt lifetime. Recheck the external
    // fleet/capacity evidence and private investigations immediately before
    // the transaction that can delete stage rows.
    assertRetirementCampaignCapacity(adapter.readCapacity(), plan, now())
    const currentHolds = assertRetirementCampaignHolds(
      adapter.readHolds(),
      now(),
    )
    if (
      currentHolds.sourceReceiptSha256 !== reviewedHolds.sourceReceiptSha256 ||
      JSON.stringify(currentHolds.holds) !== JSON.stringify(manifest.holds)
    )
      throw new RecommendationInputError(
        "Batch protection changed after manifest freeze",
      )
    const result = await adapter.execute(manifest)
    if (result.status === "retention-busy") break
    const counts = tally(manifest)
    if (
      result.status === "dry-run" ||
      (result.status === "completed" &&
        (result.converted !== counts.converted ||
          result.retired !== counts.retired ||
          result.rows !== counts.rows ||
          result.bytes !== counts.bytes))
    )
      throw new RecommendationInputError(
        "Batch execution receipt differs from manifest",
      )
    advance(manifest)
  }
  return {
    status: progress.nextBatch === totalBatches ? "roster-complete" : "paused",
    progress,
    totalBatches,
  }
}
