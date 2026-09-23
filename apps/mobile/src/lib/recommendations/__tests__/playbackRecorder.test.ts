import { RATE_LIMIT_WINDOW_MS, RecommendationClientError } from "../errors"
import {
  DIRECT_DISCOVERY,
  createPlaybackDiscoveryStore,
} from "../playbackDiscovery"
import {
  CLAIM_RETRY_BACKOFF_MS,
  MAX_ACTIVE_CHUNK_MS,
  MAX_CLAIM_ATTEMPTS,
  MAX_CLAIM_RATE_LIMIT_DEFERRALS,
  MAX_FACTS_BY_KIND,
  MAX_FACT_RATE_LIMIT_DEFERRALS,
  PROGRESS_INTERVAL_MS,
  type PlaybackFactsVariables,
} from "../playbackFacts"
import {
  createRecommendationPlaybackRecorder,
  type PlaybackRecorderDeps,
  type RecommendationPlaybackRecorder,
} from "../playbackRecorder"
import {
  createPendingClaimStore,
  type PendingClaimStore,
  type PendingRecommendationClaim,
} from "../selection"

const T0 = Date.parse("2026-09-16T00:00:00.000Z")
const IDENTITY = { viewerToken: "v".repeat(43), sessionToken: "s".repeat(43) }
const EPISODE = {
  episodeId: "ep-1",
  capability: "cap-1",
  activeUntil: "2026-09-16T01:00:00.000Z",
  hardUntil: "2026-09-16T02:00:00.000Z",
}
const NONCE = "n".repeat(32)

/** Let every chained microtask (claim → drain → send) settle. */
async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function harness(overrides: Partial<PlaybackRecorderDeps> = {}) {
  let now = T0
  let counter = 0
  const sent: PlaybackFactsVariables[] = []
  const released = jest.fn()
  const deps: PlaybackRecorderDeps = {
    mediaId: "media-1",
    discoveryKeys: ["jesus", "media-1"],
    takePendingNonce: jest.fn(() => null),
    restorePendingNonce: jest.fn(),
    takeDiscovery: jest.fn(() => ({
      source: "direct" as const,
      provenance: {},
    })),
    getIdentity: jest.fn(async () => ({
      kind: "ready" as const,
      identity: IDENTITY,
      personalization: true,
    })),
    claimEpisode: jest.fn(async () => EPISODE),
    issueContext: jest.fn(async () => ({
      claimNonce: "c".repeat(32),
      contextVersion: "playback-context-v1",
    })),
    sendFacts: jest.fn(async (variables: PlaybackFactsVariables) => {
      sent.push(variables)
      return variables.events.map((event, index) => ({
        eventId: event.eventId,
        status: "accepted",
        sequence: index + 1,
      }))
    }),
    invalidateIdentity: jest.fn(async () => undefined),
    touch: jest.fn(),
    holdPlayback: jest.fn(() => released),
    isForeground: () => true,
    now: () => now,
    eventId: (kind) => `${kind}:${(counter += 1)}`,
    wait: jest.fn(async () => undefined),
    report: jest.fn(),
    ...overrides,
  }
  const recorder = createRecommendationPlaybackRecorder(deps)
  return {
    recorder,
    deps,
    sent,
    released,
    advance: (ms: number) => {
      now += ms
    },
    kinds: () => sent.flatMap((batch) => batch.events.map((e) => e.kind)),
    facts: () => sent.flatMap((batch) => batch.events),
  }
}

