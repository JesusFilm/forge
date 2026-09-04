import { createHash } from "node:crypto"

import { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { MANAGER_BACKEND_PRINCIPAL } from "@/auth/principal"

import {
  normalizeWatchRouteAlertPath,
  WatchRouteAlertService,
} from "./watch-route-alert.service"
import { SeoAssertionReplayError } from "@/auth/seo-assertion-ledger"

const origin = "https://www.jesusfilm.org"
const assertion = {
  keyId: "test-key",
  environment: "test",
  audience: "forge-admin:seo:watch_alerts",
  capability: "watch_alerts" as const,
  requestDigest: "a".repeat(64),
  jtiHash: "b".repeat(64),
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
}

function serviceFor(tx: Record<string, unknown>) {
  const runDelegate = (tx.watchRouteAlertRun ?? {}) as Record<string, unknown>
  const client = {
    ...tx,
    watchRouteAlertRun: {
      findFirst: vi.fn(async () => null),
      ...runDelegate,
    },
  }
  return new WatchRouteAlertService({
    ...client,
    $transaction: vi.fn(async (callback: (client: unknown) => unknown) =>
      callback(client),
    ),
  } as never)
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    propertyId: "320198532",
    origin,
    mode: "LIVE",
    status: "RUNNING",
    windowStart: new Date("2026-08-25T00:00:00.000Z"),
    windowEnd: new Date("2026-09-01T00:00:00.000Z"),
    startedAt: new Date("2026-09-02T00:00:00.000Z"),
    completedAt: null,
    executionClaimExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
    executionFenceGeneration: 1,
    ...overrides,
  }
}

function completion(overrides: Record<string, unknown> = {}) {
  const status = (overrides.status ?? "completed") as
    | "completed"
    | "partial"
    | "failed"
  const laneStatuses =
    status === "failed"
      ? (["FAILED", "FAILED"] as const)
      : status === "partial"
        ? (["PARTIAL", "COMPLETE"] as const)
        : (["COMPLETE", "COMPLETE"] as const)
  return {
    runId: "run-1",
    claimGeneration: 1,
    claimToken: "a-valid-run-claim-token",
    status,
    manifestVersion: "manifest-v1",
    report: {
      schemaVersion: 1 as const,
      generatedAt: "2026-09-02T00:00:00.000Z",
      runKey: "watch-route-alerts:2026-09-02",
      lanes: [
        {
          source: "EXPLICIT_EVENT" as const,
          status: laneStatuses[0],
          countKind: "EVENT_COUNT" as const,
          rowCount: 0,
          windowStart: "2026-08-25T00:00:00.000Z",
          windowEnd: "2026-09-01T00:00:00.000Z",
          caveats: [],
        },
        {
          source: "LOCALIZED_TITLE" as const,
          status: laneStatuses[1],
          countKind: "PAGE_VIEWS" as const,
          rowCount: 0,
          windowStart: "2026-08-25T00:00:00.000Z",
          windowEnd: "2026-09-01T00:00:00.000Z",
          caveats: [],
        },
      ],
      validationCaveats: [],
      candidateTruncatedCount: 0,
      inconclusiveProbeCount: 0,
    },
    noiseCount: 2,
    observations: [],
    reprobes: [],
    ...overrides,
  }
}

it("normalizes identity to a route-safe queryless Watch path", () => {
  expect(
    normalizeWatchRouteAlertPath(
      `${origin}/watch/jesus_film.html/english.html?utm_secret=1#player`,
      origin,
    ),
  ).toBe("/watch/jesus_film.html/english.html")
  expect(() =>
    normalizeWatchRouteAlertPath(
      "https://attacker.example/watch/jesus.html/english.html",
      origin,
    ),
  ).toThrow("off_origin_path")
  expect(() =>
    normalizeWatchRouteAlertPath("/watch/%2e%2e/admin", origin),
  ).toThrow("invalid_watch_path")
})

