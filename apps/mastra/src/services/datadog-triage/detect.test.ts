import { describe, expect, it } from "vitest"

import type { DatadogIssue, DatadogMonitor } from "./datadog-client"
import {
  applyCandidateCap,
  detectIssueCandidates,
  detectMonitorSignals,
  detectSpikeSignals,
  isDevShapedIssue,
  resolveSourceWindow,
  type DetectionWindow,
  type IssueDetectionConfig,
} from "./detect"
import type { SeenIssue } from "./schema"

const NOW = new Date("2026-08-18T11:00:00.000Z")

const WINDOW: DetectionWindow = {
  from: new Date("2026-08-18T10:00:00.000Z"),
  to: new Date("2026-08-18T11:00:00.000Z"),
  clamped: false,
}

const CONFIG: IssueDetectionConfig = {
  releaseVersionPattern: "^\\d+\\.\\d+(?:\\.\\d+)?(?:[-+][0-9A-Za-z.-]+)?$",
  devSessionMarkers: ["127.0.0.1", "localhost", "dev=true"],
  regressionMultiplier: 3,
  minOccurrences: 3,
}

/**
 * One base issue. Every gate test overrides EXACTLY ONE field of it, so a test
 * that passes cannot be passing because the fixture happened to trip a
 * different gate as well.
 */
const BASE_ISSUE: DatadogIssue = {
  issueId: "ISSUE-1",
  service: "forge-mobile",
  state: "FOR_REVIEW",
  errorType: "TypeError",
  errorMessage: "Cannot read property 'id' of undefined",
  filePath: "app/watch/[slug].tsx",
  functionName: "WatchScreen",
  platform: "REACT_NATIVE",
  isCrash: true,
  firstSeen: "2026-08-18T10:07:00.000Z",
  lastSeen: "2026-08-18T10:55:00.000Z",
  firstSeenVersion: "1.4.2",
  lastSeenVersion: "1.4.2",
  totalCount: 12,
}

function issue(overrides: Partial<DatadogIssue> = {}): DatadogIssue {
  return { ...BASE_ISSUE, ...overrides }
}

function seen(overrides: Partial<SeenIssue> = {}): SeenIssue {
  return {
    issueId: "ISSUE-1",
    service: "forge-mobile",
    epoch: 0,
    baselineRate: 2,
    lastActivityAt: "2026-08-17T11:00:00.000Z",
    firstSeenAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  }
}

function detect(input: {
  issues: DatadogIssue[]
  seenIssues?: SeenIssue[]
  alreadySeeded?: boolean
  releaseSessionFilter?: boolean
}) {
  return detectIssueCandidates({
    service: "forge-mobile",
    window: WINDOW,
    issues: input.issues,
    seenIssues: input.seenIssues ?? [],
    alreadySeeded: input.alreadySeeded ?? true,
    releaseSessionFilter: input.releaseSessionFilter ?? true,
    config: CONFIG,
  })
}