describe("claim", () => {
  it("claims with the pending selection nonce and sends the buffered attempt", async () => {
    const h = harness({ takePendingNonce: jest.fn(() => NONCE) })
    h.recorder.start()
    await settle()
    expect(h.deps.holdPlayback).toHaveBeenCalledTimes(1)
    expect(h.deps.claimEpisode).toHaveBeenCalledWith(IDENTITY, NONCE, "media-1")
    expect(h.deps.issueContext).not.toHaveBeenCalled()
    expect(h.kinds()).toEqual(["playback_attempt"])
    expect(h.facts()[0].payload).toEqual({ initiation: "manual" })
    expect(h.sent[0]).toMatchObject({
      contractVersion: "recommendation-evidence-v1",
      capability: "cap-1",
      episodeId: "ep-1",
      mediaId: "media-1",
      viewerToken: IDENTITY.viewerToken,
    })
    expect(h.recorder.getState().claimed).toBe(true)
  })

  it("issues a playback context from the marked discovery when no selection is pending", async () => {
    const h = harness({
      takeDiscovery: jest.fn(() => ({
        source: "search" as const,
        provenance: { handoff: "search_result" },
      })),
    })
    h.recorder.start()
    await settle()
    expect(h.deps.takeDiscovery).toHaveBeenCalledWith(["jesus", "media-1"])
    expect(h.deps.issueContext).toHaveBeenCalledWith(IDENTITY, "media-1", {
      source: "search",
      provenance: { handoff: "search_result" },
    })
    expect(h.deps.claimEpisode).toHaveBeenCalledWith(
      IDENTITY,
      "c".repeat(32),
      "media-1",
    )
    expect(h.recorder.getState().claimed).toBe(true)
  })

  it("falls back to a context claim when the selection nonce is rejected", async () => {
    const claim = jest
      .fn()
      .mockRejectedValueOnce(new RecommendationClientError("CONFLICT"))
      .mockResolvedValueOnce(EPISODE)
    const h = harness({
      takePendingNonce: jest.fn(() => NONCE),
      claimEpisode: claim,
    })
    h.recorder.start()
    await settle()
    expect(h.deps.issueContext).toHaveBeenCalledTimes(1)
    expect(claim).toHaveBeenCalledTimes(2)
    expect(h.recorder.getState().claimed).toBe(true)
  })

  it("abandons when the context claim itself is rejected, dropping buffered facts", async () => {
    const h = harness({
      claimEpisode: jest.fn(async () => {
        throw new RecommendationClientError("BAD_USER_INPUT")
      }),
    })
    h.recorder.start()
    h.recorder.onPlayingChange(true, 0)
    await settle()
    expect(h.recorder.getState()).toMatchObject({
      claimed: false,
      closed: true,
      pendingCount: 0,
    })
    expect(h.deps.sendFacts).not.toHaveBeenCalled()
    expect(h.deps.report).toHaveBeenCalledWith(
      "claim_unavailable",
      "dropped",
      2,
    )
    expect(h.released).toHaveBeenCalled()
    h.recorder.onEnd("ended", 10, 100)
    await settle()
    expect(h.deps.sendFacts).not.toHaveBeenCalled()
  })

  it("retries a transient claim failure up to the cap, then abandons", async () => {
    const claim = jest.fn(async () => {
      throw new RecommendationClientError("NETWORK_ERROR")
    })
    const h = harness({ claimEpisode: claim })
    h.recorder.start()
    await settle()
    expect(claim).toHaveBeenCalledTimes(MAX_CLAIM_ATTEMPTS)
    expect(h.deps.wait).toHaveBeenCalledTimes(MAX_CLAIM_ATTEMPTS - 1)
    expect(h.recorder.getState().closed).toBe(true)
  })

  it("retries a transient context issuance with backoff and takes the discovery mark once", async () => {
    const issue = jest
      .fn()
      .mockRejectedValueOnce(new RecommendationClientError("TIMEOUT"))
      .mockResolvedValueOnce({ claimNonce: "c".repeat(32) })
    const h = harness({
      issueContext: issue,
      takeDiscovery: jest.fn(() => ({
        source: "search" as const,
        provenance: {},
      })),
    })
    h.recorder.start()
    await settle()
    expect(issue).toHaveBeenCalledTimes(2)
    expect(h.deps.takeDiscovery).toHaveBeenCalledTimes(1)
    expect(issue).toHaveBeenLastCalledWith(IDENTITY, "media-1", {
      source: "search",
      provenance: {},
    })
    expect(h.deps.wait).toHaveBeenCalledWith(CLAIM_RETRY_BACKOFF_MS)
    expect(h.deps.claimEpisode).toHaveBeenCalledTimes(1)
    expect(h.recorder.getState().claimed).toBe(true)
    expect(h.kinds()).toEqual(["playback_attempt"])
  })

  it("shares the claim's attempt budget with the issuance, then abandons", async () => {
    const issue = jest.fn(async () => {
      throw new RecommendationClientError("NETWORK_ERROR")
    })
    const h = harness({ issueContext: issue })
    h.recorder.start()
    await settle()
    expect(issue).toHaveBeenCalledTimes(MAX_CLAIM_ATTEMPTS)
    expect(h.deps.wait).toHaveBeenCalledTimes(MAX_CLAIM_ATTEMPTS - 1)
    expect(h.deps.claimEpisode).not.toHaveBeenCalled()
    expect(h.recorder.getState().closed).toBe(true)
    expect(h.deps.report).toHaveBeenCalledWith(
      "claim_unavailable",
      "dropped",
      1,
    )
  })

  it("invalidates the handle and abandons on UNAUTHENTICATED", async () => {
    const h = harness({
      takePendingNonce: jest.fn(() => NONCE),
      claimEpisode: jest.fn(async () => {
        throw new RecommendationClientError("UNAUTHENTICATED")
      }),
    })
    h.recorder.start()
    await settle()
    expect(h.deps.invalidateIdentity).toHaveBeenCalledTimes(1)
    expect(h.deps.issueContext).not.toHaveBeenCalled()
    expect(h.recorder.getState().closed).toBe(true)
  })

  it("abandons without an identity and never touches the network", async () => {
    const h = harness({
      getIdentity: jest.fn(async () => ({ kind: "unprovisioned" as const })),
    })
    h.recorder.start()
    await settle()
    expect(h.deps.issueContext).not.toHaveBeenCalled()
    expect(h.deps.claimEpisode).not.toHaveBeenCalled()
    expect(h.recorder.getState().closed).toBe(true)
    expect(h.released).toHaveBeenCalled()
  })

  it("rejects a malformed episode as a definitive failure", async () => {
    const h = harness({
      claimEpisode: jest.fn(async () => ({ episodeId: "" })),
    })
    h.recorder.start()
    await settle()
    expect(h.recorder.getState().closed).toBe(true)
  })
})

