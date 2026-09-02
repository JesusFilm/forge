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
  unionActivePlaybackIntervals,
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

type FrozenFact = {
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

function legacyInputs(facts: readonly FrozenFact[]) {
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

function activeProxyInput(facts: readonly FrozenFact[]) {
  const activeFacts = facts.filter(
    (fact) => fact.kind === "playback_active_visible_playing",
  )
  const intervals = activeFacts.flatMap((fact) => {
    const startedAt = stringField(fact.payload, "startedAt")
    const endedAt = stringField(fact.payload, "endedAt")
    if (startedAt && endedAt) {
      const startMilliseconds = new Date(startedAt).getTime()
      const endMilliseconds = new Date(endedAt).getTime()
      if (
        Number.isFinite(startMilliseconds) &&
        Number.isFinite(endMilliseconds) &&
        endMilliseconds > startMilliseconds &&
        endMilliseconds - startMilliseconds <= 60_000
      ) {
        return [{ startMilliseconds, endMilliseconds }]
      }
    }
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
  return {
    activeMilliseconds: unionActivePlaybackIntervals(intervals),
    durationSeconds,
    completed:
      terminal?.kind === "playback_end" &&
      booleanField(terminal.payload, "completed") === true,
    coverage,
  }
}

function outcomeReasons(
  facts: readonly FrozenFact[],
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

export class RecommendationOutcomeService {
  constructor(private readonly deps: OutcomeDependencies) {}

  digestFacts(facts: readonly FrozenFact[]): string {
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
              context: true,
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
              episode.request.generation !== input.generation) ||
            episode.context.generation !== input.generation
          ) {
            return {
              status: "fenced" as const,
              reason: "generation_changed" as const,
            }
          }
          if (episode.context.expiresAt <= now) {
            return {
              status: "fenced" as const,
              reason: "root_expired" as const,
            }
          }

          const facts = [...episode.facts].sort(
            (left, right) => left.sequence - right.sequence,
          ) as FrozenFact[]
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
          const factWatermark = facts.at(-1)?.sequence ?? 0
          const inputDigest = this.digestFacts(facts)
          const legacy = classifyLegacyPosition(legacyInputs(facts))
          const active = classifyActiveWatchProxy(activeProxyInput(facts))
          const classifiers = [
            {
              outcome: legacy,
              derived: {
                activePlaybackMilliseconds: null,
                durationSeconds: null,
                durationCohort: null,
                activeCoverage: null,
              },
            },
            {
              outcome: active,
              derived: {
                activePlaybackMilliseconds: active.activeMilliseconds,
                durationSeconds: active.durationSeconds,
                durationCohort: active.durationCohort,
                activeCoverage: active.coverage,
              },
            },
          ] as const
          const prepared: Array<{
            outcome: LegacyPositionOutcome | ActiveWatchProxyOutcome
            derived: {
              activePlaybackMilliseconds: number | null
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
          for (const classifier of classifiers) {
            const exact = await tx.recommendationOutcomeRevision.findUnique({
              where: {
                episodeId_classifierVersion_factWatermark_inputDigest: {
                  episodeId: episode.id,
                  classifierVersion: classifier.outcome.classifierVersion,
                  factWatermark,
                  inputDigest,
                },
              },
            })
            const latest = exact
              ? null
              : await tx.recommendationOutcomeRevision.findFirst({
                  where: {
                    episodeId: episode.id,
                    classifierVersion: classifier.outcome.classifierVersion,
                  },
                  orderBy: { revision: "desc" },
                })
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
                reasons: outcomeReasons(
                  facts,
                  input.reason,
                  classifier.outcome,
                ),
                learningEligible: false,
                generation: episode.generation,
                createdAt: now,
                expiresAt: episode.context.expiresAt,
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
        // The episode advisory lock is the serialization boundary. READ
        // COMMITTED lets a waiter take a fresh snapshot after it acquires the
        // lock; SERIALIZABLE would retain its pre-wait snapshot and can attempt
        // to publish the same frozen input twice.
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      ),
    )
  }
}

export function createRecommendationOutcomeService(
  prisma: PrismaClient = defaultPrisma,
) {
  return new RecommendationOutcomeService({ prisma })
}
