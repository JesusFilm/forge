import { describe, expect, it } from "vitest"
import { RecommendationPlaybackEventSchema } from "./contracts"
import {
  projectPlaybackObservations,
  PLAYBACK_OBSERVATION_VERSION,
} from "./playback-observations"
import {
  rebuildPlaybackProjection,
  type FrozenPlaybackFact,
} from "./outcome.service"

const origin = Date.parse("2026-09-15T00:00:00Z")
function fact(
  sequence: number,
  kind: string,
  milliseconds: number,
  payload: unknown,
): FrozenPlaybackFact {
  return {
    sequence,
    kind,
    eventId: `event-${sequence}`,
    payload,
    payloadDigest: `${sequence}`.padStart(64, "0"),
    occurredAt: new Date(origin + milliseconds),
    late: false,
  }
}
const attempt = () => fact(1, "playback_attempt", 0, { initiation: "manual" })
const end = (milliseconds = 3000, overrides: Record<string, unknown> = {}) =>
  fact(20, "playback_end", milliseconds, {
    reason: "route_exit",
    completed: false,
    ...overrides,
  })
const summary = (
  milliseconds = 3000,
  overrides: Record<string, unknown> = {},
) =>
  fact(19, "playback_observation", milliseconds, {
    version: PLAYBACK_OBSERVATION_VERSION,
    elapsedMilliseconds: milliseconds,
    visibility: "visible",
    playerState: "paused",
    startObserved: true,
    errorObserved: false,
    seekCount: 0,
    navigationCount: 0,
    qoeCount: 0,
    deviceClass: "unknown",
    networkClass: "unknown",
    ...overrides,
  })
const started = () => [
  attempt(),
  fact(2, "playback_start", 1000, { positionSeconds: 0 }),
  fact(3, "playback_active_visible_playing", 3000, {
    activeMilliseconds: 2000,
    coverage: "complete",
  }),
]

