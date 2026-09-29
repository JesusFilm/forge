import { createHash } from "node:crypto"
import {
  assertCowatchSourceWindow,
  type CowatchSourceWindow,
} from "./source-window"

/** Population relationship truth. No profile identity or embedding is published. */
export const COWATCH_FEATURE_VERSION = "directional-cowatch-feature-v1" as const
export const COWATCH_PROJECTION_VERSION =
  "directional-cowatch-projection-v1" as const
export const COWATCH_SHADOW_GENERATOR_KEY =
  "directional-cowatch-shadow-v1" as const
export const COWATCH_MAX_GAP_MS = 48 * 60 * 60 * 1_000
const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1_000
const SHRINKAGE_SUPPORT = 5
const MIN_DISTINCT_VIEWERS = 3
const MIN_CONFIDENCE = 0.15
const MIN_LIFT = 1.05
const MAX_SESSION_ROWS = 256
const MAX_PAIR_ATTEMPTS = 250_000

export type CowatchOutcome = Readonly<{
  outcomeId: string
  episodeId: string
  revision: number
  mediaId: string
  sessionDigest: string
  /** Stable private support unit where available; falls back to a single session. */
  viewerKey: string
  occurredAt: Date
  qualified: boolean
  finalized: boolean
  integrityEligible: boolean
  eligibilityDecisionId: string | null
  eligibilityRevision: number | null
  eligibilityPolicyVersion: string | null
  qualityWeight: number
  expiresAt: Date
}>

export type CowatchContribution = Readonly<{
  sourceOutcomeId: string
  targetOutcomeId: string
  sourceMediaId: string
  targetMediaId: string
  sessionDigest: string
  viewerKey: string
  gapMs: number
  occurredAt: Date
  qualityWeight: number
  recencyWeight: number
  effectiveWeight: number
}>

export type CowatchFeature = Readonly<{
  contractVersion: typeof COWATCH_FEATURE_VERSION
  generation: string
  sourceMediaId: string
  targetMediaId: string
  sessionSupport: number
  distinctViewerSupport: number
  confidence: number
  popularityCorrectedLift: number
  recencyWeight: number
  qualityWeight: number
  effectiveWeight: number
  contamination: number
  eligible: boolean
}>

export type CowatchGraph = Readonly<{
  generation: string
  projectionVersion: typeof COWATCH_PROJECTION_VERSION
  featureVersion: typeof COWATCH_FEATURE_VERSION
  sources: readonly CowatchOutcome[]
  contributions: readonly CowatchContribution[]
  edges: readonly CowatchFeature[]
  uniqueViewers: number
  qualifiedOutcomes: number
  attemptedPairCount: number
}>

export class CowatchWorkOverflowError extends RangeError {
  constructor(
    readonly bound: "session_sources" | "pair_attempts",
    readonly eligibleSourceCount: number,
    readonly attemptedPairCount: number,
  ) {
    super(`co-watch ${bound} exceeds bounded projection`)
    this.name = "CowatchWorkOverflowError"
  }
}

/**
 * Rebuilds from current source truth. Selecting the latest revision BEFORE
 * checking eligibility prevents a superseded positive revision surviving a
 * negative correction. The same session/pair contributes at most once, then
 * each support unit contributes at most once per directional pair.
 */