describe("resolveSourceWindow", () => {
  it("Covers AE1: a cursor already at the readable edge yields no window at all", () => {
    const window = resolveSourceWindow({
      cursorAt: "2026-08-18T10:57:00.000Z",
      now: NOW,
      overlapMs: 0,
      lagMs: 180_000,
      fallbackLookbackMs: 3_600_000,
    })

    expect(window).toBeUndefined()
  })

  it("trails the readable edge by the ingestion lag", () => {
    const window = resolveSourceWindow({
      cursorAt: "2026-08-18T10:00:00.000Z",
      now: NOW,
      overlapMs: 0,
      lagMs: 180_000,
      fallbackLookbackMs: 3_600_000,
    })

    expect(window?.to.toISOString()).toBe("2026-08-18T10:57:00.000Z")
    expect(window?.from.toISOString()).toBe("2026-08-18T10:00:00.000Z")
  })

  it("reaches back past the cursor by the overlap", () => {
    const window = resolveSourceWindow({
      cursorAt: "2026-08-18T10:30:00.000Z",
      now: NOW,
      overlapMs: 300_000,
      lagMs: 0,
      fallbackLookbackMs: 3_600_000,
    })

    expect(window?.from.toISOString()).toBe("2026-08-18T10:25:00.000Z")
  })

  it("uses the fallback lookback when no cursor exists yet", () => {
    const window = resolveSourceWindow({
      cursorAt: undefined,
      now: NOW,
      overlapMs: 300_000,
      lagMs: 0,
      fallbackLookbackMs: 7 * 24 * 3_600_000,
    })

    expect(window?.from.toISOString()).toBe("2026-08-11T11:00:00.000Z")
    expect(window?.clamped).toBe(false)
  })

  it("clamps a long-outage window and says so", () => {
    const window = resolveSourceWindow({
      cursorAt: "2026-08-01T00:00:00.000Z",
      now: NOW,
      overlapMs: 0,
      lagMs: 0,
      fallbackLookbackMs: 3_600_000,
    })

    expect(window?.from.toISOString()).toBe("2026-08-17T11:00:00.000Z")
    expect(window?.clamped).toBe(true)
  })

  it("lets a declared seed lookback widen the clamp past the standing 24h cap", () => {
    // The standing cap bounds an accidentally stale cursor. It must not bound
    // the deliberate wide read a first covered run performs, or the baseline
    // would only cover the last day (AE5).
    const window = resolveSourceWindow({
      cursorAt: "2026-06-01T00:00:00.000Z",
      now: NOW,
      overlapMs: 0,
      lagMs: 0,
      fallbackLookbackMs: 7 * 24 * 3_600_000,
    })

    expect(window?.from.toISOString()).toBe("2026-08-11T11:00:00.000Z")
    expect(window?.clamped).toBe(true)
  })
})

