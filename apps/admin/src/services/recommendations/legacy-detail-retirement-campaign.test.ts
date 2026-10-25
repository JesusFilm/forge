import { describe, expect, it } from "vitest"
import {
  assertRetirementCampaignCapacity,
  executeRetirementCampaign,
  makeRetirementCampaignPlan,
  retirementCampaignBatches,
  validateRetirementCampaignPlan,
  type RetirementCampaignAdapter,
  type RetirementCampaignProgress,
} from "./legacy-detail-retirement-campaign"
import type { LegacyDetailRetirementManifest } from "./legacy-detail-retirement.service"

const frozenAt = "2026-09-30T00:00:00.000Z"
const plan = makeRetirementCampaignPlan({
  version: 1,
  targetDatabaseHash: "a".repeat(64),
  createdBefore: "2026-09-28T00:00:00.000Z",
  frozenAt,
  stopAfter: "2026-10-01T00:00:00.000Z",
  minFilesystemAvailableBytes: 10_000,
  maxWalBytes: 2_000,
  runIds: Array.from(
    { length: 21 },
    (_, i) => `run-${String(i).padStart(3, "0")}`,
  ),
})

const capacity = {
  measuredAt: "2026-09-30T00:01:00.000Z",
  targetDatabaseHash: plan.targetDatabaseHash,
  filesystemAvailableBytes: 11_000,
  walBytes: 1_000,
  httpHealthy: true,
  workerHealthy: true,
  compactWritersConverged: true,
  retentionHealthy: true,
}
const now = Date.parse("2026-09-30T00:02:00.000Z")
const holds = {
  qualitySelectorSha256: "b".repeat(64),
  qualityRunIds: Array.from({ length: 64 }, (_, i) => `quality-${i}`),
  activeInvestigationRunIds: [],
}
const holdsReceipt = {
  reviewedAt: "2026-09-30T00:01:00.000Z",
  sourceReceiptSha256: "d".repeat(64),
  holds,
}

function campaignHarness() {
  const manifests = new Map<number, LegacyDetailRetirementManifest>()
  const receipts = new Set<string>()
  let progress: RetirementCampaignProgress | undefined
  let freezeCalls = 0
  let commitCalls = 0
  const adapter: RetirementCampaignAdapter = {
    readCapacity: () => capacity,
    readHolds: () => holdsReceipt,
    readProgress: () => progress,
    saveProgress: (saved) => {
      progress = saved
    },
    readManifest: (index) => manifests.get(index),
    hasCompletedReceipt: async (manifest) => receipts.has(manifest.digest),
    saveManifest: (index, manifest) => {
      manifests.set(index, manifest)
    },
    freeze: async (runIds, currentHolds) => {
      freezeCalls++
      return {
        version: 2,
        targetDatabaseHash: plan.targetDatabaseHash,
        createdBefore: plan.createdBefore,
        frozenAt,
        holds: currentHolds,
        candidates: runIds.map((runId) => ({
          runId,
          action: runId === "run-010" ? "preserve" : "retire",
          fingerprint: "c".repeat(32),
          rows: 1,
          bytes: 2,
        })),
        digest: runIds[0]!,
      }
    },
    execute: async (manifest) => {
      if (receipts.has(manifest.digest))
        return {
          status: "already-completed",
          converted: 0,
          retired: 0,
          rows: 0,
          bytes: 0,
        }
      receipts.add(manifest.digest)
      commitCalls++
      const converted = manifest.candidates.filter(
        (candidate) => candidate.action !== "retire",
      ).length
      return {
        status: "completed",
        converted,
        retired: manifest.candidates.length - converted,
        rows: manifest.candidates.length,
        bytes: manifest.candidates.length * 2,
      }
    },
  }
  return {
    adapter,
    manifests,
    receipts,
    get progress() {
      return progress
    },
    get freezeCalls() {
      return freezeCalls
    },
    get commitCalls() {
      return commitCalls
    },
  }
}

