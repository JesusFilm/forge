import { randomUUID } from "node:crypto"
import {
  Prisma,
  RecommendationEpisodeState,
  type PrismaClient,
} from "@prisma/client"
import { prisma as defaultPrisma } from "@/db/client"
import {
  ACTIVE_WATCH_PROXY_VERSION,
  RECOMMENDATION_CONTRACTS,
  classifyActiveWatchProxy,
  classifyLegacyPosition,
  isTerminalRecommendationFactKind,
  mergeActivePlaybackIntervals,
  type ActiveWatchProxyOutcome,
  type LegacyPositionOutcome,
} from "./contracts"
import { recommendationEvidenceDigest } from "./evidence.service"
import { RecommendationConflictError } from "./errors"
import { withRecommendationSerializableRetry } from "./transaction-retry"

type OutcomeDependencies = {
  prisma: PrismaClient
  now?: () => Date
  newId?: () => string
}

export type FrozenPlaybackFact = {
  eventId: string
  sequence: number
  kind: string
  payload: unknown
  payloadDigest: string
  occurredAt: Date
  late: boolean
}

type FinalizationInput = {
  episodeId: string
  generation: number
  reason?: "fact-advanced" | "terminal-fact" | "timeout" | "recovery"
}

function numberField(payload: unknown, field: string): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null
  }
  const value = (payload as Record<string, unknown>)[field]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stringField(payload: unknown, field: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null
  }
  const value = (payload as Record<string, unknown>)[field]
  return typeof value === "string" ? value : null
}

function booleanField(payload: unknown, field: string): boolean | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null
  }
  const value = (payload as Record<string, unknown>)[field]
  return typeof value === "boolean" ? value : null
}

function legacyInputs(facts: readonly FrozenPlaybackFact[]) {
  let maxPositionSeconds = 0
  let maxProgress: number | null = null
  for (const fact of facts) {
    const position =
      numberField(fact.payload, "positionSeconds") ??
      (fact.kind === "playback_seek"
        ? numberField(fact.payload, "toSeconds")
        : null)
    if (position != null)
      maxPositionSeconds = Math.max(maxPositionSeconds, position)
    const progress = numberField(fact.payload, "progress")
    if (progress != null) maxProgress = Math.max(maxProgress ?? 0, progress)
  }
  return { maxPositionSeconds, maxProgress }
}

function activeProxyInput(facts: readonly FrozenPlaybackFact[]) {
  const activeFacts = facts.filter(
    (fact) => fact.kind === "playback_active_visible_playing",
  )
  const intervals = activeFacts.flatMap((fact) => {
    const activeMilliseconds = numberField(fact.payload, "activeMilliseconds")
    if (activeMilliseconds == null || activeMilliseconds <= 0) return []
    const endMilliseconds = fact.occurredAt.getTime()
    return [
      {
        startMilliseconds: endMilliseconds - activeMilliseconds,
        endMilliseconds,
      },
    ]
  })
  const durationSeconds = facts.reduce<number | null>((latest, fact) => {
    const value = numberField(fact.payload, "durationSeconds")
    return value != null && value > 0 ? value : latest
  }, null)
  const terminal = [...facts]
    .reverse()
    .find((fact) => isTerminalRecommendationFactKind(fact.kind))
  const coverage =
    activeFacts.length === 0
      ? ("missing" as const)
      : activeFacts.some(
            (fact) => stringField(fact.payload, "coverage") !== "complete",
          )
        ? ("partial" as const)
        : ("complete" as const)
  const activeIntervals = mergeActivePlaybackIntervals(intervals)
  return {
    activeMilliseconds: activeIntervals.reduce(
      (total, interval) =>
        total + interval.endMilliseconds - interval.startMilliseconds,
      0,
    ),
    activeIntervals,
    durationSeconds,
    completed:
      terminal?.kind === "playback_end" &&
      booleanField(terminal.payload, "completed") === true,
    coverage,
  }
}