describe("release-session filter (R17, KTD4)", () => {
  it("Covers AE7: an ad-hoc dev version is dev-shaped", () => {
    expect(
      isDevShapedIssue(
        {
          firstSeenVersion: "fixcheck-20260805",
          lastSeenVersion: "fixcheck-20260805",
        },
        CONFIG,
      ),
    ).toBe(true)
  })

  it("Covers AE7: the release sibling differs only in the version and is kept", () => {
    expect(
      isDevShapedIssue(
        { firstSeenVersion: "1.4.2", lastSeenVersion: "1.4.2" },
        CONFIG,
      ),
    ).toBe(false)
  })

  it("treats a Metro bundle URL as dev-shaped when no version is present", () => {
    expect(
      isDevShapedIssue(
        { filePath: "http://127.0.0.1:8090/apps/mobile/entry.bundle?dev=true" },
        CONFIG,
      ),
    ).toBe(true)
  })

  it("keeps an issue that carries neither a version nor a dev marker", () => {
    expect(isDevShapedIssue({ errorMessage: "boom" }, CONFIG)).toBe(false)
  })

  it("keeps a mixed issue whose activity spans a dev session and a real build", () => {
    // KTD4 fails OPEN toward coverage: any release-session evidence keeps the
    // issue in, even alongside dev-shaped evidence.
    expect(
      isDevShapedIssue(
        { firstSeenVersion: "fixcheck-20260805", lastSeenVersion: "1.4.2" },
        CONFIG,
      ),
    ).toBe(false)
  })

  it("keeps a release-versioned issue whose message merely mentions localhost", () => {
    expect(
      isDevShapedIssue(
        {
          firstSeenVersion: "1.4.2",
          lastSeenVersion: "1.4.2",
          errorMessage: "failed to reach localhost fallback",
        },
        CONFIG,
      ),
    ).toBe(false)
  })

  it("excludes nothing when the release pattern is unusable", () => {
    expect(
      isDevShapedIssue(
        { firstSeenVersion: "fixcheck-20260805" },
        { ...CONFIG, releaseVersionPattern: "([" },
      ),
    ).toBe(false)
  })

  it("Covers AE7: the dev-shaped issue never becomes a candidate", () => {
    const result = detect({
      issues: [
        issue({
          lastSeenVersion: "fixcheck-20260805",
          firstSeenVersion: "fixcheck-20260805",
        }),
      ],
    })

    expect(result.candidates).toEqual([])
    expect(result.excludedDevSession).toBe(1)
  })

  it("Covers KTD9: a service whose profile turns the filter off keeps the same issue", () => {
    const result = detect({
      issues: [
        issue({
          lastSeenVersion: "fixcheck-20260805",
          firstSeenVersion: "fixcheck-20260805",
        }),
      ],
      releaseSessionFilter: false,
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.excludedDevSession).toBe(0)
  })
})

describe("detectIssueCandidates", () => {
  it("Covers AE5: the first covered run records baselines and files nothing", () => {
    const result = detect({
      issues: [issue(), issue({ issueId: "ISSUE-2", totalCount: 60 })],
      alreadySeeded: false,
    })

    expect(result.candidates).toEqual([])
    expect(result.seenUpdates).toHaveLength(2)
    expect(result.seenUpdates[1]).toMatchObject({
      issueId: "ISSUE-2",
      baselineRate: 60,
    })
  })

  it("Covers AE2: a brand-new issue on a seeded service becomes one candidate", () => {
    const result = detect({ issues: [issue()] })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      service: "forge-mobile",
      signalKind: "issue",
      signalId: "ISSUE-1",
      epoch: 0,
      occurredAt: "2026-08-18T10:55:00.000Z",
    })
    expect(result.candidates[0]?.evidence).toMatchObject({
      kind: "issue",
      windowCount: 12,
      regression: false,
    })
  })

  it("Covers AE3: an issue already baselined at this epoch produces no second candidate", () => {
    const result = detect({
      issues: [issue({ totalCount: 4 })],
      seenIssues: [seen({ baselineRate: 4 })],
    })

    expect(result.candidates).toEqual([])
    expect(result.baselined).toBe(1)
    expect(result.seenUpdates[0]).toMatchObject({ epoch: 0, baselineRate: 4 })
  })

  it("Covers AE9: a regression past the multiplier mints exactly one new epoch", () => {
    const first = detect({
      issues: [issue({ totalCount: 30 })],
      seenIssues: [seen({ baselineRate: 2 })],
    })

    expect(first.epochsMinted).toBe(1)
    expect(first.candidates[0]).toMatchObject({ epoch: 1 })
    expect(first.candidates[0]?.evidence).toMatchObject({ regression: true })

    // The next hour re-reads the same elevated rate. Because the minted epoch
    // stores the regressed rate as the new baseline, it must stay quiet.
    const second = detectIssueCandidates({
      service: "forge-mobile",
      window: WINDOW,
      issues: [issue({ totalCount: 30 })],
      seenIssues: [seen({ epoch: 1, baselineRate: 30 })],
      alreadySeeded: true,
      releaseSessionFilter: true,
      config: CONFIG,
    })
    expect(second.candidates).toEqual([])
    expect(second.epochsMinted).toBe(0)
  })

  it("holds the regression gate below the absolute occurrence floor", () => {
    // Rate alone clears 3x a 0.1/h baseline, but two occurrences is noise.
    const result = detect({
      issues: [issue({ totalCount: 2 })],
      seenIssues: [seen({ baselineRate: 0.1 })],
    })

    expect(result.candidates).toEqual([])
    expect(result.epochsMinted).toBe(0)
  })

  it("Covers AE8: a muted issue is skipped even when its counts regress", () => {
    const result = detect({
      issues: [issue({ state: "IGNORED", totalCount: 500 })],
      seenIssues: [seen({ baselineRate: 1 })],
    })

    expect(result.candidates).toEqual([])
    expect(result.excludedMuted).toBe(1)
    expect(result.seenUpdates).toEqual([])
  })

  it("Covers AE8: the EXCLUDED state mutes as well", () => {
    const result = detect({ issues: [issue({ state: "EXCLUDED" })] })

    expect(result.candidates).toEqual([])
    expect(result.excludedMuted).toBe(1)
  })

  it("Covers AE6: an issue belonging to another service is ignored entirely", () => {
    const result = detect({ issues: [issue({ service: "forge-web" })] })

    expect(result.candidates).toEqual([])
    expect(result.seenUpdates).toEqual([])
    expect(result.excludedForeignService).toBe(1)
  })

  it("produces one candidate when the overlap re-read returns the issue twice", () => {
    const result = detect({ issues: [issue(), issue()] })

    expect(result.candidates).toHaveLength(1)
  })

  it("records the new issue's baseline so the next run sees it as baselined", () => {
    const result = detect({ issues: [issue()] })

    expect(result.candidates).toHaveLength(1)
    expect(result.seenUpdates).toEqual([
      {
        issueId: "ISSUE-1",
        service: "forge-mobile",
        epoch: 0,
        baselineRate: 12,
        lastActivityAt: "2026-08-18T10:55:00.000Z",
        firstSeenAt: "2026-08-18T10:07:00.000Z",
      },
    ])
  })

  it("records the minted epoch's new baseline on a regression", () => {
    const result = detect({
      issues: [issue({ totalCount: 30 })],
      seenIssues: [seen({ baselineRate: 2 })],
    })

    expect(result.epochsMinted).toBe(1)
    expect(result.seenUpdates).toEqual([
      expect.objectContaining({
        issueId: "ISSUE-1",
        epoch: 1,
        baselineRate: 30,
      }),
    ])
  })
})

