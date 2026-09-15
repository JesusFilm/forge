import type {
  RecommendationDetailQueryData,
  RecommendationEpisodeDetail,
  RecommendationRequestDetailData,
} from "./detail.types"

export function mapRecommendationRequestDetail(
  data: RecommendationDetailQueryData,
): RecommendationRequestDetailData {
  const lifecycleEvents = markOccurrenceOrder(
    data.items
      .flatMap((item) => [
        ...(item.renderedId &&
        item.renderedOccurredAt &&
        item.renderedReceivedAt
          ? [
              {
                id: item.renderedId,
                itemId: item.id,
                kind: "rendered" as const,
                receivedAt: item.renderedReceivedAt,
                occurredAt: item.renderedOccurredAt,
              },
            ]
          : []),
        ...(item.impressionId &&
        item.impressionOccurredAt &&
        item.impressionReceivedAt
          ? [
              {
                id: item.impressionId,
                itemId: item.id,
                kind: "impression" as const,
                receivedAt: item.impressionReceivedAt,
                occurredAt: item.impressionOccurredAt,
              },
            ]
          : []),
        ...(item.selectionId &&
        item.selectionOccurredAt &&
        item.selectionReceivedAt
          ? [
              {
                id: item.selectionId,
                itemId: item.id,
                kind: "selection" as const,
                receivedAt: item.selectionReceivedAt,
                occurredAt: item.selectionOccurredAt,
              },
            ]
          : []),
      ])
      .sort(compareReceived),
  )

  const factsByEpisode = groupBy(data.facts, (fact) => fact.episodeId)
  const outcomesByEpisode = groupBy(
    data.outcomes,
    (outcome) => outcome.episodeId,
  )
  const shadowNominationsByRun = groupBy(
    data.shadowNominations,
    (nomination) => nomination.runId,
  )
  const candidateStages = data.candidateStages.map((stage) => ({
    ...stage,
    contributors: (stage.contributors ?? []).slice(0, 16),
  }))
  const orderedPositionByTarget = new Map(
    candidateStages
      .filter(
        (stage) =>
          stage.stage === "ordered" &&
          stage.targetMediaId != null &&
          stage.finalPosition != null,
      )
      .map((stage) => [stage.targetMediaId as string, stage.finalPosition]),
  )
  const compositionByTarget = new Map(
    candidateStages
      .filter(
        (stage) =>
          stage.stage === "composed" &&
          stage.targetMediaId != null &&
          stage.finalPosition != null,
      )
      .map((stage) => [stage.targetMediaId as string, stage]),
  )
  const root = data.root
  return {
    id: root.id,
    contractVersion: root.contractVersion,
    surfaceVersion: root.surfaceVersion,
    strategyVersion: root.strategyVersion,
    classifierVersion: root.classifierVersion,
    seedMediaId: root.seedMediaId,
    locale: root.locale,
    expectedItemCount: root.expectedItemCount,
    state: root.state.toLowerCase() as RecommendationRequestDetailData["state"],
    result:
      root.result.toLowerCase() as RecommendationRequestDetailData["result"],
    fallbackReason: root.fallbackReason,
    retrievalLatencyMs: root.retrievalLatencyMs,
    responseBytes: root.responseBytes,
    createdAt: root.createdAt,
    issuedAt: root.issuedAt,
    manifest: {
      id: root.manifestId,
      strategyVersion: root.manifestStrategyVersion,
      contractVersion: root.manifestContractVersion,
      surfaceVersion: root.manifestSurfaceVersion,
      generator: root.manifestGenerator,
      maxItems: root.manifestMaxItems,
    },
    controlReadiness: data.controlReadiness
      ? {
          revision: data.controlReadiness.revision,
          state:
            data.controlReadiness.state === "not_ready"
              ? "not-ready"
              : data.controlReadiness.state === "data_unhealthy"
                ? "data-unhealthy"
                : data.controlReadiness.state,
          policyVersion: data.controlReadiness.policyVersion,
          windowStart: data.controlReadiness.windowStart,
          windowEnd: data.controlReadiness.windowEnd,
          evaluatedAt: data.controlReadiness.evaluatedAt,
          explanation: data.controlReadiness.explanation,
        }
      : null,
    experiment:
      root.assignmentId || root.experimentBypassReason
        ? {
            bypassReason: root.experimentBypassReason,
            assignment:
              root.assignmentId &&
              root.assignmentExperimentId &&
              root.experimentVersion &&
              root.assignmentArm &&
              root.assignmentProbability != null &&
              root.assignmentConfigurationDigest &&
              root.assignmentGeneration != null &&
              root.effectiveManifestId
                ? {
                    id: root.assignmentId,
                    experimentId: root.assignmentExperimentId,
                    experimentVersion: root.experimentVersion,
                    arm: root.assignmentArm,
                    assignmentProbability: root.assignmentProbability,
                    configurationFingerprint:
                      root.assignmentConfigurationDigest.slice(0, 12),
                    generation: root.assignmentGeneration,
                    effectiveManifestId: root.effectiveManifestId,
                    actualExposureCount: safeCount(root.actualExposureCount),
                  }
                : null,
            evaluation: data.experimentEvaluation
              ? {
                  revision: data.experimentEvaluation.revision,
                  state:
                    data.experimentEvaluation.state === "DATA_UNHEALTHY"
                      ? "data-unhealthy"
                      : (data.experimentEvaluation.state.toLowerCase() as
                          | "pass"
                          | "fail"
                          | "inconclusive"),
                  inputFingerprint: data.experimentEvaluation.inputDigest.slice(
                    0,
                    12,
                  ),
                  evaluatedAt: data.experimentEvaluation.evaluatedAt,
                }
              : null,
          }
        : null,
    personalization: data.personalization
      ? {
          lane: data.personalization.lane,
          executionMode: data.personalization.executionMode ?? null,
          effectiveManifestId: data.personalization.effectiveManifestId,
          reasonCode: data.personalization.reasonCode,
          projectionScope: data.personalization.projectionScope,
          projectionVersion: data.personalization.projectionVersion,
          projectionGeneration: data.personalization.projectionGeneration,
          interestCount: data.personalization.interestCount,
          sessionIntentPresent: data.personalization.sessionIntentPresent,
          retrievalLatencyMs: data.personalization.retrievalLatencyMs,
          feedbackSourceRequestIds:
            data.personalization.feedbackSourceRequestIds.slice(0, 16),
        }
      : null,
    candidateExecution: data.candidateRun
      ? {
          purpose: data.candidateRun.purpose,
          requestedCount: data.candidateRun.requestedCount,
          composedCount: data.candidateRun.composedCount,
          shortfallReason: data.candidateRun.shortfallReason,
          versions: {
            context: data.candidateRun.contextVersion,
            generator: data.candidateRun.generatorVersion,
            union: data.candidateRun.unionVersion,
            eligibility: data.candidateRun.eligibilityVersion,
            ranker: data.candidateRun.rankerVersion,
            composer: data.candidateRun.composerVersion,
          },
          parity: {
            candidateEligibility: data.candidateRun.candidateEligibilityParity,
            ranker: data.candidateRun.rankerParity,
          },
          counts: {
            nominated: data.candidateRun.nominatedCount,
            canonicalized: data.candidateRun.canonicalizedCount,
            deduplicated: data.candidateRun.deduplicatedCount,
            rejected: data.candidateRun.rejectedCount,
            scored: data.candidateRun.scoredCount,
            ordered: data.candidateRun.orderedCount,
            composed: data.candidateRun.composedCount,
          },
          evidenceComplete: data.candidateRun.evidenceComplete,
          fallbackReason: data.candidateRun.fallbackReason,
          stages: candidateStages,
          suppressions: candidateStages
            .filter(
              (stage) =>
                stage.stage === "rejected" && stage.targetMediaId != null,
            )
            .map((stage) => ({
              targetMediaId: stage.targetMediaId as string,
              orderedPosition:
                orderedPositionByTarget.get(stage.targetMediaId as string) ??
                null,
              reasonCodes: stage.reasonCodes,
              contributors: stage.contributors,
            })),
        }
      : null,
    shadowComparisons: data.shadowRuns.map((run) => ({
      evaluationId: run.evaluationId,
      runId: run.runId,
      generatorVersion: run.generatorVersion,
      evaluationState: run.evaluationState,
      runState: run.runState,
      sampleOrdinal: run.sampleOrdinal,
      versions: {
        sampling: run.samplingVersion,
        context: run.contextVersion,
        eligibility: run.eligibilityVersion,
        retention: run.retentionPolicyVersion,
      },
      usedProfileProjection: run.usedProfileProjection,
      privacyGeneration: run.privacyGeneration,
      liveSlateUnchanged: run.liveSlateUnchanged,
      counts: {
        nominated: run.nominatedCount,
        eligible: run.eligibleCount,
        rejected: run.rejectedCount,
      },
      metrics: {
        coverage: run.coverage,
        overlap: run.overlap,
        novelty: run.novelty,
        diversity: run.diversity,
        rejection: run.rejection,
        latencyMs: run.latencyMs,
        cohortQuality: run.cohortQuality,
        inputFreshnessMs: run.inputFreshnessMs,
      },
      inputCapturedAt: run.inputCapturedAt,
      finishedAt: run.finishedAt,
      decision:
        run.decision &&
        run.decisionReasonCode &&
        run.reevaluationCondition &&
        run.decidedAt
          ? {
              state: run.decision,
              reasonCode: run.decisionReasonCode,
              reevaluationCondition: run.reevaluationCondition,
              decidedAt: run.decidedAt,
            }
          : null,
      nominations: shadowNominationsByRun.get(run.runId) ?? [],
    })),
    items: data.items.map((item) => {
      const composed = compositionByTarget.get(item.targetMediaId)
      const orderedPosition =
        orderedPositionByTarget.get(item.targetMediaId) ?? null
      const finalPosition = composed?.finalPosition ?? item.position
      return {
        id: item.id,
        position: item.position,
        targetMediaId: item.targetMediaId,
        canonicalHref: item.canonicalHref,
        candidateGenerator: item.candidateGenerator,
        provenance: compact({
          sceneIndex: item.sceneIndex ?? undefined,
          similarity: item.similarity ?? undefined,
        }),
        presentation: compact({
          videoTitle: item.videoTitle ?? undefined,
          audioLanguageSlug: item.audioLanguageSlug ?? undefined,
          startSeconds: item.startSeconds ?? undefined,
          endSeconds: item.endSeconds ?? undefined,
        }),
        renderedAt: item.renderedReceivedAt,
        impressionAt: item.impressionReceivedAt,
        selectedAt: item.selectionReceivedAt,
        visibilityPolicy: item.impressionVisibilityPolicy,
        explanation:
          item.selectionId && !item.impressionId
            ? "Selection arrived without an eligible impression."
            : item.renderedId && !item.impressionId
              ? "Rendered, but no eligible impression was recorded."
              : null,
        composition: composed
          ? {
              orderedPosition,
              finalPosition,
              movement:
                orderedPosition == null
                  ? null
                  : finalPosition - orderedPosition,
              refill: composed.reasonCodes.includes("refill_after_suppression"),
              reasonCodes: composed.reasonCodes,
              contributors: composed.contributors,
            }
          : null,
      }
    }),
    lifecycleEvents,
    episodes: data.episodes.map((episode) => {
      const orderedFacts = [...(factsByEpisode.get(episode.id) ?? [])].sort(
        (left, right) =>
          left.sequence - right.sequence || left.id.localeCompare(right.id),
      )
      return {
        id: episode.id,
        itemId: episode.itemId,
        state:
          episode.state.toLowerCase() as RecommendationEpisodeDetail["state"],
        mediaId: episode.mediaId,
        createdAt: episode.createdAt,
        claimedAt: episode.claimedAt,
        finalizedAt: episode.finalizedAt,
        activeUntil: episode.activeUntil,
        facts: markOccurrenceOrder(orderedFacts).map((fact) => ({
          id: fact.id,
          sequence: fact.sequence,
          kind: fact.kind,
          occurredAt: fact.occurredAt,
          receivedAt: fact.receivedAt,
          late: fact.late,
          occurredOutOfOrder: fact.occurredOutOfOrder,
          metrics: compact({
            initiation: fact.initiation ?? undefined,
            positionSeconds: fact.positionSeconds ?? undefined,
            fromSeconds: fact.fromSeconds ?? undefined,
            toSeconds: fact.toSeconds ?? undefined,
            durationSeconds: fact.durationSeconds ?? undefined,
            progress: fact.progress ?? undefined,
            wallElapsedMilliseconds: fact.wallElapsedMilliseconds ?? undefined,
            activeMilliseconds: fact.activeMilliseconds ?? undefined,
            coverage: fact.coverage ?? undefined,
            missingReason: fact.missingReason ?? undefined,
            completed: fact.completed ?? undefined,
            reason: fact.reason ?? undefined,
            code: fact.code ?? undefined,
          }),
        })),
        outcomes: (outcomesByEpisode.get(episode.id) ?? []).map((outcome) => ({
          id: outcome.id,
          classifierVersion: outcome.classifierVersion,
          factWatermark: outcome.factWatermark,
          revision: outcome.revision,
          supersedesRevision: outcome.supersedesRevision,
          qualifiedView: outcome.qualifiedView,
          viewQualityWeight: outcome.viewQualityWeight,
          viewQualityWeightReason: outcome.viewQualityWeightReason,
          activePlaybackMilliseconds: outcome.activePlaybackMilliseconds,
          durationSeconds: outcome.durationSeconds,
          durationCohort: outcome.durationCohort,
          activeCoverage: outcome.activeCoverage,
          reasons: outcome.reasons,
          learningEligible: outcome.learningEligible,
          eligibilityState: outcome.eligibilityState,
          eligibilityPolicyVersion: outcome.eligibilityPolicyVersion,
          eligibilityRevision: outcome.eligibilityRevision,
          eligibilityReasonCodes: outcome.eligibilityReasonCodes,
          eligibleScopes: outcome.eligibleScopes,
          contributionWeight: outcome.contributionWeight,
          createdAt: outcome.createdAt,
        })),
      }
    }),
    contentActions: data.contentActions,
    audits: data.audits.map((audit) => ({
      id: audit.id,
      kind: audit.kind.toLowerCase(),
      reasonCode: audit.reasonCode,
      count: audit.count,
      occurredAt: audit.occurredAt,
    })),
    conflicts: data.conflicts,
  }
}

