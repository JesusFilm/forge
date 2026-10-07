import { createHash } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { precomputedCtrPolicyDigest } from "./ctr-report"
import { liveEvidenceDigest, loadLiveEvidence } from "./live-evidence"

const start = new Date("2026-09-29T00:00:00.000Z")
const end = new Date("2026-10-06T00:00:00.000Z")
const now = new Date("2026-10-07T12:00:00.000Z")
const settings = {
  baselineHumanVisitCtr: 0.04,
  minimumDetectableAbsoluteUplift: 0.02,
  minimumPracticalAbsoluteUplift: 0.01,
  plannedPower: 0.8,
  minimumEligibleVisitsPerArm: 100,
  minimumIndependentBrowsersPerArm: 100,
  minimumDurationHours: 168,
  lateEventCutoffHours: 48,
  maximumActualFallbackRate: 0.05,
  maximumUnlinkedDeliveryRate: 0.01,
}
const digest = (letter: string) => letter.repeat(64)
const sourceSetDigest = createHash("sha256")
  .update(JSON.stringify(["video-1"]))
  .digest("hex")
const agreement = {
  authority: "prelaunch_agreed" as const,
  settingsDigest: precomputedCtrPolicyDigest(settings),
  baselineReportDigest: digest("b"),
  launchCapacityReceiptDigest: digest("d"),
}
const counters = {
  delivery_attempt: 100,
  delivery_excluded: 0,
  delivery_unknown: 0,
  delivery_missing_identity: 0,
  delivery_verification_required: 0,
  delivery_verification_rejected: 0,
  delivery_verification_unavailable: 0,
  delivery_qualified: 100,
  delivery_inactive: 0,
  delivery_private: 0,
  delivery_unavailable: 0,
  delivery_rejected: 0,
  click_attempt: 4,
  click_ack: 4,
  click_unavailable: 0,
}
const web = {
  status: "complete" as const,
  contractVersion: "watch-public-measurement-v1" as const,
  startHour: start.toISOString(),
  endHourExclusive: end.toISOString(),
  observedAt: now.toISOString(),
  requestedHours: 168,
  coveredHours: 168,
  missingHours: [],
  imbalancedHours: [],
  counters,
  counterUnit: "web_request_attempts_not_distinct_visits" as const,
}

function db() {
  return {
    recommendationPrecomputedBaselineRun: {
      findFirst: vi.fn().mockResolvedValue({
        id: "baseline-1",
        startsAt: start,
        endsAt: end,
        stoppedAt: null,
        verificationAuthority: "live_verified",
        finalReportDigest: digest("b"),
        finalReport: {
          isFinal: true,
          eligibleVisits: 100,
          visitCtr: 0.04,
        },
      }),
    },
    recommendationPrecomputedGeneration: {
      findUnique: vi.fn().mockResolvedValue({
        status: "complete",
        protocolVersion: 2,
        modelId: "gpt-6-astra",
        inputMode: "historical_analytics",
        inputCutoff: new Date("2026-10-05T00:00:00.000Z"),
        historicalQualificationDigest: digest("c"),
        expectedSourceCount: 1,
        sourceSetDigest,
      }),
    },
    recommendationPrecomputedSource: { count: vi.fn().mockResolvedValue(1) },
    recommendationPrecomputedModelCall: {
      count: vi
        .fn()
        .mockImplementation(({ where }: { where: { costUsd?: null } }) =>
          Promise.resolve(where.costUsd === null ? 0 : 1),
        ),
    },
    recommendationPrecomputedLaunchCapacityReceipt: {
      findUnique: vi.fn().mockResolvedValue({
        id: "capacity-1",
        generationId: "generation-1",
        status: "passed",
        receiptDigest: digest("d"),
        measuredAt: new Date("2026-10-07T11:55:00.000Z"),
        observedDbBytes: 1_000n,
        projectedBytes: 100n,
        availableAfterReserveBytes: 1_000n,
        measurement: {
          measurement: { clusterSystemId: "123" },
          reservedBuildBytes: 0,
        },
      }),
    },
    video: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "video-1",
          deletedAt: null,
          restrictViewPlatforms: [],
          dubs: [{ id: "dub-1" }],
          locales: [{ title: "Video" }],
        },
      ]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    $queryRaw: vi.fn().mockResolvedValue([
      {
        observed_db_bytes: 1_000n,
        cluster_system_id: "123",
        active_reserved_bytes: 0n,
      },
    ]),
  } as unknown as PrismaClient
}

describe("stored live launch evidence", () => {
  it("qualifies exact agreed policy, verified baseline, complete Web hours, actual build and fresh capacity", async () => {
    const result = await loadLiveEvidence(db(), {
      generationId: "generation-1",
      startsAt: new Date("2026-10-08T00:00:00.000Z"),
      policySettings: settings,
      policyAgreement: agreement,
      capacityReceiptId: "capacity-1",
      operatorId: "operator-1",
      now,
      webMeasurement: web,
    })
    expect(result.reasons).toEqual([])
    expect(result.snapshot).toMatchObject({
      baselineReportDigest: digest("b"),
      launchCapacityReceiptDigest: digest("d"),
      policyAuthority: "prelaunch_agreed",
    })
    expect(liveEvidenceDigest(result.snapshot)).toMatch(/^[a-f0-9]{64}$/)
    expect(
      liveEvidenceDigest(
        Object.fromEntries(
          Object.entries(result.snapshot).reverse(),
        ) as typeof result.snapshot,
      ),
    ).toBe(liveEvidenceDigest(result.snapshot))
  })

  it("rejects missing-hour evidence and a changed physical cluster independently", async () => {
    const fake = db()
    vi.mocked(fake.$queryRaw).mockResolvedValueOnce([
      {
        observed_db_bytes: 1_000n,
        cluster_system_id: "different",
        active_reserved_bytes: 0n,
      },
    ] as never)
    const result = await loadLiveEvidence(fake, {
      generationId: "generation-1",
      startsAt: new Date("2026-10-08T00:00:00.000Z"),
      policySettings: settings,
      policyAgreement: agreement,
      capacityReceiptId: "capacity-1",
      operatorId: "operator-1",
      now,
      webMeasurement: {
        ...web,
        status: "incomplete",
        coveredHours: 167,
        missingHours: ["2026100102"],
      },
    })
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "web_request_health_incomplete",
        "launch_capacity_unavailable",
      ]),
    )
  })

  it("rejects a complete one-source pilot when Admin finds another eligible Video", async () => {
    const fake = db()
    vi.mocked(fake.video.findMany).mockResolvedValueOnce([
      {
        id: "video-1",
        deletedAt: null,
        restrictViewPlatforms: [],
        dubs: [{ id: "dub-1" }],
        locales: [{ title: "Video" }],
      },
      {
        id: "video-2",
        deletedAt: null,
        restrictViewPlatforms: [],
        dubs: [{ id: "dub-2" }],
        locales: [{ title: "Video 2" }],
      },
    ] as never)
    const result = await loadLiveEvidence(fake, {
      generationId: "generation-1",
      startsAt: new Date("2026-10-08T00:00:00.000Z"),
      policySettings: settings,
      policyAgreement: agreement,
      capacityReceiptId: "capacity-1",
      operatorId: "operator-1",
      now,
      webMeasurement: web,
    })
    expect(result.facts.generation).toMatchObject({
      expectedSourceCount: 1,
      sourceCount: 1,
      catalogSourceCount: 2,
    })
    expect(result.reasons).toContain("actual_catalog_build_unverified")
  })
})