/**
 * Feeds each run's OWN writes into the next run's reads. Every other AE3/AE9
 * test hand-builds the post-first-run state as an input, so none of them can
 * tell "the system produced this state" from "the fixture asserted it" — which
 * is exactly how a missing seen-issue write shipped with a green suite.
 */
describe("detectIssueCandidates across sequential runs", () => {
  function runAgainst(
    seenIssues: SeenIssue[],
    overrides: Partial<DatadogIssue> = {},
  ) {
    const result = detect({ issues: [issue(overrides)], seenIssues })
    // Round-trip the writes the way the repository would: a SeenIssueUpdate
    // minus its outbox pin IS the SeenIssue the next run reads back.
    const nextSeen: SeenIssue[] = result.seenUpdates.map(
      ({ requiredActionKey: _ignored, ...row }) => row,
    )
    return { result, nextSeen }
  }

  it("Covers AE3: the second run treats a first-run candidate as baselined", () => {
    const first = runAgainst([])
    expect(first.result.candidates).toHaveLength(1)

    const second = runAgainst(first.nextSeen, { totalCount: 12 })

    expect(second.result.candidates).toEqual([])
    expect(second.result.baselined).toBe(1)
  })

  it("Covers AE9: a real regression after a real first run mints exactly one epoch", () => {
    const first = runAgainst([])
    const spike = runAgainst(first.nextSeen, { totalCount: 120 })

    expect(spike.result.epochsMinted).toBe(1)
    expect(spike.result.candidates[0]).toMatchObject({ epoch: 1 })

    // Third run at the same elevated rate must stay quiet: the minted epoch
    // stored the regressed rate as the new normal.
    const settled = runAgainst(spike.nextSeen, { totalCount: 120 })
    expect(settled.result.epochsMinted).toBe(0)
    expect(settled.result.candidates).toEqual([])
  })

  it("does not re-judge a still-firing issue hour after hour", () => {
    let seenRows = runAgainst([]).nextSeen
    const candidatesPerHour: number[] = []
    for (let hour = 0; hour < 5; hour += 1) {
      const next = runAgainst(seenRows, { totalCount: 12 })
      candidatesPerHour.push(next.result.candidates.length)
      seenRows = next.nextSeen
    }

    expect(candidatesPerHour).toEqual([0, 0, 0, 0, 0])
  })
})

