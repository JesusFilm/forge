import { describe, expect, it, vi } from "vitest"
import {
  PlaybackProxyReadinessService,
  decidePlaybackProxyReadiness,
} from "./proxy-readiness.service"

describe("playback proxy readiness", () => {
  it("keeps sparse evidence inconclusive and never authorizes live ranking", () => {
    expect(
      decidePlaybackProxyReadiness({
        sampleCount: 12,
        pairedCount: 12,
        missingCount: 0,
      }),
    ).toEqual({
      decision: "inconclusive",
      rankingInfluence: false,
      reasonCodes: ["insufficient_sample"],
    })
  })

  it("requires adequate paired active coverage before shadow eligibility", () => {
    expect(
      decidePlaybackProxyReadiness({
        sampleCount: 200,
        pairedCount: 190,
        missingCount: 50,
      }),
    ).toMatchObject({
      decision: "revise",
      rankingInfluence: false,
      reasonCodes: ["active_coverage_missing"],
    })
    expect(
      decidePlaybackProxyReadiness({
        sampleCount: 200,
        pairedCount: 190,
        missingCount: 20,
      }),
    ).toMatchObject({
      decision: "eligible_for_shadow_evaluation",
      rankingInfluence: false,
    })
  })

  it("persists an immutable revision with aggregate sensitivity evidence", async () => {
    const created: Array<Record<string, unknown>> = []
    const tx = {
      $executeRaw: vi.fn(async () => 1),
      $queryRaw: vi.fn(async () => [
        {
          sampleCount: 200,
          pairedCount: 190,
          missingCount: 20,
          agreementRate: 0.8,
          activeQualifiedRate: 0.55,
          legacyQualifiedRate: 0.7,
          lateRevisionRate: 0.05,
          finalizationLagP95Ms: 12_000,
          durationCohorts: { short: 20, medium: 80, long: 90, unknown: 10 },
        },
      ]),
      playbackProxyEvaluation: {
        findFirst: vi.fn(async () => ({ revision: 3 })),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data)
          return data
        }),
      },
    }
    const service = new PlaybackProxyReadinessService({
      prisma: {
        $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
          work(tx),
        ),
      } as never,
      now: () => new Date("2026-08-20T00:00:00.000Z"),
      newId: () => "evaluation-4",
    })

    await expect(
      service.evaluate({
        windowStart: new Date("2026-08-19T00:00:00.000Z"),
        windowEnd: new Date("2026-08-19T23:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      id: "evaluation-4",
      revision: 4,
      decision: "eligible_for_shadow_evaluation",
      rankingInfluence: false,
    })
    expect(created[0]).toMatchObject({
      proxyVersion: "active-watch-proxy-v1",
      revision: 4,
      sampleCount: 200,
      pairedCount: 190,
      rankingInfluence: false,
    })
  })

  it.each([
    [
      "reversed",
      new Date("2026-08-19T01:00:00.000Z"),
      new Date("2026-08-19T00:00:00.000Z"),
    ],
    [
      "future",
      new Date("2026-08-19T00:00:00.000Z"),
      new Date("2026-08-21T00:00:00.000Z"),
    ],
    [
      "too wide",
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-08-19T00:00:00.000Z"),
    ],
  ])(
    "rejects a %s evaluation window",
    async (_label, windowStart, windowEnd) => {
      const service = new PlaybackProxyReadinessService({
        prisma: {} as never,
        now: () => new Date("2026-08-20T00:00:00.000Z"),
      })

      await expect(
        service.evaluate({ windowStart, windowEnd }),
      ).rejects.toThrow("Playback proxy evaluation window is invalid")
    },
  )
})