describe("facts", () => {
  it("records a full session in order with strict payloads", async () => {
    const h = harness()
    h.recorder.start()
    await settle()
    h.recorder.onPlayingChange(true, 0)
    for (let i = 1; i <= 12; i += 1) {
      h.advance(1_000)
      h.recorder.onTick(i, 100)
    }
    h.advance(1_000)
    h.recorder.onPlayingChange(false, 13)
    h.advance(5_000)
    h.recorder.onPlayingChange(true, 13)
    h.advance(1_000)
    h.recorder.onEnd("ended", 100, 100)
    await settle()
    expect(h.kinds()).toEqual([
      "playback_attempt",
      "playback_start",
      "playback_progress",
      "playback_navigation",
      "playback_active_visible_playing",
      "playback_navigation",
      "playback_active_visible_playing",
      "playback_observation",
      "playback_end",
    ])
    const facts = h.facts()
    expect(facts[1].payload).toEqual({ positionSeconds: 0 })
    expect(facts[2].payload).toEqual({
      positionSeconds: 10,
      durationSeconds: 100,
      progress: 0.1,
      wallElapsedMilliseconds: PROGRESS_INTERVAL_MS,
    })
    expect(facts[3].payload).toEqual({
      action: "pause",
      cause: "unknown",
      positionSeconds: 13,
    })
    expect(facts[4].payload).toEqual({
      activeMilliseconds: 13_000,
      coverage: "complete",
    })
    expect(facts[5].payload).toMatchObject({ action: "resume" })
    expect(facts[6].payload).toEqual({
      activeMilliseconds: 1_000,
      coverage: "complete",
    })
    // 12 ticks + 1 s to pause + 5 s paused + 1 s to end = 19 s after attempt.
    expect(facts[7].payload).toEqual({
      version: "playback-observations-v1",
      elapsedMilliseconds: 19_000,
      visibility: "visible",
      playerState: "paused",
      startObserved: true,
      errorObserved: false,
      seekCount: 0,
      navigationCount: 2,
      qoeCount: 0,
    })
    expect(facts[8].payload).toEqual({
      reason: "ended",
      positionSeconds: 100,
      durationSeconds: 100,
      progress: 1,
      completed: true,
    })
    expect(h.released).toHaveBeenCalled()
    expect(h.recorder.getState().terminal).toBe(true)
  })

  it("splits long active playing into chunks of at most 60 s", async () => {
    const h = harness()
    h.recorder.start()
    await settle()
    h.recorder.onPlayingChange(true, 0)
    for (let i = 1; i <= 130; i += 1) {
      h.advance(1_000)
      h.recorder.onTick(i, 1_000)
    }
    h.recorder.onEnd("route_exit", 130, 1_000)
    await settle()
    const chunks = h
      .facts()
      .filter((fact) => fact.kind === "playback_active_visible_playing")
      .map(
        (fact) =>
          (fact.payload as { activeMilliseconds: number }).activeMilliseconds,
      )
    expect(chunks.every((ms) => ms <= MAX_ACTIVE_CHUNK_MS)).toBe(true)
    expect(chunks.reduce((sum, ms) => sum + ms, 0)).toBe(130_000)
    const end = h.facts().find((fact) => fact.kind === "playback_end")
    expect(end?.payload).toMatchObject({
      reason: "route_exit",
      completed: false,
    })
  })

  it("detects a seek from a playhead jump and never from a pause gap", async () => {
    const h = harness()
    h.recorder.start()
    await settle()
    h.recorder.onPlayingChange(true, 0)
    h.advance(1_000)
    h.recorder.onTick(1, 100)
    h.advance(1_000)
    h.recorder.onTick(42, 100)
    h.recorder.onPlayingChange(false, 42)
    h.advance(30_000)
    h.recorder.onPlayingChange(true, 42)
    h.advance(1_000)
    h.recorder.onTick(43, 100)
    await settle()
    const seeks = h.facts().filter((fact) => fact.kind === "playback_seek")
    expect(seeks).toHaveLength(1)
    expect(seeks[0].payload).toEqual({ fromSeconds: 1, toSeconds: 42 })
  })

  it("records buffering as qoe facts and resumes active time afterwards", async () => {
    const h = harness()
    h.recorder.start()
    await settle()
    h.recorder.onPlayingChange(true, 0)
    h.advance(2_000)
    h.recorder.onBuffering("waiting", 2)
    h.advance(3_000)
    h.recorder.onBufferingEnd(true, 2)
    h.advance(2_000)
    h.recorder.onEnd("route_exit", 4, 100)
    await settle()
    const qoe = h.facts().filter((fact) => fact.kind === "playback_qoe")
    expect(
      qoe.map((fact) => (fact.payload as { action: string }).action),
    ).toEqual(["waiting", "buffering_end"])
    const chunks = h
      .facts()
      .filter((fact) => fact.kind === "playback_active_visible_playing")
      .map(
        (fact) =>
          (fact.payload as { activeMilliseconds: number }).activeMilliseconds,
      )
    expect(chunks).toEqual([2_000, 2_000])
  })

  it("records background and foreground as navigation and stops active time while hidden", async () => {
    const h = harness()
    h.recorder.start()
    await settle()
    h.recorder.onPlayingChange(true, 0)
    h.advance(4_000)
    h.recorder.onVisibility(false, 4)
    h.advance(10_000)
    h.recorder.onVisibility(true, 4)
    h.advance(1_000)
    h.recorder.onEnd("route_exit", 5, 100)
    await settle()
    const nav = h
      .facts()
      .filter((fact) => fact.kind === "playback_navigation")
      .map((fact) => (fact.payload as { action: string }).action)
    expect(nav).toEqual(["hidden", "visible"])
    const chunks = h
      .facts()
      .filter((fact) => fact.kind === "playback_active_visible_playing")
      .map(
        (fact) =>
          (fact.payload as { activeMilliseconds: number }).activeMilliseconds,
      )
    expect(chunks).toEqual([4_000, 1_000])
  })

  it("records a player error as the terminal fact", async () => {
    const h = harness()
    h.recorder.start()
    await settle()
    h.recorder.onPlayingChange(true, 0)
    h.recorder.onError(7)
    h.recorder.onEnd("ended", 100, 100)
    await settle()
    const kinds = h.kinds()
    expect(kinds[kinds.length - 1]).toBe("playback_error")
    expect(kinds).not.toContain("playback_end")
    const observation = h.facts().find((f) => f.kind === "playback_observation")
    expect(observation?.payload).toMatchObject({ errorObserved: true })
  })

  it("dispose() ends an open session as a route exit, once", async () => {
    const h = harness()
    h.recorder.start()
    await settle()
    h.recorder.onPlayingChange(true, 0)
    h.recorder.dispose()
    h.recorder.dispose()
    await settle()
    const ends = h.facts().filter((fact) => fact.kind === "playback_end")
    expect(ends).toHaveLength(1)
    expect(ends[0].payload).toMatchObject({ reason: "route_exit" })
    expect(h.released).toHaveBeenCalled()
  })

  it("buffers facts before the claim settles and sends them after", async () => {
    let resolveClaim: (value: unknown) => void = () => undefined
    const h = harness({
      claimEpisode: jest.fn(
        () =>
          new Promise((resolve) => {
            resolveClaim = resolve
          }),
      ),
    })
    h.recorder.start()
    h.recorder.onPlayingChange(true, 0)
    await settle()
    expect(h.deps.sendFacts).not.toHaveBeenCalled()
    expect(h.recorder.getState().pendingCount).toBe(2)
    resolveClaim(EPISODE)
    await settle()
    expect(h.kinds()).toEqual(["playback_attempt", "playback_start"])
  })

  it("caps pending facts and drops optional observations first while unclaimed", async () => {
    const h = harness({
      claimEpisode: jest.fn(() => new Promise(() => undefined)),
    })
    h.recorder.start()
    h.recorder.onPlayingChange(true, 0)
    for (let i = 0; i < 20; i += 1) {
      h.recorder.onVisibility(i % 2 === 0, i)
    }
    expect(h.recorder.getState().pendingCount).toBeLessThanOrEqual(8)
    expect(h.deps.report).toHaveBeenCalledWith("pending_claim", "dropped", 1)
  })
})