function safeCount(value: bigint | number): number {
  const count = Number(value)
  return Number.isSafeInteger(count) && count >= 0 ? count : 0
}

function groupBy<T, K>(rows: T[], keyFor: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const row of rows) {
    const key = keyFor(row)
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }
  return groups
}

function markOccurrenceOrder<
  T extends { id: string; occurredAt: Date; receivedAt: Date },
>(rows: T[]): Array<T & { occurredOutOfOrder: boolean }> {
  const occurredOrder = [...rows].sort(
    (left, right) =>
      left.occurredAt.getTime() - right.occurredAt.getTime() ||
      left.id.localeCompare(right.id),
  )
  const occurredRank = new Map(
    occurredOrder.map((row, index) => [row.id, index] as const),
  )
  return rows.map((row, index) => ({
    ...row,
    occurredOutOfOrder: occurredRank.get(row.id) !== index,
  }))
}

function compareReceived(
  left: { id: string; receivedAt: Date },
  right: { id: string; receivedAt: Date },
) {
  return (
    left.receivedAt.getTime() - right.receivedAt.getTime() ||
    left.id.localeCompare(right.id)
  )
}
type Compact<T extends Record<string, unknown>> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K]
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<
    T[K],
    undefined
  >
}

function compact<T extends Record<string, unknown>>(value: T): Compact<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Compact<T>
}