describe("WatchRouteAlertService", () => {
  it("rejects Manager alert reads without the dedicated backend permission", async () => {
    await expect(
      serviceFor({}).listManagerAlerts({ user: null }),
    ).rejects.toThrow("Forbidden")
  })

  it("derives overall health from every property's latest run", async () => {
    const completeRun = {
      id: "run-a",
      propertyId: "property-a",
      mode: "LIVE",
      status: "COMPLETED",
      startedAt: new Date("2026-09-04T12:00:00.000Z"),
      completedAt: new Date("2026-09-04T12:05:00.000Z"),
      report: {
        schemaVersion: 1,
        generatedAt: "2026-09-04T12:05:00.000Z",
        runKey: "watch-route-alerts:2026-09-04",
        lanes: [
          {
            source: "EXPLICIT_EVENT",
            status: "COMPLETE",
            countKind: "EVENT_COUNT",
            rowCount: 0,
            windowStart: "2026-09-01T00:00:00.000Z",
            windowEnd: "2026-09-03T23:59:59.999Z",
            caveats: [],
          },
          {
            source: "LOCALIZED_TITLE",
            status: "COMPLETE",
            countKind: "PAGE_VIEWS",
            rowCount: 0,
            windowStart: "2026-09-01T00:00:00.000Z",
            windowEnd: "2026-09-03T23:59:59.999Z",
            caveats: [],
          },
        ],
        validationCaveats: [],
        candidateTruncatedCount: 0,
        inconclusiveProbeCount: 0,
      },
    }
    const failedRun = {
      ...completeRun,
      id: "run-b",
      propertyId: "property-b",
      status: "FAILED",
      startedAt: new Date("2026-09-04T12:10:00.000Z"),
      completedAt: new Date("2026-09-04T12:11:00.000Z"),
    }
    const tx = {
      watchRouteAlertRun: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(failedRun)
          .mockResolvedValueOnce(completeRun),
        findMany: vi.fn(async () => [completeRun, failedRun]),
      },
      watchRouteAlert: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
      },
    }

    const result = await serviceFor(tx).listManagerAlerts({
      user: MANAGER_BACKEND_PRINCIPAL,
    })

    expect(result.monitorState).toBe("UNAVAILABLE")
    expect(result.recoverySuppressed).toBe(true)
    expect(result.propertyRuns.map(({ propertyId }) => propertyId)).toEqual([
      "property-a",
      "property-b",
    ])
    expect(tx.watchRouteAlertRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { mode: "LIVE" } }),
    )
  })

  it("suppresses expired run and alert evidence before retention cleanup", async () => {
    const expiredRun = {
      id: "run-expired",
      propertyId: "property-a",
      mode: "LIVE",
      status: "COMPLETED",
      startedAt: new Date("2025-01-01T00:00:00.000Z"),
      completedAt: new Date("2025-01-01T00:05:00.000Z"),
      detailExpiresAt: new Date("2025-04-01T00:00:00.000Z"),
      detailExpiredAt: null,
      report: {
        schemaVersion: 1,
        generatedAt: "2025-01-01T00:05:00.000Z",
        runKey: "watch-route-alerts:2025-01-01",
        lanes: [
          {
            source: "EXPLICIT_EVENT",
            status: "COMPLETE",
            countKind: "EVENT_COUNT",
            rowCount: 1,
            windowStart: "2024-12-30T00:00:00.000Z",
            windowEnd: "2024-12-31T23:59:59.999Z",
            caveats: ["private provider detail"],
          },
          {
            source: "LOCALIZED_TITLE",
            status: "COMPLETE",
            countKind: "PAGE_VIEWS",
            rowCount: 0,
            windowStart: "2024-12-30T00:00:00.000Z",
            windowEnd: "2024-12-31T23:59:59.999Z",
            caveats: [],
          },
        ],
        validationCaveats: [],
        candidateTruncatedCount: 0,
        inconclusiveProbeCount: 0,
      },
    }
    const oldAlert = {
      id: "alert-old",
      propertyId: "property-a",
      origin,
      normalizedPath: "/watch/jesus.html",
      lifecycle: "OPEN",
      verdict: "SUPPORTED_ROUTE_FAILURE",
      severity: "HIGH",
      latestCount: 2,
      countKind: "EVENT_COUNT",
      activeUsers: 1,
      occurrenceCount: 1,
      firstSeenAt: new Date("2025-01-01T00:00:00.000Z"),
      lastSeenAt: new Date("2025-01-01T00:00:00.000Z"),
      lastProbedAt: null,
      lastHttpStatus: 404,
      manifestVersion: "manifest-v1",
      latestEvidence: { sources: ["EXPLICIT_EVENT"] },
    }
    const tx = {
      watchRouteAlertRun: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(expiredRun)
          .mockResolvedValueOnce(expiredRun),
        findMany: vi.fn(async () => [expiredRun]),
      },
      watchRouteAlert: {
        findMany: vi.fn(async () => [oldAlert]),
        count: vi.fn(async () => 1),
      },
    }

    const result = await serviceFor(tx).listManagerAlerts({
      user: MANAGER_BACKEND_PRINCIPAL,
    })

    expect(result.monitorState).toBe("UNAVAILABLE")
    expect(result.latestRun?.lanes).toEqual([])
    expect(result.latestRun?.validationCaveats).toEqual([
      "Run detail expired under the 90-day retention policy.",
    ])
    expect(result.items[0]?.sources).toEqual([])
  })

  it("derives an idempotency key and returns only one active claim", async () => {
    const upsert = vi.fn(async ({ create }) =>
      run({
        ...create,
        startedAt: new Date("2026-09-02T00:00:00.000Z"),
        completedAt: null,
        executionFenceGeneration: 1,
      }),
    )
    const tx = {
      watchRouteAlertDailyObservation: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(),
      },
      watchRouteAlertRun: {
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(),
        upsert,
      },
      watchRouteAlertEpisode: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(),
      },
      seoWorkloadAssertion: { create: vi.fn() },
      watchRouteAlertPropertyProgress: { findUnique: vi.fn(async () => null) },
      watchRouteAlert: { findMany: vi.fn(async () => []) },
    }

    const result = await serviceFor(tx).claimRun({
      assertion,
      input: {
        propertyId: "320198532",
        origin,
        contractVersion: "watch-route-alerts-v1",
        mode: "live",
        windowStart: "2026-08-30T00:00:00.000Z",
        windowEnd: "2026-09-01T23:59:59.999Z",
        leaseSeconds: 300,
        reprobeLimit: 10,
      },
    })

    const create = upsert.mock.calls[0]?.[0].create
    expect(create.idempotencyKey).toMatch(/^[a-f0-9]{64}$/u)
    expect(create.executionClaimTokenHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(create.executionClaimTokenHash).not.toBe(result.claim?.token)
    expect(create.windowStart).toEqual(new Date("2026-08-26T00:00:00.000Z"))
    expect(result).toMatchObject({ replayed: false, claim: { generation: 1 } })
  })

  it("reuses the bootstrap window key when a completed run is retried", async () => {
    const bootstrapStart = new Date("2026-08-26T00:00:00.000Z")
    const windowEnd = new Date("2026-09-01T23:59:59.999Z")
    const upsert = vi.fn(async ({ create }) =>
      run({
        ...create,
        id: "existing-run",
        status: "COMPLETED",
        windowStart: bootstrapStart,
        windowEnd,
        completedAt: new Date("2026-09-02T00:05:00.000Z"),
      }),
    )
    const tx = {
      watchRouteAlertDailyObservation: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(),
      },
      watchRouteAlertRun: {
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(),
        upsert,
      },
      watchRouteAlertEpisode: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(),
      },
      seoWorkloadAssertion: { create: vi.fn() },
      watchRouteAlertPropertyProgress: {
        findUnique: vi.fn(async () => ({
          lastCompleteWindowStart: bootstrapStart,
          lastCompleteWindowEnd: windowEnd,
        })),
      },
      watchRouteAlert: { findMany: vi.fn(async () => []) },
    }

    const result = await serviceFor(tx).claimRun({
      assertion,
      input: {
        propertyId: "320198532",
        origin,
        contractVersion: "watch-route-alerts-v1",
        mode: "live",
        windowStart: "2026-08-30T00:00:00.000Z",
        windowEnd: windowEnd.toISOString(),
        leaseSeconds: 300,
        reprobeLimit: 10,
      },
    })

    expect(upsert.mock.calls[0]?.[0].create.windowStart).toEqual(bootstrapStart)
    expect(result.claim).toBeNull()
  })

  it("extends the overlap window back to the last completed property window", async () => {
    const upsert = vi.fn(async ({ create }) => run(create))
    const tx = {
      watchRouteAlertDailyObservation: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(),
      },
      watchRouteAlertRun: {
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(),
        upsert,
      },
      watchRouteAlertEpisode: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(),
      },
      seoWorkloadAssertion: { create: vi.fn() },
      watchRouteAlertPropertyProgress: {
        findUnique: vi.fn(async () => ({
          lastCompleteWindowStart: new Date("2026-08-25T00:00:00.000Z"),
          lastCompleteWindowEnd: new Date("2026-08-28T23:59:59.999Z"),
        })),
      },
      watchRouteAlert: { findMany: vi.fn(async () => []) },
    }

    await serviceFor(tx).claimRun({
      assertion,
      input: {
        propertyId: "320198532",
        origin,
        contractVersion: "watch-route-alerts-v1",
        mode: "live",
        windowStart: "2026-09-01T00:00:00.000Z",
        windowEnd: "2026-09-03T23:59:59.999Z",
        leaseSeconds: 300,
        reprobeLimit: 10,
      },
    })

    expect(upsert.mock.calls[0]?.[0].create.windowStart).toEqual(
      new Date("2026-08-27T00:00:00.000Z"),
    )
  })

  it("returns an active live run instead of claiming a different window", async () => {
    const active = run({ id: "active-run" })
    const upsert = vi.fn()
    const tx = {
      watchRouteAlertDailyObservation: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(),
      },
      watchRouteAlertRun: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => active),
        updateMany: vi.fn(),
        upsert,
      },
      watchRouteAlertEpisode: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(),
      },
      seoWorkloadAssertion: { create: vi.fn() },
      watchRouteAlertPropertyProgress: { findUnique: vi.fn(async () => null) },
      watchRouteAlert: { findMany: vi.fn(async () => []) },
    }

    const result = await serviceFor(tx).claimRun({
      assertion,
      input: {
        propertyId: "320198532",
        origin,
        contractVersion: "watch-route-alerts-v1",
        mode: "live",
        windowStart: "2026-09-01T00:00:00.000Z",
        windowEnd: "2026-09-03T23:59:59.999Z",
        leaseSeconds: 300,
        reprobeLimit: 10,
      },
    })

    expect(result).toMatchObject({
      replayed: true,
      claim: null,
      run: { id: "active-run", status: "running" },
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  it("rejects a replayed signed workload assertion before claiming a run", async () => {
    const replay = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "6.19.3" },
    )
    const tx = {
      seoWorkloadAssertion: {
        create: vi.fn(async () => {
          throw replay
        }),
      },
    }

    await expect(
      serviceFor(tx).claimRun({
        assertion,
        input: {
          propertyId: "320198532",
          origin,
          contractVersion: "watch-route-alerts-v1",
          mode: "live",
          windowStart: "2026-08-30T00:00:00.000Z",
          windowEnd: "2026-09-01T23:59:59.999Z",
          leaseSeconds: 300,
          reprobeLimit: 10,
        },
      }),
    ).rejects.toBeInstanceOf(SeoAssertionReplayError)
  })

  it("reclaims an expired running lease with a new generation and token", async () => {
    const existing = run({
      id: "existing-run",
      executionClaimExpiresAt: new Date("2000-01-01T00:00:00.000Z"),
      executionFenceGeneration: 1,
    })
    const updateMany = vi.fn(
      async (_input: {
        data: {
          executionFenceGeneration: { increment: number }
          executionClaimTokenHash: string
        }
      }) => ({ count: 1 }),
    )
    const tx = {
      watchRouteAlertDailyObservation: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(),
      },
      watchRouteAlertRun: {
        findMany: vi.fn(async () => []),
        updateMany,
        upsert: vi.fn(async () => existing),
        findUniqueOrThrow: vi.fn(async () => ({
          ...existing,
          executionFenceGeneration: 2,
        })),
      },
      watchRouteAlertEpisode: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(),
      },
      seoWorkloadAssertion: { create: vi.fn() },
      watchRouteAlertPropertyProgress: {
        findUnique: vi.fn(async () => ({
          lastCompleteWindowStart: new Date("2026-08-30T00:00:00.000Z"),
          lastCompleteWindowEnd: new Date("2026-08-31T23:59:59.999Z"),
        })),
      },
      watchRouteAlert: { findMany: vi.fn(async () => []) },
    }

    const result = await serviceFor(tx).claimRun({
      assertion,
      input: {
        propertyId: "320198532",
        origin,
        contractVersion: "watch-route-alerts-v1",
        mode: "live",
        windowStart: "2026-08-30T00:00:00.000Z",
        windowEnd: "2026-09-01T23:59:59.999Z",
        leaseSeconds: 300,
        reprobeLimit: 10,
      },
    })

    expect(result).toMatchObject({
      replayed: false,
      claim: { generation: 2 },
    })
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          executionFenceGeneration: { increment: 1 },
          executionClaimTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    )
    expect(updateMany.mock.calls[0]?.[0].data.executionClaimTokenHash).not.toBe(
      result.claim?.token,
    )
  })

  it("rejects a completion whose lease has expired", async () => {
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      watchRouteAlertRun: {
        findUnique: vi.fn(async () => run()),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    }

    await expect(
      serviceFor(tx).completeRun({ assertion, input: completion() }),
    ).rejects.toMatchObject({
      code: "run_fence_lost",
    })
    expect(tx.watchRouteAlertRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          executionClaimExpiresAt: { gt: expect.any(Date) },
        }),
      }),
    )
  })

  it("rejects completed status when either required evidence lane is degraded", async () => {
    const partialReport = completion({ status: "partial" }).report
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      watchRouteAlertRun: {
        findUnique: vi.fn(async () => run()),
        updateMany: vi.fn(),
      },
    }

    await expect(
      serviceFor(tx).completeRun({
        assertion,
        input: completion({ status: "completed", report: partialReport }),
      }),
    ).rejects.toMatchObject({ code: "invalid_run_report" })
    expect(tx.watchRouteAlertRun.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ["DRY_RUN", "completed"],
    ["LIVE", "partial"],
  ] as const)(
    "%s completion does not recover alerts for %s evidence",
    async (mode, status) => {
      const recover = vi.fn()
      const tx = {
        seoWorkloadAssertion: { create: vi.fn() },
        watchRouteAlertRun: {
          findUnique: vi.fn(async () => run({ mode })),
          updateMany: vi.fn(async () => ({ count: 1 })),
          update: vi.fn(async ({ data }) => ({
            ...run({ mode }),
            ...data,
            status: status.toUpperCase(),
            completedAt: new Date(),
          })),
        },
        watchRouteAlert: { findUnique: vi.fn(), updateMany: recover },
        watchRouteAlertEpisode: { updateMany: vi.fn() },
        watchRouteAlertPropertyProgress: {
          findUnique: vi.fn(),
          upsert: vi.fn(),
        },
      }

      await serviceFor(tx).completeRun({
        assertion,
        input: completion({
          status,
          reprobes: [
            {
              path: "/watch/jesus.html/english.html",
              probe: {
                kind: "healthy_html",
                status: 200,
                probedAt: "2026-09-02T00:00:00.000Z",
                finalUrl: `${origin}/watch/jesus.html/english.html`,
                contentType: "text/html; charset=utf-8",
              },
            },
          ],
        }),
      })

      expect(recover).not.toHaveBeenCalled()
    },
  )

  it("recovers an unobserved open alert after a complete live healthy re-probe", async () => {
    const recoverAlert = vi.fn(async () => ({ count: 1 }))
    const recoverEpisode = vi.fn()
    const advanceProgress = vi.fn()
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      watchRouteAlertRun: {
        findUnique: vi.fn(async () => run()),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async ({ data }) => ({
          ...run(),
          ...data,
          status: "COMPLETED",
          completedAt: new Date(),
        })),
      },
      watchRouteAlert: {
        findUnique: vi.fn(async () => ({ id: "alert-1", lifecycle: "OPEN" })),
        updateMany: recoverAlert,
      },
      watchRouteAlertEpisode: { updateMany: recoverEpisode },
      watchRouteAlertPropertyProgress: {
        findUnique: vi.fn(async () => null),
        upsert: advanceProgress,
      },
    }
    const path = "/watch/jesus.html/english.html"

    await serviceFor(tx).completeRun({
      assertion,
      input: completion({
        reprobes: [
          {
            path,
            probe: {
              kind: "healthy_html",
              status: 200,
              probedAt: "2026-09-02T00:00:00.000Z",
              finalUrl: `${origin}${path}`,
              contentType: "text/html; charset=utf-8",
            },
          },
        ],
      }),
    })

    expect(recoverAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "alert-1", lifecycle: "OPEN" },
        data: expect.objectContaining({ lifecycle: "RECOVERED" }),
      }),
    )
    expect(recoverEpisode).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { alertId: "alert-1", recoveredAt: null },
        data: expect.objectContaining({ recoveredByRunId: "run-1" }),
      }),
    )
    expect(advanceProgress).toHaveBeenCalledWith(
      expect.objectContaining({ where: { propertyId: "320198532" } }),
    )
  })

  it.each([
    [
      "redirect",
      {
        kind: "redirect",
        status: 302,
        finalUrl: `${origin}/watch/jesus.html`,
        contentType: "text/html",
      },
    ],
    [
      "non-HTML",
      {
        kind: "inconclusive",
        status: 200,
        finalUrl: `${origin}/watch/jesus.html`,
        contentType: "application/json",
      },
    ],
    [
      "off-origin",
      {
        kind: "healthy_html",
        status: 200,
        finalUrl: "https://attacker.example/watch/jesus.html",
        contentType: "text/html",
      },
    ],
  ] as const)("does not recover from a %s probe", async (_label, probe) => {
    const recover = vi.fn(async () => ({ count: 1 }))
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      watchRouteAlertRun: {
        findUnique: vi.fn(async () => run()),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async ({ data }) => ({
          ...run(),
          ...data,
          status: "COMPLETED",
          completedAt: new Date(),
        })),
      },
      watchRouteAlert: {
        findUnique: vi.fn(async () => ({ id: "alert-1", lifecycle: "OPEN" })),
        updateMany: recover,
      },
      watchRouteAlertEpisode: { updateMany: vi.fn() },
      watchRouteAlertPropertyProgress: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(),
      },
    }

    await serviceFor(tx).completeRun({
      assertion,
      input: completion({
        reprobes: [
          {
            path: "/watch/jesus.html",
            probe: {
              ...probe,
              probedAt: "2026-09-02T00:00:00.000Z",
            },
          },
        ],
      }),
    })

    expect(recover).toHaveBeenCalledTimes(1)
    expect(recover).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "alert-1", lifecycle: "OPEN" },
        data: expect.objectContaining({
          lastProbedAt: new Date("2026-09-02T00:00:00.000Z"),
          lastProbeKind: probe.kind,
        }),
      }),
    )
    expect(recover).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lifecycle: "RECOVERED" }),
      }),
    )
  })

  it("recomputes semantic identity and reopens an alert inside completion", async () => {
    const alertUpsert = vi.fn(async ({ create }) => ({
      id: "alert-1",
      lifecycle: "RECOVERED",
      firstSeenAt: create.firstSeenAt,
      ...create,
    }))
    const alertUpdate = vi.fn()
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      watchRouteAlertRun: {
        findUnique: vi.fn(async () => run()),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async ({ data }) => ({
          ...run(),
          ...data,
          status: "COMPLETED",
          completedAt: new Date(),
        })),
      },
      watchRouteAlert: {
        upsert: alertUpsert,
        update: alertUpdate,
        findUnique: vi.fn(),
      },
      watchRouteAlertEpisode: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ sequence: 1 }),
        create: vi.fn(async ({ data }) => ({ id: "episode-2", ...data })),
        update: vi.fn(),
      },
      watchRouteAlertDailyObservation: { create: vi.fn() },
      watchRouteAlertPropertyProgress: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(),
      },
    }
    const path = "/watch/jesus.html/english.html"

    await serviceFor(tx).completeRun({
      assertion,
      input: completion({
        observations: [
          {
            path: `${path}?campaign=private`,
            verdict: "supported_route_failure",
            count: 51,
            countKind: "event_count",
            activeUsers: 40,
            firstSeenAt: "2026-08-25T00:00:00.000Z",
            lastSeenAt: "2026-09-01T00:00:00.000Z",
            probe: {
              kind: "missing",
              status: 404,
              probedAt: "2026-09-02T00:00:00.000Z",
              finalUrl: `${origin}${path}`,
              contentType: "text/html",
            },
            evidence: {
              authorization: "never-store-me",
              reason: "manifest",
            },
          },
        ],
      }),
    })

    expect(alertUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          semanticKey: createHash("sha256")
            .update(`320198532\n${path}`)
            .digest("hex"),
        },
      }),
    )
    expect(alertUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lifecycle: "OPEN",
          severity: "CRITICAL",
          recoveredAt: null,
          latestEvidence: expect.objectContaining({
            authorization: "[redacted]",
          }),
        }),
      }),
    )
  })
})