describe("delivery", () => {
  it("batches at most 16 facts per mutation", async () => {
    const h = harness()
    h.recorder.start()
    await settle()
    h.recorder.onPlayingChange(true, 0)
    for (let i = 1; i <= 300; i += 1) {
      h.advance(1_000)
      h.recorder.onTick(i, 1_000)
    }
    h.recorder.onEnd("route_exit", 300, 1_000)
    await settle()
    expect(h.sent.length).toBeGreaterThan(1)
    expect(h.sent.every((batch) => batch.events.length <= 16)).toBe(true)
    const progress = h.facts().filter((f) => f.kind === "playback_progress")
    expect(progress).toHaveLength(30)
  })

  it("retries a transient send with backoff and keeps the facts", async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new RecommendationClientError("NETWORK_ERROR"))
      .mockImplementation(async (variables: PlaybackFactsVariables) =>
        variables.events.map((event, index) => ({
          eventId: event.eventId,
          status: "accepted",
          sequence: index + 1,
        })),
      )
    const h = harness({ sendFacts: send })
    h.recorder.start()
    await settle()
    expect(send).toHaveBeenCalledTimes(2)
    expect(h.deps.wait).toHaveBeenCalledWith(100)
    expect(h.deps.report).toHaveBeenCalledWith("transport_retry", "retrying", 1)
    expect(h.recorder.getState().outboundCount).toBe(0)
  })

  it("drops facts whose receipts never arrive after three attempts", async () => {
    const send = jest.fn(async () => [])
    const h = harness({ sendFacts: send })
    h.recorder.start()
    await settle()
    expect(send).toHaveBeenCalledTimes(3)
    expect(h.deps.report).toHaveBeenCalledWith("receipt_missing", "dropped", 1)
    expect(h.recorder.getState().outboundCount).toBe(0)
  })

  it("goes inert on a definitive send failure and invalidates on UNAUTHENTICATED", async () => {
    const h = harness({
      sendFacts: jest.fn(async () => {
        throw new RecommendationClientError("UNAUTHENTICATED")
      }),
    })
    h.recorder.start()
    await settle()
    expect(h.deps.invalidateIdentity).toHaveBeenCalledTimes(1)
    expect(h.recorder.getState()).toMatchObject({
      closed: true,
      claimed: false,
    })
    h.recorder.onPlayingChange(true, 0)
    await settle()
    expect(h.deps.sendFacts).toHaveBeenCalledTimes(1)
  })

  it("drops observation facts and keeps the baseline when Admin rejects the batch shape", async () => {
    const send = jest
      .fn()
      .mockImplementation(async (variables: PlaybackFactsVariables) => {
        if (variables.events.some((e) => e.kind === "playback_navigation")) {
          throw new RecommendationClientError("BAD_USER_INPUT")
        }
        return variables.events.map((event, index) => ({
          eventId: event.eventId,
          status: "accepted",
          sequence: index + 1,
        }))
      })
    const h = harness({ sendFacts: send })
    h.recorder.start()
    await settle()
    h.recorder.onPlayingChange(true, 0)
    h.recorder.onVisibility(false, 0)
    await settle()
    expect(h.recorder.getState().observationsEnabled).toBe(false)
    const attempted = send.mock.calls.flatMap(([variables]) =>
      (variables as PlaybackFactsVariables).events.map((e) => e.kind),
    )
    expect(attempted).toContain("playback_attempt")
    expect(attempted).toContain("playback_start")
    expect(h.recorder.getState().closed).toBe(false)
    expect(h.deps.report).toHaveBeenCalledWith("request_invalid", "dropped", 1)
    // Later observations are not even queued.
    h.recorder.onVisibility(true, 0)
    expect(h.recorder.getState().outboundCount).toBe(0)
  })

  it("stops sending once the episode's hard horizon has passed", async () => {
    const h = harness()
    h.recorder.start()
    await settle()
    expect(h.deps.sendFacts).toHaveBeenCalledTimes(1)
    h.advance(Date.parse(EPISODE.hardUntil) - T0 + 1_000)
    h.recorder.onPlayingChange(true, 0)
    await settle()
    expect(h.deps.sendFacts).toHaveBeenCalledTimes(1)
    expect(h.deps.report).toHaveBeenCalledWith("episode_expired", "dropped", 1)
    expect(h.recorder.getState()).toMatchObject({
      closed: true,
      claimed: false,
    })
  })

  it("reports a conflict receipt but retires the fact", async () => {
    const h = harness({
      sendFacts: jest.fn(async (variables: PlaybackFactsVariables) =>
        variables.events.map((event, index) => ({
          eventId: event.eventId,
          status: "conflict",
          sequence: index + 1,
        })),
      ),
    })
    h.recorder.start()
    await settle()
    expect(h.deps.report).toHaveBeenCalledWith(
      "integrity_conflict",
      "dropped",
      1,
    )
    expect(h.recorder.getState().outboundCount).toBe(0)
  })
})

