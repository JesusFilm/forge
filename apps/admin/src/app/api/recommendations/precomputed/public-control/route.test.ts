import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  permission: vi.fn(),
  readiness: vi.fn(),
  prepare: vi.fn(),
  start: vi.fn(),
  evaluate: vi.fn(),
  promote: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  baselineStart: vi.fn(),
  baselineStop: vi.fn(),
  attestCapacity: vi.fn(),
}))
vi.mock("@/auth/session", () => ({
  resolveAdminSessionFromRequest: mocks.session,
}))
vi.mock("@/auth/permissions", () => ({ hasPermission: mocks.permission }))
vi.mock("@/auth/origins", () => ({
  isTrustedReturnToOrigin: (origin: string | null) =>
    origin === "http://localhost:3003",
}))
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("@/services/recommendations/precomputed/public-readiness", () => ({
  loadPrecomputedPublicReadiness: mocks.readiness,
}))
vi.mock("@/services/recommendations/precomputed/ctr-report", () => ({
  evaluatePublicPrecomputedCtr: mocks.evaluate,
  precomputedCtrPolicyDigest: () => "f".repeat(64),
}))
vi.mock("@/services/recommendations/precomputed/launch-capacity", () => ({
  PrecomputedLaunchCapacityError: class extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  },
  attestPrecomputedLaunchCapacity: mocks.attestCapacity,
}))
vi.mock("@/services/recommendations/precomputed/incumbent-baseline", () => ({
  PrecomputedBaselineError: class extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  },
  startPrecomputedIncumbentBaseline: mocks.baselineStart,
  stopPrecomputedIncumbentBaseline: mocks.baselineStop,
}))
vi.mock("@/services/recommendations/precomputed/public-control", () => ({
  PrecomputedPublicControlError: class extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  },
  preparePrecomputedPublicExperiment: mocks.prepare,
  startPrecomputedPublicExperiment: mocks.start,
  promotePrecomputedPublicExperiment: mocks.promote,
  rollbackPrecomputedPublicExperiment: mocks.rollback,
  releaseRetainedPrecomputedPublicExperiment: mocks.release,
}))

import { GET, POST } from "./route"

const digest = "a".repeat(64)
function request(body: unknown, origin = "http://localhost:3003") {
  return new Request(
    "http://localhost:3003/api/recommendations/precomputed/public-control",
    {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-forge-csrf": "precomputed-public-control-v1",
      },
      body: JSON.stringify(body),
    },
  )
}