describe("finite legacy retirement campaign gates", () => {
  it("pins an explicit ordered roster to three bounded batches", () => {
    validateRetirementCampaignPlan(plan)
    expect(
      retirementCampaignBatches(plan).map((batch) => batch.length),
    ).toEqual([10, 10, 1])
    expect(() =>
      validateRetirementCampaignPlan({
        ...plan,
        runIds: [...plan.runIds].reverse(),
      }),
    ).toThrow()
    expect(() =>
      validateRetirementCampaignPlan({ ...plan, digest: "b".repeat(64) }),
    ).toThrow()
  })

  it("stops on stale or unsafe external capacity and fleet receipts", () => {
    expect(() =>
      assertRetirementCampaignCapacity(capacity, plan, now),
    ).not.toThrow()
    expect(() =>
      assertRetirementCampaignCapacity(capacity, plan, now + 61_000),
    ).toThrow()
    expect(() =>
      assertRetirementCampaignCapacity(
        { ...capacity, filesystemAvailableBytes: 9_999 },
        plan,
        now,
      ),
    ).toThrow()
    expect(() =>
      assertRetirementCampaignCapacity(
        { ...capacity, walBytes: 2_001 },
        plan,
        now,
      ),
    ).toThrow()
    expect(() =>
      assertRetirementCampaignCapacity(
        { ...capacity, workerHealthy: false },
        plan,
        now,
      ),
    ).toThrow()
  })

  it("resumes a finite roster across invocations without repeating completed batches", async () => {
    const harness = campaignHarness()
    const first = await executeRetirementCampaign(
      plan,
      2,
      harness.adapter,
      () => now,
    )
    expect(first.status).toBe("paused")
    expect(first.progress.nextBatch).toBe(2)
    const second = await executeRetirementCampaign(
      plan,
      2,
      harness.adapter,
      () => now,
    )
    expect(second.status).toBe("roster-complete")
    expect(second.progress).toMatchObject({
      nextBatch: 3,
      converted: 1,
      retired: 20,
      rows: 21,
      bytes: 42,
    })
    expect(harness.freezeCalls).toBe(3)
    expect(harness.commitCalls).toBe(3)
  })

  it("replays a committed batch after progress-file failure through its durable receipt", async () => {
    const harness = campaignHarness()
    const saveProgress = harness.adapter.saveProgress
    let failOnce = true
    harness.adapter.saveProgress = (progress) => {
      if (failOnce) {
        failOnce = false
        throw new Error("simulated progress write failure")
      }
      saveProgress(progress)
    }
    await expect(
      executeRetirementCampaign(plan, 1, harness.adapter, () => now),
    ).rejects.toThrow("simulated progress write failure")
    expect(harness.commitCalls).toBe(1)
    expect(harness.progress).toBeUndefined()
    // A new private investigation and expired capacity report must not trap
    // progress reconciliation for a batch whose database receipt is committed.
    harness.adapter.readHolds = () => ({
      ...holdsReceipt,
      sourceReceiptSha256: "e".repeat(64),
      holds: { ...holds, activeInvestigationRunIds: ["run-000"] },
    })
    harness.adapter.readCapacity = () => ({
      ...capacity,
      measuredAt: "2026-09-29T23:50:00.000Z",
    })
    const resumed = await executeRetirementCampaign(
      plan,
      1,
      harness.adapter,
      () => now,
    )
    expect(resumed.progress.nextBatch).toBe(1)
    expect(resumed.progress.rows).toBe(10)
    expect(harness.freezeCalls).toBe(1)
    expect(harness.commitCalls).toBe(1)
  })

  it("rejects a stale external investigation review before freeze and after freeze", async () => {
    const stale = {
      ...holdsReceipt,
      reviewedAt: "2026-09-29T23:50:00.000Z",
    }
    const before = campaignHarness()
    before.adapter.readHolds = () => stale
    await expect(
      executeRetirementCampaign(plan, 1, before.adapter, () => now),
    ).rejects.toThrow("stale")
    expect(before.freezeCalls).toBe(0)

    const after = campaignHarness()
    let reads = 0
    after.adapter.readHolds = () => (++reads === 1 ? holdsReceipt : stale)
    let executions = 0
    after.adapter.execute = async () => {
      executions++
      throw new Error("should not execute")
    }
    await expect(
      executeRetirementCampaign(plan, 1, after.adapter, () => now),
    ).rejects.toThrow("stale")
    expect(after.freezeCalls).toBe(1)
    expect(executions).toBe(0)
  })

  it("stops before the next batch when capacity goes stale", async () => {
    const harness = campaignHarness()
    let reads = 0
    harness.adapter.readCapacity = () =>
      ++reads <= 2
        ? capacity
        : { ...capacity, measuredAt: "2026-09-29T23:50:00.000Z" }
    await expect(
      executeRetirementCampaign(plan, 3, harness.adapter, () => now),
    ).rejects.toThrow()
    expect(harness.progress?.nextBatch).toBe(1)
    expect(harness.commitCalls).toBe(1)
    expect(harness.freezeCalls).toBe(1)
  })

  it("rechecks capacity after a slow freeze and refuses execution when it expires", async () => {
    const harness = campaignHarness()
    let clock = Date.parse("2026-09-30T00:02:59.000Z")
    const freeze = harness.adapter.freeze
    harness.adapter.freeze = async (runIds, currentHolds) => {
      const manifest = await freeze(runIds, currentHolds)
      clock += 2_000
      return manifest
    }
    let executions = 0
    harness.adapter.execute = async () => {
      executions++
      throw new Error("should not execute")
    }
    await expect(
      executeRetirementCampaign(plan, 1, harness.adapter, () => clock),
    ).rejects.toThrow()
    expect(executions).toBe(0)
    expect(harness.manifests.size).toBe(1)
    expect(harness.progress).toBeUndefined()
  })

  it("rechecks private holds after freeze and refuses deletion on a new investigation", async () => {
    const harness = campaignHarness()
    let reads = 0
    harness.adapter.readHolds = () =>
      ++reads === 1
        ? holdsReceipt
        : {
            ...holdsReceipt,
            sourceReceiptSha256: "e".repeat(64),
            holds: { ...holds, activeInvestigationRunIds: ["run-000"] },
          }
    let executions = 0
    harness.adapter.execute = async () => {
      executions++
      throw new Error("should not execute")
    }
    await expect(
      executeRetirementCampaign(plan, 1, harness.adapter, () => now),
    ).rejects.toThrow("protection changed")
    expect(executions).toBe(0)
    expect(harness.progress).toBeUndefined()
  })

  it("refuses a changed hold before execution and a changed source before progress", async () => {
    const held = campaignHarness()
    const firstBatch = await held.adapter.freeze(
      plan.runIds.slice(0, 10),
      holds,
    )
    held.manifests.set(0, firstBatch)
    held.adapter.readHolds = () => ({
      ...holdsReceipt,
      sourceReceiptSha256: "e".repeat(64),
      holds: { ...holds, activeInvestigationRunIds: ["run-000"] },
    })
    let executions = 0
    held.adapter.execute = async () => {
      executions++
      throw new Error("should not execute")
    }
    await expect(
      executeRetirementCampaign(plan, 1, held.adapter, () => now),
    ).rejects.toThrow("current holds")
    expect(executions).toBe(0)
    expect(held.progress).toBeUndefined()

    const changed = campaignHarness()
    changed.adapter.execute = async () => {
      throw new Error("source fingerprint changed")
    }
    await expect(
      executeRetirementCampaign(plan, 3, changed.adapter, () => now),
    ).rejects.toThrow("source fingerprint changed")
    expect(changed.progress).toBeUndefined()
    expect(changed.freezeCalls).toBe(1)
  })
})