describe("caps and accounting", () => {
  it("drops progress facts past the per-kind cap and reports the episode limit", async () => {
    const h = harness()
    h.recorder.start()
    await settle()
    h.recorder.onPlayingChange(true, 0)
    const cap = MAX_FACTS_BY_KIND.playback_progress
    // One progress fact per interval; a feature film outruns the cap.
    for (let i = 1; i <= cap + 5; i += 1) {
      h.advance(PROGRESS_INTERVAL_MS)
      h.recorder.onTick(i * 10, 100_000)
    }
    await settle()
    const progress = h.facts().filter((f) => f.kind === "playback_progress")
    expect(progress).toHaveLength(cap)
    expect(h.deps.report).toHaveBeenCalledWith("episode_limit", "dropped", 1)
    const limitReports = (h.deps.report as jest.Mock).mock.calls.filter(
      ([reason]) => reason === "episode_limit",
    )
    expect(limitReports.length).toBeGreaterThanOrEqual(5)
    // The terminal fact still lands: the cap is per kind, not per episode.
    h.recorder.onEnd("ended", 1_000, 100_000)
    await settle()
    expect(h.kinds()).toContain("playback_end")
  })

  it("charges the fact budget only for facts that are actually queued", async () => {
    const h = harness({
      claimEpisode: jest.fn(() => new Promise(() => undefined)),
    })
    h.recorder.start()
    h.recorder.onPlayingChange(true, 0)
    for (let i = 1; i <= 30; i += 1) {
      h.advance(PROGRESS_INTERVAL_MS)
      h.recorder.onTick(i * 10, 100_000)
    }
    const state = h.recorder.getState()
    expect(h.deps.report).toHaveBeenCalledWith("pending_claim", "dropped", 1)
    // Every fact that was dropped at the pending cap left the budget alone.
    expect(state.factCount).toBe(state.pendingCount)
  })
})