function outcomeReasons(
  facts: readonly FrozenPlaybackFact[],
  finalizationReason: FinalizationInput["reason"],
  classifier: LegacyPositionOutcome | ActiveWatchProxyOutcome,
): string[] {
  const reasons = [...classifier.reasons]
  if (!facts.some((fact) => fact.kind === "playback_start")) {
    reasons.push("missing_playback_start")
  }
  const terminal = facts.find((fact) =>
    isTerminalRecommendationFactKind(fact.kind),
  )
  if (!terminal) {
    reasons.push("missing_terminal_fact")
    if (finalizationReason === "timeout") reasons.push("terminal_timeout")
  } else if (terminal.kind === "playback_error") {
    reasons.push("terminal_playback_error")
  }
  const activeFacts = facts.filter(
    (fact) => fact.kind === "playback_active_visible_playing",
  )
  if (activeFacts.length === 0) {
    reasons.push("active_visible_playing_coverage_missing")
  } else if (
    activeFacts.some(
      (fact) => stringField(fact.payload, "coverage") !== "complete",
    )
  ) {
    reasons.push("active_visible_playing_coverage_partial")
  }
  return [...new Set(reasons)]
}

export function rebuildPlaybackProjection(
  facts: readonly FrozenPlaybackFact[],
  finalizationReason: FinalizationInput["reason"],
) {
  const ordered = [...facts].sort(
    (left, right) => left.sequence - right.sequence,
  )
  const legacy = classifyLegacyPosition(legacyInputs(ordered))
  const activeInput = activeProxyInput(ordered)
  const active = classifyActiveWatchProxy(activeInput)
  return {
    factWatermark: ordered.at(-1)?.sequence ?? 0,
    legacy: {
      ...legacy,
      reasons: outcomeReasons(ordered, finalizationReason, legacy),
    },
    active: {
      ...active,
      activeIntervals: activeInput.activeIntervals,
      reasons: outcomeReasons(ordered, finalizationReason, active),
    },
  }
}

export class RecommendationOutcomeService {
  constructor(private readonly deps: OutcomeDependencies) {}

  digestFacts(facts: readonly FrozenPlaybackFact[]): string {
    return recommendationEvidenceDigest(
      [...facts]
        .sort((left, right) => left.sequence - right.sequence)
        .map((fact) => ({
          sequence: fact.sequence,
          eventId: fact.eventId,
          kind: fact.kind,
          payloadDigest: fact.payloadDigest,
          occurredAt: fact.occurredAt.toISOString(),
          late: fact.late,
        })),
    )
  }