describe("versioned playback observations", () => {
  it("keeps pre-start and rapid post-start departures separate with unknown preference", () => {
    expect(
      projectPlaybackObservations([
        attempt(),
        summary(3000, { startObserved: false }),
        end(),
      ]).departure,
    ).toMatchObject({
      classification: "pre_start_departure",
      immediate: true,
      activeCoverage: "missing",
    })
    const facts = [...started(), summary(), end()]
    expect(projectPlaybackObservations(facts)).toMatchObject({
      preferenceInterpretation: "unknown",
      rankingInfluence: false,
      departure: {
        classification: "rapid_post_start_departure",
        elapsedMilliseconds: 3000,
        activeMilliseconds: 2000,
        cause: "unknown",
      },
      navigation: { decision: "inconclusive" },
      qoe: { decision: "inconclusive" },
    })
    expect(
      rebuildPlaybackProjection(facts, "terminal-fact").active.qualifiedView,
    ).toBe(false)
  })
  it.each([10_001, 60_000, 300_000])(
    "keeps short active time separate from elapsed %i ms",
    (milliseconds) => {
      expect(
        projectPlaybackObservations([
          ...started(),
          summary(milliseconds),
          end(milliseconds),
        ]).departure,
      ).toMatchObject({
        immediate: false,
        classification: "later_departure",
        activeMilliseconds: 2000,
      })
    },
  )
  it.each([
    ["completion", end(3000, { completed: true })],
    [
      "playback_error",
      fact(5, "playback_error", 2500, { code: "media_error" }),
    ],
    [
      "interrupted_visibility_or_lifecycle",
      fact(5, "playback_navigation", 2000, {
        action: "hidden",
        cause: "unknown",
      }),
    ],
    [
      "interrupted_visibility_or_lifecycle",
      fact(5, "playback_navigation", 2000, {
        action: "bfcache_suspend",
        cause: "unknown",
      }),
    ],
  ] as const)("preserves %s separately", (classification, observation) => {
    const facts =
      observation.kind === "playback_end"
        ? [...started(), summary(), observation]
        : [...started(), summary(), end(), observation]
    expect(projectPlaybackObservations(facts).departure).toMatchObject({
      classification,
      immediate: null,
    })
  })
  it("keeps legacy, missing summary/terminal, clock mismatch, reversed start and conflicts unknown", () => {
    for (const facts of [
      [attempt(), end()],
      started(),
      [attempt(), summary(3000, { elapsedMilliseconds: 0 }), end()],
      [attempt(), fact(2, "playback_start", 4000, {}), summary(), end()],
    ]) {
      expect(projectPlaybackObservations(facts).departure).toMatchObject({
        classification: "insufficient_evidence",
        immediate: null,
      })
    }
    expect(
      projectPlaybackObservations([attempt(), end()]).navigation.coverage,
    ).toBe("missing")
    expect(
      projectPlaybackObservations([...started(), summary(), end()], {
        conflictCount: 1,
      }).departure.classification,
    ).toBe("conflicted_evidence")
  })
  it("requires the declared navigation and QoE counts before classifying a quick departure", () => {
    const missing = [
      ...started(),
      summary(3000, { navigationCount: 1, qoeCount: 1 }),
      end(),
    ]
    const result = projectPlaybackObservations(missing)
    expect(result).toMatchObject({
      departure: { immediate: null, classification: "insufficient_evidence" },
      navigation: { coverage: "partial" },
      qoe: { coverage: "partial" },
    })
    const withNavigation = [
      ...missing,
      fact(4, "playback_navigation", 2000, { action: "pause" }),
    ]
    expect(projectPlaybackObservations(withNavigation)).toMatchObject({
      navigation: { coverage: "observed" },
      qoe: { coverage: "partial" },
      departure: { immediate: null },
    })
  })
  it("keeps a lost playback start or seek distinct from observed absence", () => {
    expect(
      projectPlaybackObservations([attempt(), summary(), end()]),
    ).toMatchObject({
      departure: {
        stage: "unknown",
        immediate: null,
        classification: "insufficient_evidence",
      },
      qoe: { coverage: "partial" },
    })
    expect(
      projectPlaybackObservations([
        ...started(),
        summary(3000, { seekCount: 1 }),
        end(),
      ]),
    ).toMatchObject({
      departure: { immediate: null, classification: "insufficient_evidence" },
      navigation: { coverage: "partial" },
    })
  })

  it("marks QoE partial when a reported error fact is missing", () => {
    expect(
      projectPlaybackObservations([
        ...started(),
        summary(3000, { errorObserved: true }),
        end(),
      ]),
    ).toMatchObject({
      departure: { immediate: null, classification: "insufficient_evidence" },
      qoe: { coverage: "partial" },
    })
  })

  it("recomputes after late evidence and deduplicates stable facts", () => {
    const facts = [...started(), summary(), end()]
    const complete = projectPlaybackObservations(facts)
    expect(complete.inputDigest).not.toBe(
      projectPlaybackObservations([end()]).inputDigest,
    )
    expect(projectPlaybackObservations([...facts, ...facts])).toEqual(complete)
    expect(projectPlaybackObservations([...facts].reverse())).toEqual(complete)
  })
  it("projects navigation and QoE independently", () => {
    const facts = [
      attempt(),
      fact(2, "playback_start", 1000, {}),
      fact(3, "playback_navigation", 2000, { action: "pause" }),
      fact(4, "playback_seek", 3000, { fromSeconds: 20, toSeconds: 0 }),
      fact(5, "playback_seek", 4000, { fromSeconds: 0, toSeconds: 25 }),
      fact(6, "playback_qoe", 5000, { action: "waiting" }),
      fact(7, "playback_qoe", 5001, { action: "stalled" }),
      fact(8, "playback_qoe", 8000, { action: "buffering_end" }),
      fact(9, "playback_qoe", 9000, { action: "waiting" }),
      summary(10_000, { navigationCount: 1, qoeCount: 4, seekCount: 2 }),
    ]
    const result = projectPlaybackObservations(facts)
    expect(result.navigation).toMatchObject({
      pauses: 1,
      backwardSeeks: 1,
      forwardSeeks: 1,
      returnsToStart: 1,
      coverage: "observed",
    })
    expect(result.qoe).toMatchObject({
      startupMilliseconds: 1000,
      bufferingMilliseconds: 3000,
      bufferingEpisodes: 2,
      openBufferingInterval: true,
    })
    expect(
      projectPlaybackObservations(
        facts.filter((entry) => entry.kind !== "playback_navigation"),
      ).qoe,
    ).toEqual(result.qoe)
  })
  it("keeps explicit navigation intent, QoE severity, and unknown device evidence separate", () => {
    const facts = [
      attempt(),
      fact(2, "playback_start", 1000, { positionSeconds: 0 }),
      fact(3, "playback_navigation", 1200, { action: "pause", cause: "user" }),
      fact(4, "playback_navigation", 1400, {
        action: "manual_skip",
        cause: "user",
      }),
      fact(5, "playback_qoe", 1600, {
        action: "media_error",
        severity: "fatal",
      }),
      fact(6, "playback_error", 1600, { code: "media_error" }),
      summary(1600, {
        navigationCount: 2,
        qoeCount: 1,
        errorObserved: true,
        deviceClass: "unknown",
        networkClass: "3g",
      }),
    ]
    const result = projectPlaybackObservations(facts)
    expect(result.navigation).toMatchObject({
      coverage: "observed",
      userPauses: 1,
      manualSkips: 1,
      unknownPauses: 0,
    })
    expect(result.qoe).toMatchObject({
      coverage: "observed",
      fatalErrors: 1,
      deviceClass: "unknown",
      networkClass: "3g",
    })
    expect(
      projectPlaybackObservations(
        facts.filter((entry) => entry.kind !== "playback_qoe"),
      ).navigation.inputDigest,
    ).toBe(result.navigation.inputDigest)
  })
  it("validates bounded observations and preserves the exact baseline event schema", () => {
    const base = {
      eventId: "observation",
      occurredAt: new Date(origin).toISOString(),
    }
    expect(
      RecommendationPlaybackEventSchema.safeParse({
        ...base,
        kind: "playback_attempt",
        payload: { initiation: "manual" },
      }).success,
    ).toBe(true)
    expect(
      RecommendationPlaybackEventSchema.safeParse({
        ...base,
        kind: "playback_navigation",
        payload: { action: "pause", cause: "unknown", positionSeconds: 1 },
      }).success,
    ).toBe(true)
    expect(
      RecommendationPlaybackEventSchema.safeParse({
        ...base,
        kind: "playback_qoe",
        payload: { action: "waiting", cause: "dislike", positionSeconds: 1 },
      }).success,
    ).toBe(false)
    expect(
      RecommendationPlaybackEventSchema.safeParse({
        ...base,
        kind: "playback_observation",
        payload: { ...(summary().payload as object), navigationCount: 65536 },
      }).success,
    ).toBe(false)
    expect(
      RecommendationPlaybackEventSchema.safeParse({
        ...base,
        kind: "playback_observation",
        payload: {
          ...(summary().payload as object),
          deviceClass: undefined,
        },
      }).success,
    ).toBe(false)
    expect(
      RecommendationPlaybackEventSchema.safeParse({
        ...base,
        kind: "playback_navigation",
        payload: {
          action: "manual_skip",
          cause: "unknown",
          positionSeconds: 1,
        },
      }).success,
    ).toBe(false)
    expect(
      RecommendationPlaybackEventSchema.safeParse({
        ...base,
        kind: "playback_qoe",
        payload: {
          action: "media_error",
          cause: "unknown",
          positionSeconds: 1,
        },
      }).success,
    ).toBe(false)
  })
})