describe("rate limiting", () => {
  const accept = async (variables: PlaybackFactsVariables) =>
    variables.events.map((event, index) => ({
      eventId: event.eventId,
      status: "accepted",
      sequence: index + 1,
    }))
  const limited = (retryAfterMs?: number) =>
    new RecommendationClientError("RATE_LIMITED", { retryAfterMs })

  it("waits out the limiter's window on a rate-limited claim instead of spending an attempt", async () => {
    const claim = jest
      .fn()
      .mockRejectedValueOnce(limited(60_000))
      .mockResolvedValueOnce(EPISODE)
    const h = harness({
      takePendingNonce: jest.fn(() => NONCE),
      claimEpisode: claim,
    })
    h.recorder.start()
    await settle()
    expect(claim).toHaveBeenCalledTimes(2)
    expect(h.deps.wait).toHaveBeenCalledWith(RATE_LIMIT_WINDOW_MS)
    expect(h.deps.report).toHaveBeenCalledWith("rate_limited", "retrying", 1)
    expect(h.deps.issueContext).not.toHaveBeenCalled()
    expect(h.recorder.getState().claimed).toBe(true)
    expect(h.kinds()).toEqual(["playback_attempt"])
  })

  it("abandons a claim the limiter keeps refusing", async () => {
    const claim = jest.fn(async () => {
      throw limited()
    })
    const h = harness({ claimEpisode: claim })
    h.recorder.start()
    await settle()
    expect(claim).toHaveBeenCalledTimes(MAX_CLAIM_RATE_LIMIT_DEFERRALS + 1)
    expect(h.recorder.getState().closed).toBe(true)
    expect(h.deps.report).toHaveBeenCalledWith("rate_limited", "dropped", 1)
  })

  it("waits out the window on a rate-limited context issuance and issues again under the same discovery", async () => {
    const issue = jest
      .fn()
      .mockRejectedValueOnce(limited(30_000))
      .mockResolvedValueOnce({ claimNonce: "c".repeat(32) })
    const h = harness({
      issueContext: issue,
      takeDiscovery: jest.fn(() => ({
        source: "share" as const,
        provenance: {},
      })),
    })
    h.recorder.start()
    h.recorder.onPlayingChange(true, 0)
    await settle()
    expect(issue).toHaveBeenCalledTimes(2)
    expect(h.deps.takeDiscovery).toHaveBeenCalledTimes(1)
    expect(issue).toHaveBeenLastCalledWith(IDENTITY, "media-1", {
      source: "share",
      provenance: {},
    })
    expect(h.deps.wait).toHaveBeenCalledTimes(1)
    expect(h.deps.wait).toHaveBeenCalledWith(30_000)
    expect(h.deps.report).toHaveBeenCalledWith("rate_limited", "retrying", 2)
    expect(h.deps.claimEpisode).toHaveBeenCalledTimes(1)
    expect(h.recorder.getState().claimed).toBe(true)
    expect(h.kinds()).toEqual(["playback_attempt", "playback_start"])
  })

  it("shares the one window deferral between the issuance and the claim", async () => {
    const issue = jest
      .fn()
      .mockRejectedValueOnce(limited())
      .mockResolvedValueOnce({ claimNonce: "c".repeat(32) })
    const claim = jest.fn(async () => {
      throw limited()
    })
    const h = harness({ issueContext: issue, claimEpisode: claim })
    h.recorder.start()
    await settle()
    expect(issue).toHaveBeenCalledTimes(2)
    expect(claim).toHaveBeenCalledTimes(1)
    expect(h.deps.wait).toHaveBeenCalledTimes(1)
    expect(h.recorder.getState().closed).toBe(true)
    expect(h.deps.report).toHaveBeenCalledWith("rate_limited", "dropped", 1)
  })

  it("pauses the facts drain for the window without spending a delivery attempt", async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(limited(30_000))
      .mockRejectedValueOnce(new RecommendationClientError("NETWORK_ERROR"))
      .mockRejectedValueOnce(new RecommendationClientError("NETWORK_ERROR"))
      .mockImplementation(accept)
    const h = harness({ sendFacts: send })
    h.recorder.start()
    await settle()
    // One deferral plus the three real attempts the ladder still owns.
    expect(send).toHaveBeenCalledTimes(4)
    expect(h.deps.wait).toHaveBeenCalledWith(30_000)
    expect(h.deps.report).toHaveBeenCalledWith("rate_limited", "retrying", 1)
    expect(h.deps.report).not.toHaveBeenCalledWith(
      "transport_exhausted",
      "dropped",
      1,
    )
    expect(h.recorder.getState()).toMatchObject({
      closed: false,
      outboundCount: 0,
    })
  })

  it("drops a batch the limiter keeps refusing but keeps the episode open", async () => {
    const send = jest.fn(async () => {
      throw limited()
    })
    const h = harness({ sendFacts: send })
    h.recorder.start()
    await settle()
    expect(send).toHaveBeenCalledTimes(MAX_FACT_RATE_LIMIT_DEFERRALS + 1)
    expect(h.deps.report).toHaveBeenCalledWith("rate_limited", "dropped", 1)
    expect(h.recorder.getState()).toMatchObject({
      closed: false,
      claimed: true,
      outboundCount: 0,
    })
  })
})

