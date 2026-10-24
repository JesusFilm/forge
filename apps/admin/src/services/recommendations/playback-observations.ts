import { createHash } from "node:crypto"
import { unionActivePlaybackIntervals } from "./contracts"
import type { FrozenPlaybackFact } from "./outcome.service"

/** Diagnostic policy only. Neither family is a taste or ranking classifier. */
export const PLAYBACK_OBSERVATION_VERSION = "playback-observations-v2" as const
const LEGACY_PLAYBACK_OBSERVATION_VERSION = "playback-observations-v1"
export const IMMEDIATE_DEPARTURE_WINDOW_MS = 10_000

type Payload = Record<string, unknown>
function payload(value: unknown): Payload {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Payload)
    : {}
}
function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
function elapsed(
  start: Date | undefined,
  end: Date | undefined,
): number | null {
  if (!start || !end) return null
  const difference = end.getTime() - start.getTime()
  return difference >= 0 && difference <= 6 * 60 * 60 * 1000 ? difference : null
}

/** Recomputable from retained facts; stable event IDs are already unique in storage. */
export function projectPlaybackObservations(
  input: readonly FrozenPlaybackFact[],
  options: { conflictCount?: number; finalized?: boolean } = {},
) {
  const facts = [
    ...new Map(input.map((fact) => [fact.eventId, fact])).values(),
  ].sort((a, b) => a.sequence - b.sequence)
  const first = (kind: string) => facts.find((fact) => fact.kind === kind)
  const attempt = first("playback_attempt")
  const start = first("playback_start")
  const end = facts.find((fact) => fact.kind === "playback_end")
  const errors = facts.filter((fact) => fact.kind === "playback_error")
  const observation = payload(first("playback_observation")?.payload)
  const supported =
    observation.version === PLAYBACK_OBSERVATION_VERSION ||
    observation.version === LEGACY_PLAYBACK_OBSERVATION_VERSION
  const navigation = facts.filter((fact) => fact.kind === "playback_navigation")
  const qoe = facts.filter((fact) => fact.kind === "playback_qoe")
  const actionCount = (action: string) =>
    navigation.filter((fact) => payload(fact.payload).action === action).length
  const active = facts.filter(
    (fact) => fact.kind === "playback_active_visible_playing",
  )
  const activeMilliseconds = unionActivePlaybackIntervals(
    active.flatMap((fact) => {
      const amount = finite(payload(fact.payload).activeMilliseconds)
      return amount == null || amount < 0
        ? []
        : [
            {
              startMilliseconds: fact.occurredAt.getTime() - amount,
              endMilliseconds: fact.occurredAt.getTime(),
            },
          ]
    }),
  )
  const activeCoverage =
    active.length === 0
      ? "missing"
      : active.some((fact) => payload(fact.payload).coverage !== "complete")
        ? "partial"
        : "complete"
  const elapsedMilliseconds = elapsed(attempt?.occurredAt, end?.occurredAt)
  const reportedElapsed = finite(observation.elapsedMilliseconds)
  const timingVerified =
    supported &&
    (!start ||
      (elapsed(attempt?.occurredAt, start.occurredAt) != null &&
        elapsed(start.occurredAt, end?.occurredAt) != null)) &&
    elapsedMilliseconds != null &&
    reportedElapsed != null &&
    Math.abs(elapsedMilliseconds - reportedElapsed) <= 1000
  const conflicted = (options.conflictCount ?? 0) > 0
  const startMatches = supported && observation.startObserved === Boolean(start)
  const seekCount = facts.filter((fact) => fact.kind === "playback_seek").length
  const navigationComplete =
    supported &&
    finite(observation.navigationCount) === navigation.length &&
    finite(observation.seekCount) === seekCount
  const qoeComplete =
    supported &&
    startMatches &&
    observation.errorObserved === errors.length > 0 &&
    finite(observation.qoeCount) === qoe.length
  const evidenceComplete = navigationComplete && qoeComplete
  const completed = payload(end?.payload).completed === true
  const interrupted =
    navigation.some((fact) =>
      ["hidden", "bfcache_suspend"].includes(
        String(payload(fact.payload).action),
      ),
    ) ||
    observation.visibility === "hidden" ||
    payload(end?.payload).reason === "hidden"
  const departure = ["route_exit", "pagehide"].includes(
    String(payload(end?.payload).reason),
  )
  const stage = !startMatches
    ? "unknown"
    : start
      ? "after_start"
      : attempt
        ? "before_start"
        : "unknown"
  const immediate =
    departure &&
    timingVerified &&
    evidenceComplete &&
    !conflicted &&
    !completed &&
    errors.length === 0 &&
    !interrupted
      ? elapsedMilliseconds! <= IMMEDIATE_DEPARTURE_WINDOW_MS
      : null
  const classification = conflicted
    ? "conflicted_evidence"
    : completed
      ? "completion"
      : errors.length
        ? "playback_error"
        : interrupted
          ? "interrupted_visibility_or_lifecycle"
          : !departure || !timingVerified || !evidenceComplete
            ? "insufficient_evidence"
            : !start
              ? "pre_start_departure"
              : immediate
                ? "rapid_post_start_departure"
                : "later_departure"
  const seeks = facts
    .filter((fact) => fact.kind === "playback_seek")
    .map((fact) => payload(fact.payload))
  const chronology = [...facts].sort(
    (a, b) =>
      a.occurredAt.getTime() - b.occurredAt.getTime() ||
      a.sequence - b.sequence,
  )
  let bufferingAt: Date | undefined
  let bufferingMilliseconds = 0
  let bufferingEpisodes = 0
  for (const fact of chronology) {
    if (fact.kind !== "playback_qoe") continue
    const action = payload(fact.payload).action
    if ((action === "waiting" || action === "stalled") && !bufferingAt) {
      bufferingAt = fact.occurredAt
      bufferingEpisodes += 1
    } else if (action === "buffering_end" && bufferingAt) {
      bufferingMilliseconds += elapsed(bufferingAt, fact.occurredAt) ?? 0
      bufferingAt = undefined
    }
  }
  const familyCoverage = (complete: boolean) =>
    !supported ? "missing" : conflicted || !complete ? "partial" : "observed"
  const familyDigest = (family: "navigation" | "qoe") =>
    createHash("sha256")
      .update(
        JSON.stringify({
          family,
          version: observation.version ?? null,
          conflictCount: options.conflictCount ?? 0,
          summary:
            family === "navigation"
              ? [observation.navigationCount, observation.seekCount]
              : [
                  observation.qoeCount,
                  observation.startObserved,
                  observation.errorObserved,
                  observation.deviceClass,
                  observation.networkClass,
                ],
          facts: facts
            .filter((fact) =>
              family === "navigation"
                ? [
                    "playback_attempt",
                    "playback_navigation",
                    "playback_seek",
                  ].includes(fact.kind)
                : [
                    "playback_attempt",
                    "playback_start",
                    "playback_qoe",
                    "playback_error",
                  ].includes(fact.kind),
            )
            .map(({ sequence, eventId, payloadDigest }) => ({
              sequence,
              eventId,
              payloadDigest,
            })),
        }),
      )
      .digest("hex")
  return {
    version:
      observation.version === LEGACY_PLAYBACK_OBSERVATION_VERSION
        ? LEGACY_PLAYBACK_OBSERVATION_VERSION
        : PLAYBACK_OBSERVATION_VERSION,
    factWatermark: facts.at(-1)?.sequence ?? 0,
    inputDigest: createHash("sha256")
      .update(
        JSON.stringify({
          version: PLAYBACK_OBSERVATION_VERSION,
          conflictCount: options.conflictCount ?? 0,
          facts: facts.map(({ sequence, eventId, payloadDigest }) => ({
            sequence,
            eventId,
            payloadDigest,
          })),
        }),
      )
      .digest("hex"),
    finalized: options.finalized ?? false,
    preferenceInterpretation: "unknown" as const,
    rankingInfluence: false as const,
    departure: {
      classification,
      stage,
      immediate,
      windowMilliseconds: IMMEDIATE_DEPARTURE_WINDOW_MS,
      elapsedMilliseconds,
      activeMilliseconds,
      activeCoverage,
      timingVerified,
      cause: "unknown" as const,
      trigger: departure ? String(payload(end?.payload).reason) : null,
      playerState:
        typeof observation.playerState === "string"
          ? observation.playerState
          : "unknown",
    },
    navigation: {
      inputDigest: familyDigest("navigation"),
      coverage: familyCoverage(navigationComplete),
      decision: "inconclusive" as const,
      pauses: actionCount("pause"),
      resumes: actionCount("resume"),
      manualSkips: actionCount("manual_skip"),
      autoplayTransitions: actionCount("autoplay_transition"),
      userPauses: navigation.filter(
        (fact) =>
          payload(fact.payload).action === "pause" &&
          payload(fact.payload).cause === "user",
      ).length,
      scrollPauses: navigation.filter(
        (fact) =>
          payload(fact.payload).action === "pause" &&
          payload(fact.payload).cause === "scroll",
      ).length,
      systemPauses: navigation.filter(
        (fact) =>
          payload(fact.payload).action === "pause" &&
          payload(fact.payload).cause === "system",
      ).length,
      unknownPauses: navigation.filter(
        (fact) =>
          payload(fact.payload).action === "pause" &&
          !["user", "scroll", "system"].includes(
            String(payload(fact.payload).cause),
          ),
      ).length,
      forwardSeeks: seeks.filter(
        (seek) =>
          (finite(seek.toSeconds) ?? 0) > (finite(seek.fromSeconds) ?? 0),
      ).length,
      backwardSeeks: seeks.filter(
        (seek) =>
          (finite(seek.toSeconds) ?? 0) < (finite(seek.fromSeconds) ?? 0),
      ).length,
      returnsToStart: seeks.filter(
        (seek) =>
          (finite(seek.toSeconds) ?? Infinity) <= 1 &&
          (finite(seek.fromSeconds) ?? 0) > 1,
      ).length,
      automaticAttempt: payload(attempt?.payload).initiation === "automatic",
      hiddenTransitions: actionCount("hidden"),
      bfcacheSuspensions: actionCount("bfcache_suspend"),
      reasonCodes: [
        "preference_interpretation_unknown",
        "unattributed_pause_cause_unknown",
        "replay_intent_unavailable",
      ],
    },
    qoe: {
      inputDigest: familyDigest("qoe"),
      coverage: familyCoverage(qoeComplete),
      decision: "inconclusive" as const,
      startupMilliseconds: elapsed(attempt?.occurredAt, start?.occurredAt),
      startupTimeouts: qoe.filter(
        (fact) => payload(fact.payload).action === "startup_timeout",
      ).length,
      bufferingEpisodes,
      bufferingMilliseconds,
      openBufferingInterval: bufferingAt != null,
      errors: errors.length,
      fatalErrors: qoe.filter(
        (fact) =>
          payload(fact.payload).action === "media_error" &&
          payload(fact.payload).severity === "fatal",
      ).length,
      unknownSeverityErrors: qoe.filter(
        (fact) =>
          payload(fact.payload).action === "media_error" &&
          payload(fact.payload).severity !== "fatal",
      ).length,
      closedBufferIntervals: qoe.filter(
        (fact) => payload(fact.payload).action === "buffering_end",
      ).length,
      deviceClass:
        observation.deviceClass === "mobile" ||
        observation.deviceClass === "desktop"
          ? observation.deviceClass
          : "unknown",
      networkClass: ["slow-2g", "2g", "3g", "4g"].includes(
        String(observation.networkClass),
      )
        ? String(observation.networkClass)
        : "unknown",
      reasonCodes: [
        "nonfatal_error_recoverability_unknown",
        ...(observation.version === LEGACY_PLAYBACK_OBSERVATION_VERSION
          ? ["startup_timeout_unavailable", "device_and_network_unavailable"]
          : []),
      ],
    },
  }
}

export type PlaybackObservationProjection = ReturnType<
  typeof projectPlaybackObservations
>