describe("manual precomputed public control endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.setSystemTime(new Date("2026-10-06T00:05:00.000Z"))
    mocks.session.mockResolvedValue({
      principal: { id: "operator", role: "ADMIN" },
      authenticatedAt: new Date("2026-10-06T00:00:00.000Z"),
    })
    mocks.permission.mockReturnValue(true)
    mocks.readiness.mockResolvedValue({
      control: { mode: "incumbent", version: 1 },
      liveActivation: { status: "blocked" },
    })
    mocks.start.mockResolvedValue({ mode: "ab", version: 2 })
    mocks.promote.mockResolvedValue({ mode: "promoted", version: 3 })
    mocks.rollback.mockResolvedValue({ mode: "incumbent", version: 4 })
    mocks.release.mockResolvedValue({ mode: "incumbent", version: 5 })
    mocks.evaluate.mockResolvedValue({ status: "available" })
    mocks.baselineStart.mockResolvedValue({
      id: "baseline-1",
      status: "scheduled",
    })
    mocks.baselineStop.mockResolvedValue({
      id: "baseline-1",
      status: "stopped",
    })
    mocks.attestCapacity.mockResolvedValue({
      id: "capacity-1",
      status: "passed",
    })
  })

  it("previews a numeric digest without approving it or changing serving", async () => {
    const response = await POST(
      request({
        action: "policy_digest",
        policySettings: {
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
        },
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      policyDigest: "f".repeat(64),
      authority: "preview_only",
    })
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it("requires recent operator authentication to attest launch capacity", async () => {
    const body = {
      action: "attest_launch_capacity",
      generationId: "generation-1",
      measurement: {
        measuredAt: "2026-10-06T00:04:00.000Z",
        clusterSystemId: "123456789",
        observedDbBytes: 1_000_000,
        availableBytes: 10_000_000_000,
        reserveBytes: 5_000_000_000,
        projectedBytes: 1_000_000,
        sampleSourceCount: 100,
        sampleBytes: 100_000,
        source: "operator_verified_pgdata_df",
      },
    }
    expect((await POST(request(body))).status).toBe(200)
    expect(mocks.attestCapacity).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        generationId: "generation-1",
        operator: { id: "operator", role: "ADMIN" },
      }),
    )
    mocks.session.mockResolvedValue({
      principal: { id: "operator", role: "ADMIN" },
      authenticatedAt: new Date("2026-10-05T00:00:00.000Z"),
    })
    expect((await POST(request(body))).status).toBe(401)
  })

  it("returns an authenticated no-store readiness snapshot without changing serving", async () => {
    const response = await GET(
      new Request(
        "http://localhost:3003/api/recommendations/precomputed/public-control",
      ),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toMatchObject({
      readiness: { liveActivation: { status: "blocked" } },
    })
    expect(mocks.start).not.toHaveBeenCalled()
    mocks.session.mockResolvedValue(null)
    expect((await GET(new Request("http://localhost:3003"))).status).toBe(401)
  })

  it("rejects cross-origin, missing permission, and stale login before mutation", async () => {
    const input = {
      action: "start",
      experimentId: "experiment-1",
      expectedConfigurationDigest: digest,
      expectedControlVersion: 1,
      authority: "isolated_fixture",
    }
    expect(
      (await POST(request(input, "https://attacker.example"))).status,
    ).toBe(403)
    mocks.permission.mockReturnValue(false)
    expect((await POST(request(input))).status).toBe(403)
    mocks.permission.mockReturnValue(true)
    mocks.session.mockResolvedValue({
      principal: { id: "operator", role: "ADMIN" },
      authenticatedAt: new Date("2026-10-05T00:00:00.000Z"),
    })
    expect((await POST(request(input))).status).toBe(401)
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it("passes exact start and promotion targets; a stale transition stays a conflict", async () => {
    const start = await POST(
      request({
        action: "start",
        experimentId: "experiment-1",
        expectedConfigurationDigest: digest,
        expectedControlVersion: 1,
        authority: "isolated_fixture",
      }),
    )
    expect(start.status).toBe(200)
    expect(mocks.start).toHaveBeenCalledWith(
      {},
      {
        experimentId: "experiment-1",
        expectedConfigurationDigest: digest,
        expectedControlVersion: 1,
        authority: "isolated_fixture",
        operator: { id: "operator", role: "ADMIN" },
      },
    )
    const promote = await POST(
      request({
        action: "promote",
        expectedControlVersion: 2,
        expectedExperimentId: "experiment-1",
        expectedGenerationId: "generation-1",
        expectedReportRevision: 3,
        expectedReportEvidenceDigest: digest,
      }),
    )
    expect(promote.status).toBe(200)
    expect(mocks.promote).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        expectedControlVersion: 2,
        expectedGenerationId: "generation-1",
        expectedReportRevision: 3,
        expectedReportEvidenceDigest: digest,
      }),
    )
    const { PrecomputedPublicControlError } =
      await import("@/services/recommendations/precomputed/public-control")
    mocks.promote.mockRejectedValue(
      new PrecomputedPublicControlError("stale_control"),
    )
    expect(
      (
        await POST(
          request({
            action: "promote",
            expectedControlVersion: 2,
            expectedExperimentId: "experiment-1",
            expectedGenerationId: "generation-1",
            expectedReportRevision: 3,
            expectedReportEvidenceDigest: digest,
          }),
        )
      ).status,
    ).toBe(409)
  })

  it("lets a rollback restore incumbent even when recent authentication has expired", async () => {
    mocks.session.mockResolvedValue({
      principal: { id: "operator", role: "ADMIN" },
      authenticatedAt: new Date("2026-10-05T00:00:00.000Z"),
    })
    const response = await POST(
      request({
        action: "rollback",
        expectedControlVersion: 3,
        expectedExperimentId: "experiment-1",
        expectedGenerationId: "generation-1",
        expectedReportRevision: 2,
        expectedReportEvidenceDigest: digest,
        reasonCode: "operator_review",
      }),
    )
    expect(response.status).toBe(200)
    expect(mocks.rollback).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        expectedControlVersion: 3,
        expectedReportRevision: 2,
        reasonCode: "operator_review",
      }),
    )
    const release = await POST(
      request({
        action: "release_retained",
        expectedControlVersion: 4,
        expectedExperimentId: "experiment-1",
        reasonCode: "retention_horizon_complete",
      }),
    )
    expect(release.status).toBe(200)
    expect(mocks.release).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        expectedControlVersion: 4,
        expectedExperimentId: "experiment-1",
      }),
    )
  })

  it("requires recent authentication to start a baseline but allows an immediate stop", async () => {
    const baselineId = "550e8400-e29b-41d4-a716-446655440000"
    mocks.session.mockResolvedValue({
      principal: { id: "operator", role: "ADMIN" },
      authenticatedAt: new Date("2026-10-05T00:00:00.000Z"),
    })
    expect((await POST(request({ action: "start_baseline" }))).status).toBe(401)
    expect(mocks.baselineStart).not.toHaveBeenCalled()
    expect(
      (await POST(request({ action: "stop_baseline", baselineId }))).status,
    ).toBe(200)
    expect(mocks.baselineStop).toHaveBeenCalledWith(
      {},
      {
        baselineId,
        operator: { id: "operator", role: "ADMIN" },
      },
    )
    mocks.session.mockResolvedValue({
      principal: { id: "operator", role: "ADMIN" },
      authenticatedAt: new Date("2026-10-06T00:00:00.000Z"),
    })
    expect((await POST(request({ action: "start_baseline" }))).status).toBe(200)
    expect(mocks.baselineStart).toHaveBeenCalledWith(
      {},
      {
        operator: { id: "operator", role: "ADMIN" },
      },
    )
  })
})