describe("detectMonitorSignals", () => {
  const monitor: DatadogMonitor = {
    monitorId: "42",
    name: "Mobile crash-free rate",
    overallState: "Alert",
    overallStateModified: "2026-08-18T10:30:00.000Z",
    tags: ["service:forge-mobile"],
  }

  function detectMonitors(input: {
    monitors?: DatadogMonitor[]
    states?: Parameters<typeof detectMonitorSignals>[0]["states"]
    alreadySeeded?: boolean
  }) {
    return detectMonitorSignals({
      service: "forge-mobile",
      window: WINDOW,
      monitors: input.monitors ?? [monitor],
      states: input.states ?? [],
      alreadySeeded: input.alreadySeeded ?? true,
      now: NOW,
      cooldownMs: 6 * 3_600_000,
    })
  }

  it("emits one signal for a fresh alert episode", () => {
    const result = detectMonitors({})

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      signalKind: "monitor",
      signalId: "42:2026-08-18T10:30:00.000Z",
    })
    // Detection does NOT stamp the cooldown: it does not yet know whether a
    // ticket will be filed, and stamping a later-suppressed candidate would
    // blackout the monitor over a ticket that never existed.
    expect(result.stateUpdates[0]?.lastTicketedAt).toBeNull()
  })

  it("stays quiet for a monitor that is not alerting", () => {
    const result = detectMonitors({
      monitors: [{ ...monitor, overallState: "OK" }],
    })

    expect(result.candidates).toEqual([])
    expect(result.stateUpdates).toHaveLength(1)
  })

  it("stays quiet for the same episode on the next sweep", () => {
    const result = detectMonitors({
      states: [
        {
          monitorId: "42",
          service: "forge-mobile",
          overallState: "Alert",
          lastEpisodeStartedAt: "2026-08-18T10:30:00.000Z",
          lastTicketedAt: null,
        },
      ],
    })

    expect(result.candidates).toEqual([])
  })

  it("gives a flapping monitor one signal per cooldown, not one per hour", () => {
    const result = detectMonitors({
      monitors: [
        { ...monitor, overallStateModified: "2026-08-18T10:50:00.000Z" },
      ],
      states: [
        {
          monitorId: "42",
          service: "forge-mobile",
          overallState: "Alert",
          lastEpisodeStartedAt: "2026-08-18T10:30:00.000Z",
          lastTicketedAt: "2026-08-18T10:31:00.000Z",
        },
      ],
    })

    expect(result.candidates).toEqual([])
    expect(result.stateUpdates[0]?.lastTicketedAt).toBe(
      "2026-08-18T10:31:00.000Z",
    )
  })

  it("files nothing on a service's first covered run", () => {
    const result = detectMonitors({ alreadySeeded: false })

    expect(result.candidates).toEqual([])
    expect(result.stateUpdates).toHaveLength(1)
  })
})