  async finalize(input: FinalizationInput) {
    const now = this.deps.now?.() ?? new Date()
    const newId = this.deps.newId ?? randomUUID
    return withRecommendationSerializableRetry(() =>
      this.deps.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${input.episodeId}, 368))
        `
          const episode = await tx.recommendationPlaybackEpisode.findUnique({
            where: { id: input.episodeId },
            include: {
              request: true,
              facts: { orderBy: { sequence: "asc" } },
            },
          })
          if (!episode) {
            return {
              status: "fenced" as const,
              reason: "episode_missing" as const,
            }
          }
          if (
            episode.generation !== input.generation ||
            (episode.request != null &&
              episode.request.generation !== input.generation)
          ) {
            return {
              status: "fenced" as const,
              reason: "generation_changed" as const,
            }
          }
          if (episode.expiresAt <= now) {
            return {
              status: "fenced" as const,
              reason: "root_expired" as const,
            }
          }

          const facts = [...episode.facts].sort(
            (left, right) => left.sequence - right.sequence,
          ) as FrozenPlaybackFact[]
          const hasTerminal = facts.some((fact) =>
            isTerminalRecommendationFactKind(fact.kind),
          )
          if (
            !hasTerminal &&
            (input.reason === "fact-advanced" || input.reason === "recovery")
          ) {
            return { status: "fenced" as const, reason: "not_ready" as const }
          }
          if (
            !hasTerminal &&
            input.reason === "timeout" &&
            now < episode.activeUntil
          ) {
            return { status: "fenced" as const, reason: "not_ready" as const }
          }
          const projection = rebuildPlaybackProjection(facts, input.reason)
          const factWatermark = projection.factWatermark
          const inputDigest = this.digestFacts(facts)
          const classifiers = [
            {
              outcome: projection.legacy,
              derived: {
                activePlaybackMilliseconds: null,
                activeIntervals: null,
                durationSeconds: null,
                durationCohort: null,
                activeCoverage: null,
              },
            },
            {
              outcome: projection.active,
              derived: {
                activePlaybackMilliseconds:
                  projection.active.activeMilliseconds,
                activeIntervals: projection.active.activeIntervals,
                durationSeconds: projection.active.durationSeconds,
                durationCohort: projection.active.durationCohort,
                activeCoverage: projection.active.coverage,
              },
            },
          ] as const
          const exactOutcomes = await Promise.all(
            classifiers.map((classifier) =>
              tx.recommendationOutcomeRevision.findUnique({
                where: {
                  episodeId_classifierVersion_factWatermark_inputDigest: {
                    episodeId: episode.id,
                    classifierVersion: classifier.outcome.classifierVersion,
                    factWatermark,
                    inputDigest,
                  },
                },
              }),
            ),
          )
          const latestOutcomes = await Promise.all(
            classifiers.map((classifier, index) =>
              exactOutcomes[index]
                ? null
                : tx.recommendationOutcomeRevision.findFirst({
                    where: {
                      episodeId: episode.id,
                      classifierVersion: classifier.outcome.classifierVersion,
                    },
                    orderBy: { revision: "desc" },
                  }),
            ),
          )
          const prepared: Array<{
            outcome: LegacyPositionOutcome | ActiveWatchProxyOutcome
            derived: {
              activePlaybackMilliseconds: number | null
              activeIntervals: ReadonlyArray<{
                startMilliseconds: number
                endMilliseconds: number
              }> | null
              durationSeconds: number | null
              durationCohort: string | null
              activeCoverage: string | null
            }
            exact: {
              id: string
              revision: number
              factWatermark: number
              inputDigest: string
            } | null
            latest: {
              id: string
              revision: number
              factWatermark: number
              inputDigest: string
            } | null
          }> = []
          for (const [index, classifier] of classifiers.entries()) {
            const exact = exactOutcomes[index] ?? null
            const latest = latestOutcomes[index] ?? null
            if (latest && latest.factWatermark >= factWatermark) {
              if (latest.factWatermark === factWatermark) {
                throw new RecommendationConflictError(
                  "Recommendation outcome input digest conflicted",
                )
              }
              return {
                status: "fenced" as const,
                reason: "watermark_regressed" as const,
              }
            }
            prepared.push({ ...classifier, exact, latest })
          }

          const results: Array<{
            status: "existing" | "published"
            id: string
            revision: number
            factWatermark: number
            inputDigest: string
            classifierVersion: string
          }> = []
          for (const classifier of prepared) {
            if (classifier.exact) {
              results.push({
                status: "existing",
                ...classifier.exact,
                classifierVersion: classifier.outcome.classifierVersion,
              })
              continue
            }
            const revision = (classifier.latest?.revision ?? 0) + 1
            const published = await tx.recommendationOutcomeRevision.create({
              data: {
                id: newId(),
                requestId: episode.requestId,
                itemId: episode.itemId,
                episodeId: episode.id,
                classifierVersion: classifier.outcome.classifierVersion,
                factWatermark,
                inputDigest,
                revision,
                supersedesId: classifier.latest?.id ?? null,
                qualifiedView: classifier.outcome.qualifiedView,
                viewQualityWeight: classifier.outcome.viewQualityWeight,
                viewQualityWeightReason:
                  classifier.outcome.viewQualityWeightReason,
                ...classifier.derived,
                activeIntervals:
                  classifier.derived.activeIntervals == null
                    ? Prisma.DbNull
                    : (classifier.derived
                        .activeIntervals as Prisma.InputJsonValue),
                reasons: classifier.outcome.reasons,
                learningEligible: false,
                generation: episode.generation,
                createdAt: now,
                expiresAt: episode.expiresAt,
              },
            })
            results.push({
              status: "published",
              id: published.id,
              revision,
              factWatermark,
              inputDigest,
              classifierVersion: classifier.outcome.classifierVersion,
            })
          }
          if (hasTerminal || input.reason === "timeout") {
            const allClassifiersAlreadyPublished = prepared.every(
              (classifier) => classifier.exact != null,
            )
            const updated = await tx.recommendationPlaybackEpisode.updateMany({
              where: {
                id: episode.id,
                generation: episode.generation,
              },
              data: allClassifiersAlreadyPublished
                ? { finalizationDueAt: null }
                : {
                    state: hasTerminal
                      ? RecommendationEpisodeState.FINALIZED
                      : RecommendationEpisodeState.TIMED_OUT,
                    finalizedAt: now,
                    finalizationDueAt: null,
                  },
            })
            if (updated.count !== 1) {
              throw new RecommendationConflictError(
                "Recommendation outcome generation conflicted",
              )
            }
          }
          const primary =
            results.find(
              (result) =>
                result.classifierVersion === RECOMMENDATION_CONTRACTS.outcome,
            ) ?? results[0]!
          const activeResult = results.find(
            (result) => result.classifierVersion === ACTIVE_WATCH_PROXY_VERSION,
          )
          return {
            status: results.some((result) => result.status === "published")
              ? ("published" as const)
              : ("existing" as const),
            id: primary.id,
            revision: primary.revision,
            factWatermark: primary.factWatermark,
            inputDigest: primary.inputDigest,
            activeOutcomeId: activeResult?.id ?? null,
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    )
  }

  async rebuildProjection(input: { episodeId: string; generation: number }) {
    const episode =
      await this.deps.prisma.recommendationPlaybackEpisode.findUnique({
        where: { id: input.episodeId },
        include: {
          facts: { orderBy: { sequence: "asc" } },
          outcomes: { orderBy: { revision: "desc" } },
        },
      })
    if (!episode || episode.generation !== input.generation) {
      return { status: "fenced" as const }
    }
    const facts = episode.facts as FrozenPlaybackFact[]
    const reason = facts.some((fact) =>
      isTerminalRecommendationFactKind(fact.kind),
    )
      ? ("terminal-fact" as const)
      : ("timeout" as const)
    const rebuilt = rebuildPlaybackProjection(facts, reason)
    const inputDigest = this.digestFacts(facts)
    const latestLegacy = episode.outcomes.find(
      (outcome) =>
        outcome.classifierVersion === RECOMMENDATION_CONTRACTS.outcome,
    )
    const latestActive = episode.outcomes.find(
      (outcome) => outcome.classifierVersion === ACTIVE_WATCH_PROXY_VERSION,
    )
    const storedIntervals = Array.isArray(latestActive?.activeIntervals)
      ? latestActive.activeIntervals
      : []
    const intervalsMatch =
      rebuilt.active.activeIntervals.every((interval, index) => {
        const stored = storedIntervals[index]
        return (
          stored != null &&
          typeof stored === "object" &&
          !Array.isArray(stored) &&
          stored.startMilliseconds === interval.startMilliseconds &&
          stored.endMilliseconds === interval.endMilliseconds
        )
      }) && storedIntervals.length === rebuilt.active.activeIntervals.length
    const matches =
      latestLegacy?.factWatermark === rebuilt.factWatermark &&
      latestLegacy.inputDigest === inputDigest &&
      latestLegacy.qualifiedView === rebuilt.legacy.qualifiedView &&
      latestActive?.factWatermark === rebuilt.factWatermark &&
      latestActive.inputDigest === inputDigest &&
      latestActive.qualifiedView === rebuilt.active.qualifiedView &&
      latestActive.activePlaybackMilliseconds ===
        rebuilt.active.activeMilliseconds &&
      latestActive.durationSeconds === rebuilt.active.durationSeconds &&
      latestActive.durationCohort === rebuilt.active.durationCohort &&
      latestActive.activeCoverage === rebuilt.active.coverage &&
      intervalsMatch

    return {
      status: matches ? ("matched" as const) : ("drift" as const),
      factWatermark: rebuilt.factWatermark,
      inputDigest,
      activePlaybackMilliseconds: rebuilt.active.activeMilliseconds,
      activeIntervals: rebuilt.active.activeIntervals,
    }
  }
}

export function createRecommendationOutcomeService(
  prisma: PrismaClient = defaultPrisma,
) {
  return new RecommendationOutcomeService({ prisma })
}