export function buildCowatchGraph(
  outcomes: readonly CowatchOutcome[],
  now: Date,
  sourceWindow?: CowatchSourceWindow,
): CowatchGraph {
  if (sourceWindow) assertCowatchSourceWindow(sourceWindow, now)
  const evaluationAsOf = sourceWindow?.evaluationAsOf ?? now
  const latest = new Map<string, CowatchOutcome>()
  for (const row of outcomes) {
    const prior = latest.get(row.episodeId)
    if (
      !prior ||
      row.revision > prior.revision ||
      (row.revision === prior.revision && row.outcomeId > prior.outcomeId)
    ) {
      latest.set(row.episodeId, row)
    }
  }
  const eligible = [...latest.values()]
    .filter(
      (row) =>
        row.qualified &&
        row.finalized &&
        row.integrityEligible &&
        row.eligibilityDecisionId != null &&
        row.eligibilityRevision != null &&
        row.eligibilityPolicyVersion != null &&
        row.expiresAt > now &&
        (sourceWindow
          ? row.occurredAt >= sourceWindow.windowStart &&
            row.occurredAt < sourceWindow.windowEnd
          : row.occurredAt <= now &&
            row.occurredAt >= new Date(now.getTime() - 180 * 86_400_000)) &&
        Number.isFinite(row.qualityWeight) &&
        row.qualityWeight > 0,
    )
    .sort(
      (a, b) =>
        a.occurredAt.getTime() - b.occurredAt.getTime() ||
        a.episodeId.localeCompare(b.episodeId),
    )
  const sessions = new Map<string, CowatchOutcome[]>()
  for (const row of eligible) {
    const session = sessions.get(row.sessionDigest) ?? []
    session.push(row)
    sessions.set(row.sessionDigest, session)
  }
  const perSessionPair = new Map<string, CowatchContribution>()
  let pairAttempts = 0
  for (const [sessionDigest, rows] of sessions) {
    if (rows.length > MAX_SESSION_ROWS) {
      throw new CowatchWorkOverflowError(
        "session_sources",
        eligible.length,
        pairAttempts,
      )
    }
    for (let a = 0; a < rows.length; a++) {
      for (let b = a + 1; b < rows.length; b++) {
        pairAttempts += 1
        if (pairAttempts > MAX_PAIR_ATTEMPTS) {
          throw new CowatchWorkOverflowError(
            "pair_attempts",
            eligible.length,
            pairAttempts,
          )
        }
        const source = rows[a]
        const target = rows[b]
        const gapMs = target.occurredAt.getTime() - source.occurredAt.getTime()
        if (gapMs > COWATCH_MAX_GAP_MS) break
        if (gapMs <= 0 || source.mediaId === target.mediaId) continue
        const qualityWeight = Math.sqrt(
          clamp01(source.qualityWeight) * clamp01(target.qualityWeight),
        )
        const recencyWeight = Math.exp(
          (-Math.LN2 *
            (evaluationAsOf.getTime() - target.occurredAt.getTime())) /
            HALF_LIFE_MS,
        )
        const candidate: CowatchContribution = {
          sourceOutcomeId: source.outcomeId,
          targetOutcomeId: target.outcomeId,
          sourceMediaId: source.mediaId,
          targetMediaId: target.mediaId,
          sessionDigest,
          viewerKey: source.viewerKey,
          gapMs,
          occurredAt: target.occurredAt,
          qualityWeight,
          recencyWeight,
          effectiveWeight: qualityWeight * recencyWeight,
        }
        const key = `${sessionDigest}\0${source.mediaId}\0${target.mediaId}`
        const existing = perSessionPair.get(key)
        if (
          !existing ||
          candidate.effectiveWeight > existing.effectiveWeight ||
          (candidate.effectiveWeight === existing.effectiveWeight &&
            candidate.sourceOutcomeId < existing.sourceOutcomeId)
        ) {
          perSessionPair.set(key, candidate)
        }
      }
    }
  }
  const perViewerPair = new Map<string, CowatchContribution>()
  for (const candidate of perSessionPair.values()) {
    const key = `${candidate.viewerKey}\0${candidate.sourceMediaId}\0${candidate.targetMediaId}`
    const existing = perViewerPair.get(key)
    if (
      !existing ||
      candidate.effectiveWeight > existing.effectiveWeight ||
      (candidate.effectiveWeight === existing.effectiveWeight &&
        candidate.sourceOutcomeId < existing.sourceOutcomeId)
    ) {
      perViewerPair.set(key, candidate)
    }
  }
  const contributions = [...perViewerPair.values()].sort(compareContributions)
  const generation = createHash("sha256")
    .update(COWATCH_PROJECTION_VERSION)
    .update("\0")
    .update(
      sourceWindow
        ? JSON.stringify([
            sourceWindow.version,
            sourceWindow.windowStart.toISOString(),
            sourceWindow.windowEnd.toISOString(),
            sourceWindow.evaluationAsOf.toISOString(),
          ])
        : now.toISOString(),
    )
    .update("\0")
    .update(
      JSON.stringify(
        eligible.map((row) => [
          row.outcomeId,
          row.episodeId,
          row.revision,
          row.mediaId,
          row.viewerKey,
          row.eligibilityDecisionId,
          row.eligibilityRevision,
          row.eligibilityPolicyVersion,
          row.qualityWeight,
          row.occurredAt.toISOString(),
        ]),
      ),
    )
    .digest("hex")
  const viewersByMedia = new Map<string, Set<string>>()
  for (const row of eligible) {
    const viewers = viewersByMedia.get(row.mediaId) ?? new Set<string>()
    viewers.add(row.viewerKey)
    viewersByMedia.set(row.mediaId, viewers)
  }
  const allViewers = new Set(eligible.map((row) => row.viewerKey)).size
  const groups = new Map<string, CowatchContribution[]>()
  for (const row of contributions) {
    const key = `${row.sourceMediaId}\0${row.targetMediaId}`
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  const edges = [...groups.values()]
    .map((rows): CowatchFeature => {
      const first = rows[0]
      const support = new Set(rows.map((row) => row.viewerKey)).size
      const sourceViewers = viewersByMedia.get(first.sourceMediaId)?.size ?? 0
      const targetViewers = viewersByMedia.get(first.targetMediaId)?.size ?? 0
      const observed = support / Math.max(1, sourceViewers)
      const baseline = targetViewers / Math.max(1, allViewers)
      const shrinkage = support / (support + SHRINKAGE_SUPPORT)
      const popularityCorrectedLift =
        1 + shrinkage * (observed / Math.max(0.001, baseline) - 1)
      const bySession = new Map<string, number>()
      for (const row of rows) {
        bySession.set(
          row.sessionDigest,
          (bySession.get(row.sessionDigest) ?? 0) + 1,
        )
      }
      let largestSession = 0
      for (const count of bySession.values())
        largestSession = Math.max(largestSession, count)
      const concentration = rows.length === 0 ? 1 : largestSession / rows.length
      const confidence = wilsonLowerBound(support, sourceViewers) * shrinkage
      const recencyWeight = average(rows.map((row) => row.recencyWeight))
      const qualityWeight = average(rows.map((row) => row.qualityWeight))
      return {
        contractVersion: COWATCH_FEATURE_VERSION,
        generation,
        sourceMediaId: first.sourceMediaId,
        targetMediaId: first.targetMediaId,
        sessionSupport: rows.length,
        distinctViewerSupport: support,
        confidence,
        popularityCorrectedLift,
        recencyWeight,
        qualityWeight,
        effectiveWeight: rows.reduce(
          (sum, row) => sum + row.effectiveWeight,
          0,
        ),
        contamination: concentration,
        eligible:
          support >= MIN_DISTINCT_VIEWERS &&
          confidence >= MIN_CONFIDENCE &&
          popularityCorrectedLift >= MIN_LIFT &&
          concentration < 0.5,
      }
    })
    .sort(
      (a, b) =>
        a.sourceMediaId.localeCompare(b.sourceMediaId) ||
        a.targetMediaId.localeCompare(b.targetMediaId),
    )
  return {
    generation,
    projectionVersion: COWATCH_PROJECTION_VERSION,
    featureVersion: COWATCH_FEATURE_VERSION,
    sources: eligible,
    contributions,
    edges,
    uniqueViewers: allViewers,
    qualifiedOutcomes: eligible.length,
    attemptedPairCount: pairAttempts,
  }
}

/** Consumers must explicitly reject missing, stale or unknown feature contracts. */
export function compatibleCowatchFeature(
  feature: CowatchFeature | null,
  generation: string,
): CowatchFeature | null {
  return feature?.contractVersion === COWATCH_FEATURE_VERSION &&
    feature.generation === generation &&
    feature.eligible
    ? feature
    : null
}

function compareContributions(a: CowatchContribution, b: CowatchContribution) {
  return (
    a.sourceMediaId.localeCompare(b.sourceMediaId) ||
    a.targetMediaId.localeCompare(b.targetMediaId) ||
    a.viewerKey.localeCompare(b.viewerKey) ||
    a.sourceOutcomeId.localeCompare(b.sourceOutcomeId)
  )
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function average(values: readonly number[]) {
  return (
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  )
}

function wilsonLowerBound(successes: number, trials: number) {
  if (trials === 0) return 0
  const z = 1.96
  const p = successes / trials
  const denominator = 1 + (z * z) / trials
  return (
    (p +
      (z * z) / (2 * trials) -
      z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trials)) / trials)) /
    denominator
  )
}