describe("detectSpikeSignals", () => {
  const config = {
    spikeMultiplier: 3,
    minOccurrences: 3,
    monitorCooldownMs: 6 * 3_600_000,
  }

  function detectSpikes(input: {
    count: number
    partial?: boolean
    baselines?: Parameters<typeof detectSpikeSignals>[0]["baselines"]
    alreadySeeded?: boolean
  }) {
    return detectSpikeSignals({
      service: "forge-mobile",
      window: WINDOW,
      aggregate: {
        buckets: [{ key: "playback_error", count: input.count }],
        partial: input.partial ?? false,
      },
      baselines: input.baselines ?? [],
      alreadySeeded: input.alreadySeeded ?? true,
      now: NOW,
      config,
    })
  }

  const baseline = {
    service: "forge-mobile",
    spikeClass: "playback_error",
    baselineRate: 2,
    observations: 24,
    lastTicketedAt: null,
  }

  it("fires when the window clears the multiplier over a trusted baseline", () => {
    const result = detectSpikes({ count: 30, baselines: [baseline] })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.evidence).toMatchObject({
      kind: "spike",
      spikeClass: "playback_error",
      windowCount: 30,
    })
  })

  it("stays quiet while the baseline has too few observations to trust", () => {
    const result = detectSpikes({
      count: 30,
      baselines: [{ ...baseline, observations: 2 }],
    })

    expect(result.candidates).toEqual([])
    expect(result.baselineUpdates).toHaveLength(1)
  })

  it("stays quiet inside the per-service cooldown", () => {
    const result = detectSpikes({
      count: 30,
      baselines: [{ ...baseline, lastTicketedAt: "2026-08-18T10:00:00.000Z" }],
    })

    expect(result.candidates).toEqual([])
  })

  it("never folds a partial aggregate into a baseline", () => {
    const result = detectSpikes({
      count: 30,
      partial: true,
      baselines: [baseline],
    })

    expect(result.candidates).toEqual([])
    expect(result.baselineUpdates).toEqual([])
  })

  it("records a baseline and files nothing on a service's first covered run", () => {
    const result = detectSpikes({ count: 30, alreadySeeded: false })

    expect(result.candidates).toEqual([])
    expect(result.baselineUpdates[0]).toMatchObject({
      baselineRate: 30,
      observations: 1,
    })
  })

  it("blends the window into the baseline as a running mean", () => {
    const result = detectSpikes({
      count: 4,
      baselines: [{ ...baseline, baselineRate: 2, observations: 1 }],
    })

    expect(result.baselineUpdates[0]).toMatchObject({
      baselineRate: 3,
      observations: 2,
    })
  })
})

describe("applyCandidateCap", () => {
  const candidates = [
    { occurredAt: "2026-08-18T10:50:00.000Z", signalId: "C" },
    { occurredAt: "2026-08-18T10:10:00.000Z", signalId: "A" },
    { occurredAt: "2026-08-18T10:30:00.000Z", signalId: "B" },
  ].map((partial) => ({
    service: "forge-mobile",
    signalKind: "issue" as const,
    epoch: 0,
    windowStart: WINDOW.from.toISOString(),
    windowEnd: WINDOW.to.toISOString(),
    evidence: {
      kind: "issue" as const,
      issueId: partial.signalId,
      windowCount: 1,
      windowRatePerHour: 1,
      baselineRatePerHour: 0,
      regression: false,
    },
    ...partial,
  }))

  it("judges cap-many candidates oldest first and holds the cursor at the rest", () => {
    const result = applyCandidateCap(candidates, 2, WINDOW.to)

    expect(result.judged.map((candidate) => candidate.signalId)).toEqual([
      "A",
      "B",
    ])
    expect(result.deferred.map((candidate) => candidate.signalId)).toEqual([
      "C",
    ])
    expect(result.cursorAt).toBe("2026-08-18T10:50:00.000Z")
  })

  it("advances the cursor to the window end when nothing is deferred", () => {
    const result = applyCandidateCap(candidates, 10, WINDOW.to)

    expect(result.deferred).toEqual([])
    expect(result.cursorAt).toBe("2026-08-18T11:00:00.000Z")
  })

  it("breaks a timestamp tie on the signal id so the order is total", () => {
    const tied = candidates.map((candidate) => ({
      ...candidate,
      occurredAt: "2026-08-18T10:30:00.000Z",
    }))

    const result = applyCandidateCap(tied, 3, WINDOW.to)

    expect(result.judged.map((candidate) => candidate.signalId)).toEqual([
      "A",
      "B",
      "C",
    ])
  })

  it("defers everything when the cap is zero", () => {
    const result = applyCandidateCap(candidates, 0, WINDOW.to)

    expect(result.judged).toEqual([])
    expect(result.cursorAt).toBe("2026-08-18T10:10:00.000Z")
  })
})