describe("dispose while the claim is in flight", () => {
  it("delivers the held facts once when the claim lands after dispose, then stops", async () => {
    let resolveClaim: (value: unknown) => void = () => undefined
    const claim = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveClaim = resolve
        }),
    )
    const h = harness({
      takePendingNonce: jest.fn(() => NONCE),
      claimEpisode: claim,
    })
    h.recorder.start()
    h.recorder.onPlayingChange(true, 0)
    await settle()
    h.recorder.dispose()
    await settle()
    expect(h.deps.sendFacts).not.toHaveBeenCalled()
    resolveClaim(EPISODE)
    await settle()
    // Plan R19: facts recorded before the claim settles are held, then sent.
    expect(h.kinds()).toEqual([
      "playback_attempt",
      "playback_start",
      "playback_observation",
      "playback_end",
    ])
    expect(claim).toHaveBeenCalledTimes(1)
    expect(h.deps.issueContext).not.toHaveBeenCalled()
  })

  it.each(["CONFLICT", "NETWORK_ERROR"] as const)(
    "neither retries nor falls back to a context when a %s claim settles after dispose",
    async (code) => {
      let rejectClaim: (error: unknown) => void = () => undefined
      const claim = jest.fn(
        () =>
          new Promise((_resolve, reject) => {
            rejectClaim = reject
          }),
      )
      const h = harness({
        takePendingNonce: jest.fn(() => NONCE),
        claimEpisode: claim,
      })
      h.recorder.start()
      await settle()
      h.recorder.dispose()
      await settle()
      rejectClaim(new RecommendationClientError(code))
      await settle()
      expect(claim).toHaveBeenCalledTimes(1)
      expect(h.deps.wait).not.toHaveBeenCalled()
      expect(h.deps.issueContext).not.toHaveBeenCalled()
      // The mark is taken up front now, so only issueContext proves that no
      // context fallback ran.
      expect(h.deps.takeDiscovery).toHaveBeenCalledTimes(1)
      expect(h.recorder.getState().closed).toBe(true)
      expect(h.deps.report).toHaveBeenCalledWith(
        "disposed",
        "dropped",
        expect.any(Number),
      )
    },
  )

  it("claims once when the context issuance settles after dispose, then stops", async () => {
    let resolveIssue: (value: unknown) => void = () => undefined
    const issue = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveIssue = resolve
        }),
    )
    const h = harness({ issueContext: issue })
    h.recorder.start()
    h.recorder.onPlayingChange(true, 0)
    await settle()
    h.recorder.dispose()
    await settle()
    expect(h.deps.claimEpisode).not.toHaveBeenCalled()
    resolveIssue({ claimNonce: "c".repeat(32) })
    await settle()
    // Issuance is part of the claim: the chain in flight settles once.
    expect(h.deps.claimEpisode).toHaveBeenCalledTimes(1)
    expect(issue).toHaveBeenCalledTimes(1)
    expect(h.deps.wait).not.toHaveBeenCalled()
    expect(h.kinds()).toEqual([
      "playback_attempt",
      "playback_start",
      "playback_observation",
      "playback_end",
    ])
  })

  it.each(["RATE_LIMITED", "NETWORK_ERROR"] as const)(
    "neither retries nor issues again when a %s issuance settles after dispose",
    async (code) => {
      let rejectIssue: (error: unknown) => void = () => undefined
      const issue = jest.fn(
        () =>
          new Promise((_resolve, reject) => {
            rejectIssue = reject
          }),
      )
      const h = harness({ issueContext: issue })
      h.recorder.start()
      await settle()
      h.recorder.dispose()
      await settle()
      rejectIssue(new RecommendationClientError(code))
      await settle()
      expect(issue).toHaveBeenCalledTimes(1)
      expect(h.deps.wait).not.toHaveBeenCalled()
      expect(h.deps.claimEpisode).not.toHaveBeenCalled()
      expect(h.recorder.getState().closed).toBe(true)
      expect(h.deps.report).toHaveBeenCalledWith(
        "disposed",
        "dropped",
        expect.any(Number),
      )
    },
  )

  it("leaves the selection nonce and the discovery mark for a replacement recorder", async () => {
    let resolveIdentity: (value: unknown) => void = () => undefined
    const h = harness({
      getIdentity: jest.fn(
        () =>
          new Promise((resolve) => {
            resolveIdentity = resolve
          }) as never,
      ),
      takePendingNonce: jest.fn(() => NONCE),
    })
    h.recorder.start()
    h.recorder.dispose()
    resolveIdentity({
      kind: "ready",
      identity: IDENTITY,
      personalization: true,
    })
    await settle()
    expect(h.deps.takePendingNonce).not.toHaveBeenCalled()
    expect(h.deps.takeDiscovery).not.toHaveBeenCalled()
    expect(h.deps.claimEpisode).not.toHaveBeenCalled()
    expect(h.recorder.getState().closed).toBe(true)
  })
})

describe("a disposed abandon puts the selection nonce back", () => {
  const SELECTED = { mediaId: "media-1", claimNonce: NONCE, selectedAt: T0 }

  function selectedStore(): PendingClaimStore {
    const store = createPendingClaimStore(() => T0)
    store.set(SELECTED)
    return store
  }

  /** The real store behind the recorder, so a replacement can redeem it. */
  function storeDeps(store: PendingClaimStore): Partial<PlaybackRecorderDeps> {
    return {
      takePendingNonce: jest.fn((mediaId: string) => store.take(mediaId)),
      restorePendingNonce: jest.fn((claim: PendingRecommendationClaim) =>
        store.restore(claim),
      ),
    }
  }

  async function replacementFor(store: PendingClaimStore) {
    const next = harness(storeDeps(store))
    next.recorder.start()
    await settle()
    return next
  }

  it.each(["RATE_LIMITED", "NETWORK_ERROR"] as const)(
    "hands a %s claim's nonce to the replacement recorder after a dispose in the wait",
    async (code) => {
      const store = selectedStore()
      let first: RecommendationPlaybackRecorder | null = null
      const h = harness({
        ...storeDeps(store),
        claimEpisode: jest.fn(async () => {
          throw new RecommendationClientError(code)
        }),
        wait: jest.fn(async () => {
          first?.dispose()
        }),
      })
      first = h.recorder
      h.recorder.start()
      await settle()
      expect(h.deps.claimEpisode).toHaveBeenCalledTimes(1)
      expect(h.recorder.getState().closed).toBe(true)

      const next = await replacementFor(store)
      expect(next.deps.claimEpisode).toHaveBeenCalledWith(
        IDENTITY,
        NONCE,
        "media-1",
      )
      expect(next.deps.issueContext).not.toHaveBeenCalled()
    },
  )

  it("hands the nonce over when a failed claim mutation settles after dispose", async () => {
    const store = selectedStore()
    let rejectClaim: (error: unknown) => void = () => undefined
    const h = harness({
      ...storeDeps(store),
      claimEpisode: jest.fn(
        () =>
          new Promise((_resolve, reject) => {
            rejectClaim = reject
          }),
      ),
    })
    h.recorder.start()
    await settle()
    h.recorder.dispose()
    await settle()
    rejectClaim(new RecommendationClientError("NETWORK_ERROR"))
    await settle()
    expect(h.deps.wait).not.toHaveBeenCalled()
    expect(h.recorder.getState().closed).toBe(true)

    const next = await replacementFor(store)
    expect(next.deps.claimEpisode).toHaveBeenCalledWith(
      IDENTITY,
      NONCE,
      "media-1",
    )
    expect(next.deps.issueContext).not.toHaveBeenCalled()
  })

  it("keeps a dead nonce from the replacement recorder when a definitive claim settles after dispose", async () => {
    const store = selectedStore()
    let rejectClaim: (error: unknown) => void = () => undefined
    const h = harness({
      ...storeDeps(store),
      claimEpisode: jest.fn(
        () =>
          new Promise((_resolve, reject) => {
            rejectClaim = reject
          }),
      ),
    })
    h.recorder.start()
    await settle()
    h.recorder.dispose()
    await settle()
    rejectClaim(new RecommendationClientError("CONFLICT"))
    await settle()
    expect(h.deps.restorePendingNonce).not.toHaveBeenCalled()
    expect(store.peek()).toBeNull()
    expect(h.deps.issueContext).not.toHaveBeenCalled()

    const next = await replacementFor(store)
    expect(next.deps.issueContext).toHaveBeenCalledTimes(1)
    expect(next.deps.claimEpisode).not.toHaveBeenCalledWith(
      IDENTITY,
      NONCE,
      "media-1",
    )
  })

  it.each(["RATE_LIMITED", "NETWORK_ERROR"] as const)(
    "completes the claim after a %s wait and leaves the store empty",
    async (code) => {
      const store = selectedStore()
      const h = harness({
        ...storeDeps(store),
        claimEpisode: jest
          .fn()
          .mockRejectedValueOnce(new RecommendationClientError(code))
          .mockResolvedValueOnce(EPISODE),
      })
      h.recorder.start()
      await settle()
      expect(h.recorder.getState().claimed).toBe(true)
      expect(h.deps.restorePendingNonce).not.toHaveBeenCalled()
      expect(store.peek()).toBeNull()
    },
  )

  it("does not put the nonce back when the claim fails definitively", async () => {
    const store = selectedStore()
    const h = harness({
      ...storeDeps(store),
      claimEpisode: jest
        .fn()
        .mockRejectedValueOnce(new RecommendationClientError("CONFLICT"))
        .mockResolvedValueOnce(EPISODE),
    })
    h.recorder.start()
    await settle()
    expect(h.deps.issueContext).toHaveBeenCalledTimes(1)
    expect(h.deps.restorePendingNonce).not.toHaveBeenCalled()
    expect(store.peek()).toBeNull()
  })
})

describe("the discovery mark is taken once, whatever the claim path", () => {
  function markedStore() {
    const marks = createPlaybackDiscoveryStore(() => T0)
    marks.mark("media-1", "search")
    return marks
  }

  it("consumes the mark on a nonce claim, so the next open is direct", async () => {
    const marks = markedStore()
    const take = (keys: ReadonlyArray<string | null | undefined>) =>
      marks.take(keys)
    const h = harness({
      takePendingNonce: jest.fn(() => NONCE),
      takeDiscovery: jest.fn(take),
    })
    h.recorder.start()
    await settle()
    expect(h.deps.takeDiscovery).toHaveBeenCalledTimes(1)
    expect(h.deps.claimEpisode).toHaveBeenCalledWith(IDENTITY, NONCE, "media-1")

    const later = harness({ takeDiscovery: jest.fn(take) })
    later.recorder.start()
    await settle()
    expect(later.deps.issueContext).toHaveBeenCalledWith(
      IDENTITY,
      "media-1",
      DIRECT_DISCOVERY,
    )
  })

  it("hands the mark to the context fallback when the nonce is rejected", async () => {
    const marks = markedStore()
    const h = harness({
      takePendingNonce: jest.fn(() => NONCE),
      takeDiscovery: jest.fn((keys: ReadonlyArray<string | null | undefined>) =>
        marks.take(keys),
      ),
      claimEpisode: jest
        .fn()
        .mockRejectedValueOnce(new RecommendationClientError("CONFLICT"))
        .mockResolvedValueOnce(EPISODE),
    })
    h.recorder.start()
    await settle()
    expect(h.deps.takeDiscovery).toHaveBeenCalledTimes(1)
    expect(h.deps.issueContext).toHaveBeenCalledWith(IDENTITY, "media-1", {
      source: "search",
      provenance: { handoff: "search_result" },
    })
  })
})
