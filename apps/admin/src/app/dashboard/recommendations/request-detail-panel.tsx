import { PageSection, StatusPill } from "@/components/admin-ui"
import type { RecommendationRequestDetailData } from "@/services/recommendations/admin-ops"
import {
  displayRecommendationToken,
  formatRecommendationDateTime,
} from "./recommendation-display"
import {
  FinalSlatePanel,
  RecommendationCandidateEvidence,
} from "./request-detail-candidate-evidence"

export function RecommendationRequestDetailPanel({
  detail,
}: {
  detail: RecommendationRequestDetailData
}) {
  return (
    <div className="grid gap-6">
      <section
        aria-labelledby="request-summary-heading"
        className="app-card p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="request-summary-heading" className="text-lg font-medium">
              Delivery summary
            </h2>
            <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
              {deliverySummary(detail)}
            </p>
          </div>
          <StatusPill
            tone={
              detail.state === "issuance_failed"
                ? "danger"
                : detail.state === "issued"
                  ? "success"
                  : "warning"
            }
          >
            {displayRecommendationToken(detail.state)}
          </StatusPill>
        </div>
        <dl className="mt-4 grid gap-px overflow-hidden rounded-sm bg-[var(--color-hairline)] sm:grid-cols-2 lg:grid-cols-4">
          <Definition
            label="Result"
            value={displayRecommendationToken(detail.result)}
          />
          <Definition
            label="Fallback"
            value={displayRecommendationToken(detail.fallbackReason)}
          />
          <Definition
            label="Serving mode"
            value={displayRecommendationToken(
              detail.personalization?.executionMode,
            )}
          />
          <Definition
            label="Requested / composed"
            value={
              detail.candidateExecution
                ? `${detail.candidateExecution.requestedCount} / ${detail.candidateExecution.composedCount}`
                : `${detail.expectedItemCount} / ${detail.items.length}`
            }
          />
          <Definition
            label="Shortfall"
            value={displayRecommendationToken(
              detail.candidateExecution?.shortfallReason,
            )}
          />
          <Definition
            label="Retrieval"
            value={
              detail.retrievalLatencyMs == null
                ? "None"
                : `${detail.retrievalLatencyMs} ms`
            }
          />
          <Definition
            label="Response"
            value={
              detail.responseBytes == null
                ? "None"
                : `${detail.responseBytes.toLocaleString("en-US")} bytes`
            }
          />
          <Definition label="Contract" value={detail.contractVersion} />
          <Definition label="Surface policy" value={detail.surfaceVersion} />
          <Definition label="Strategy" value={detail.strategyVersion} />
          <Definition label="Classifier" value={detail.classifierVersion} />
        </dl>
        <p className="mt-4 text-[12px] text-[var(--color-text-muted)]">
          Effective manifest: {detail.manifest.id} · {detail.manifest.generator}{" "}
          · up to {detail.manifest.maxItems} items
        </p>
      </section>

      <FinalSlatePanel detail={detail} />

      {detail.experiment ? (
        <PageSection
          title="Experiment attribution"
          meta="SIGNED ASSIGNMENT / ACTUAL EXPOSURE / EVALUATION"
        >
          {detail.experiment.assignment ? (
            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone="success">
                    {displayRecommendationToken(
                      detail.experiment.assignment.arm,
                    )}
                  </StatusPill>
                  <StatusPill
                    tone={
                      detail.experiment.assignment.actualExposureCount > 0
                        ? "success"
                        : "warning"
                    }
                  >
                    {detail.experiment.assignment.actualExposureCount} actual{" "}
                    exposure
                  </StatusPill>
                  {detail.experiment.evaluation ? (
                    <StatusPill
                      tone={
                        detail.experiment.evaluation.state === "pass"
                          ? "success"
                          : detail.experiment.evaluation.state ===
                              "inconclusive"
                            ? "warning"
                            : "danger"
                      }
                    >
                      Evaluation {detail.experiment.evaluation.state}
                    </StatusPill>
                  ) : null}
                </div>
                <p className="mt-3 text-[13px] text-[var(--color-text-secondary)]">
                  {detail.experiment.assignment.experimentVersion} · probability{" "}
                  {(
                    detail.experiment.assignment.assignmentProbability * 100
                  ).toFixed(1)}
                  % · manifest{" "}
                  {detail.experiment.assignment.effectiveManifestId}
                </p>
                <p className="mt-1 break-all font-mono text-[10px] text-[var(--color-text-muted)]">
                  Assignment {detail.experiment.assignment.id} · generation{" "}
                  {detail.experiment.assignment.generation} · config{" "}
                  {detail.experiment.assignment.configurationFingerprint}
                </p>
              </div>
              {detail.experiment.evaluation ? (
                <div className="text-right text-[11px] text-[var(--color-text-muted)]">
                  <div>
                    Evaluation revision {detail.experiment.evaluation.revision}
                  </div>
                  <div className="mt-1">
                    {formatRecommendationDateTime(
                      detail.experiment.evaluation.evaluatedAt,
                    )}
                  </div>
                  <div className="mt-1 font-mono text-[10px]">
                    Input {detail.experiment.evaluation.inputFingerprint}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  Evaluation pending
                </p>
              )}
            </div>
          ) : (
            <p className="px-4 py-5 text-[13px] text-[var(--color-text-muted)]">
              Semantic control bypass:{" "}
              {displayRecommendationToken(detail.experiment.bypassReason)}.
            </p>
          )}
        </PageSection>
      ) : null}

      {detail.personalization ? (
        <PageSection
          title="Personalization decision"
          meta="ACTUAL LANE / PUBLISHED PROJECTION / FEEDBACK ANCESTRY"
        >
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <div>
              <div className="flex flex-wrap gap-2">
                <StatusPill
                  tone={
                    detail.personalization.lane === "profile_challenger"
                      ? "success"
                      : detail.personalization.lane === "semantic_fallback"
                        ? "warning"
                        : "muted"
                  }
                >
                  {displayRecommendationToken(detail.personalization.lane)}
                </StatusPill>
                {detail.personalization.projectionScope ? (
                  <StatusPill tone="muted">
                    {detail.personalization.projectionScope} profile
                  </StatusPill>
                ) : null}
              </div>
              <p className="mt-3 break-all text-[13px] text-[var(--color-text-secondary)]">
                {detail.personalization.effectiveManifestId}
              </p>
              <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                {detail.personalization.projectionVersion ?? "No projection"}
                {detail.personalization.projectionGeneration == null
                  ? ""
                  : ` · generation ${detail.personalization.projectionGeneration}`}
                {` · ${detail.personalization.interestCount} interests`}
                {detail.personalization.sessionIntentPresent
                  ? " · session intent"
                  : ""}
              </p>
              {detail.personalization.reasonCode ? (
                <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
                  Fallback:{" "}
                  {displayRecommendationToken(
                    detail.personalization.reasonCode,
                  )}
                </p>
              ) : null}
            </div>
            <div>
              <h3 className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                Qualified feedback sources
              </h3>
              {detail.personalization.feedbackSourceRequestIds.length > 0 ? (
                <ul className="mt-2 space-y-1 font-mono text-[10px] text-[var(--color-text-secondary)]">
                  {detail.personalization.feedbackSourceRequestIds.map(
                    (requestId) => (
                      <li key={requestId}>{requestId}</li>
                    ),
                  )}
                </ul>
              ) : (
                <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
                  No qualified prior request contributed to this projection.
                </p>
              )}
            </div>
          </div>
        </PageSection>
      ) : null}

      {detail.controlReadiness ? (
        <PageSection
          title={`Control readiness revision ${detail.controlReadiness.revision}`}
          meta="PINNED WINDOW / AGGREGATE DECISION"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="max-w-4xl">
              <p className="text-[13px] text-[var(--color-text-secondary)]">
                This request belongs to the pinned input window for the latest
                retained evaluation of its exact semantic manifest.
              </p>
              <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
                {detail.controlReadiness.explanation}
              </p>
              <p className="mt-2 font-mono text-[10px] text-[var(--color-text-muted)] uppercase">
                {formatRecommendationDateTime(
                  detail.controlReadiness.windowStart,
                )}{" "}
                →{" "}
                {formatRecommendationDateTime(
                  detail.controlReadiness.windowEnd,
                )}
                {" · "}
                {detail.controlReadiness.policyVersion}
              </p>
            </div>
            <StatusPill
              tone={
                detail.controlReadiness.state === "ready"
                  ? "success"
                  : detail.controlReadiness.state === "inconclusive"
                    ? "warning"
                    : "danger"
              }
            >
              {displayRecommendationToken(detail.controlReadiness.state)}
            </StatusPill>
          </div>
        </PageSection>
      ) : null}

      <RecommendationCandidateEvidence detail={detail} />
      <PageSection
        title="Lifecycle timeline"
        meta="RECEIVED TIME PRIMARY / OCCURRED TIME SECONDARY"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-y border-[var(--color-hairline)] text-[var(--color-text-muted)]">
                <th scope="col" className="px-4 py-2 font-medium">
                  Fact
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Item
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Received
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Occurred
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.lifecycleEvents.map((event) => (
                <tr
                  key={event.id}
                  className="border-b border-[var(--color-hairline)]"
                >
                  <td className="px-4 py-3">
                    <span>{displayRecommendationToken(event.kind)}</span>
                    {event.occurredOutOfOrder ? (
                      <span className="ml-2">
                        <StatusPill tone="warning">
                          Occurrence order differs
                        </StatusPill>
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px]">
                    {event.itemId}
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px]">
                    {formatRecommendationDateTime(event.receivedAt)}
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px]">
                    {formatRecommendationDateTime(event.occurredAt)}
                  </td>
                </tr>
              ))}
              {detail.lifecycleEvents.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-[var(--color-text-muted)]"
                  >
                    No browser lifecycle facts received.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </PageSection>

      <PageSection
        title="Mission-value actions"
        meta="SEPARATE OUTCOMES / NULLABLE ATTRIBUTION"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-y border-[var(--color-hairline)] text-[var(--color-text-muted)]">
                <th scope="col" className="px-4 py-2 font-medium">
                  Action
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Attribution
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Evidence state
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Received / occurred
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.contentActions.map((action) => (
                <tr
                  key={action.id}
                  className="border-b border-[var(--color-hairline)] align-top"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {displayRecommendationToken(action.actionKind)}
                    </div>
                    <div className="mt-1 text-[var(--color-text-muted)]">
                      {displayRecommendationToken(action.actionDetail)} ·{" "}
                      {displayRecommendationToken(action.purpose)}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                      {action.actionClass} · {action.actorClass}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {action.itemId && action.episodeId ? (
                      <>
                        <StatusPill tone="success">Linked</StatusPill>
                        <div className="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">
                          item {action.itemId} · episode {action.episodeId}
                        </div>
                        <div className="mt-1 text-[var(--color-text-muted)]">
                          {action.candidateGenerator ?? "Unknown generator"}
                        </div>
                      </>
                    ) : (
                      <StatusPill tone="muted">Unmatched</StatusPill>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <StatusPill tone={action.late ? "warning" : "success"}>
                        {action.late ? "Late" : "On time"}
                      </StatusPill>
                      <StatusPill
                        tone={eligibilityTone(action.eligibilityState)}
                      >
                        {displayRecommendationToken(action.eligibilityState)}
                      </StatusPill>
                    </div>
                    <div className="mt-2 text-[var(--color-text-muted)]">
                      destination {action.destinationState} · replays{" "}
                      {action.replayCount} · conflicts {action.conflictCount}
                    </div>
                    <div className="mt-1 text-[var(--color-text-muted)]">
                      {action.eligibilityPolicyVersion ?? "No policy decision"}
                      {action.eligibilityRevision == null
                        ? ""
                        : ` · revision ${action.eligibilityRevision}`}{" "}
                      · scopes {action.eligibleScopes.join(", ") || "none"}
                    </div>
                    {action.eligibilityReasonCodes.length > 0 ? (
                      <div className="mt-1 text-[var(--color-warning)]">
                        {action.eligibilityReasonCodes
                          .map(displayRecommendationToken)
                          .join(" · ")}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px]">
                    <div>{formatRecommendationDateTime(action.receivedAt)}</div>
                    <div className="mt-1 text-[var(--color-text-muted)]">
                      Occurred {formatRecommendationDateTime(action.occurredAt)}
                    </div>
                  </td>
                </tr>
              ))}
              {detail.contentActions.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-[var(--color-text-muted)]"
                  >
                    No linked mission-value actions for this request.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </PageSection>

      <section aria-labelledby="episode-heading" className="grid gap-4">
        <div>
          <h2 id="episode-heading" className="text-lg font-medium">
            Playback episodes and immutable outcomes
          </h2>
          <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
            Server-assigned episode sequence is primary. Client occurrence time
            remains secondary evidence.
          </p>
        </div>
        {detail.episodes.map((episode) => (
          <article key={episode.id} className="app-card overflow-hidden">
            <header className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div>
                <h3 className="break-all font-mono text-[13px]">
                  {episode.id}
                </h3>
                <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                  item {episode.itemId} · media {episode.mediaId} · created{" "}
                  {formatRecommendationDateTime(episode.createdAt)}
                </p>
                <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                  Claimed {formatRecommendationDateTime(episode.claimedAt)} ·
                  active until{" "}
                  {formatRecommendationDateTime(episode.activeUntil)} ·
                  finalized {formatRecommendationDateTime(episode.finalizedAt)}
                </p>
              </div>
              <StatusPill
                tone={
                  episode.state === "finalized"
                    ? "success"
                    : episode.state === "timed_out"
                      ? "danger"
                      : "warning"
                }
              >
                {displayRecommendationToken(episode.state)}
              </StatusPill>
            </header>
            <div className="overflow-x-auto border-t border-[var(--color-hairline)]">
              <table className="w-full min-w-[850px] border-collapse text-left text-[12px]">
                <thead>
                  <tr className="border-b border-[var(--color-hairline)] text-[var(--color-text-muted)]">
                    <th scope="col" className="px-4 py-2 font-medium">
                      Sequence
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Fact
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Received / occurred
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Safe metrics
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {episode.facts.map((fact) => (
                    <tr
                      key={fact.id}
                      className="border-b border-[var(--color-hairline)] align-top"
                    >
                      <td className="px-4 py-3 font-mono">{fact.sequence}</td>
                      <td className="px-4 py-3">
                        {displayRecommendationToken(fact.kind)}
                        {fact.late ? (
                          <span className="ml-2">
                            <StatusPill tone="warning">Late</StatusPill>
                          </span>
                        ) : null}
                        {fact.occurredOutOfOrder ? (
                          <span className="ml-2">
                            <StatusPill tone="warning">
                              Occurrence order differs
                            </StatusPill>
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-[10px]">
                        <div>
                          {formatRecommendationDateTime(fact.receivedAt)}
                        </div>
                        <div className="mt-1 text-[var(--color-text-muted)]">
                          Occurred{" "}
                          {formatRecommendationDateTime(fact.occurredAt)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">
                        {formatMetrics(fact.metrics)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 border-t border-[var(--color-hairline)] p-4">
              {episode.outcomes.map((outcome) => (
                <div
                  key={outcome.id}
                  className="rounded-sm border border-[var(--color-hairline)] p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">
                      Revision {outcome.revision} · {outcome.classifierVersion}
                    </div>
                    <StatusPill
                      tone={eligibilityTone(outcome.eligibilityState)}
                    >
                      {displayRecommendationToken(outcome.eligibilityState)}
                    </StatusPill>
                  </div>
                  <p className="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">
                    Created {formatRecommendationDateTime(outcome.createdAt)} ·
                    supersedes revision {outcome.supersedesRevision ?? "none"}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                    {outcome.eligibilityPolicyVersion ?? "No policy decision"}
                    {outcome.eligibilityRevision == null
                      ? ""
                      : ` · decision ${outcome.eligibilityRevision}`}{" "}
                    · scopes {outcome.eligibleScopes.join(", ") || "none"} ·
                    weight {outcome.contributionWeight ?? "none"}
                  </p>
                  <dl className="mt-3 grid gap-2 text-[12px] sm:grid-cols-3">
                    <div>
                      <dt className="label-text">Qualified view</dt>
                      <dd className="mt-1">
                        {outcome.qualifiedView ? "Yes" : "No"}
                      </dd>
                    </div>
                    <div>
                      <dt className="label-text">Fact watermark</dt>
                      <dd className="mt-1">{outcome.factWatermark}</dd>
                    </div>
                    <div>
                      <dt className="label-text">View quality weight</dt>
                      <dd className="mt-1">
                        {outcome.viewQualityWeight ??
                          displayRecommendationToken(
                            outcome.viewQualityWeightReason,
                          )}
                      </dd>
                    </div>
                  </dl>
                  {outcome.activePlaybackMilliseconds != null ? (
                    <dl
                      aria-label="Active playback proxy evidence"
                      className="mt-3 grid gap-px overflow-hidden rounded-sm bg-[var(--color-hairline)] sm:grid-cols-2 lg:grid-cols-4"
                    >
                      <Definition
                        label="Active playback"
                        value={`${(outcome.activePlaybackMilliseconds / 1_000).toFixed(1)} seconds`}
                      />
                      <Definition
                        label="Media duration"
                        value={
                          outcome.durationSeconds == null
                            ? "Unknown"
                            : `${outcome.durationSeconds.toFixed(1)} seconds`
                        }
                      />
                      <Definition
                        label="Duration cohort"
                        value={displayRecommendationToken(
                          outcome.durationCohort,
                        )}
                      />
                      <Definition
                        label="Measurement coverage"
                        value={`${displayRecommendationToken(outcome.activeCoverage)} coverage`}
                      />
                    </dl>
                  ) : null}
                  <p className="mt-3 text-[var(--color-text-muted)]">
                    {outcome.reasons
                      .map(displayRecommendationToken)
                      .join(" · ") || "No classifier reasons"}
                  </p>
                  {outcome.eligibilityReasonCodes.length > 0 ? (
                    <p className="mt-2 text-[var(--color-warning)]">
                      Integrity:{" "}
                      {outcome.eligibilityReasonCodes
                        .map(displayRecommendationToken)
                        .join(" · ")}
                    </p>
                  ) : null}
                </div>
              ))}
              {episode.outcomes.length === 0 ? (
                <p className="text-[13px] text-[var(--color-warning)]">
                  No outcome revision exists yet. This is pending
                  evidence/classifier state, not a manufactured result.
                </p>
              ) : null}
            </div>
          </article>
        ))}
        {detail.episodes.length === 0 ? (
          <div className="app-card p-4 text-[13px] text-[var(--color-text-muted)]">
            No playback episode was opened for this request.
          </div>
        ) : null}
      </section>

      <PageSection
        title="Data quality facts"
        meta="SANITIZED REASONS / NO SECRET MATERIAL"
      >
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {detail.audits.map((audit) => (
            <div
              key={audit.id}
              className="rounded-sm border border-[var(--color-hairline)] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {displayRecommendationToken(audit.kind)}
                </span>
                <span className="font-mono text-[11px]">×{audit.count}</span>
              </div>
              <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                {displayRecommendationToken(audit.reasonCode)} ·{" "}
                {formatRecommendationDateTime(audit.occurredAt)}
              </p>
            </div>
          ))}
          {detail.conflicts.map((conflict) => (
            <div
              key={conflict.id}
              className="rounded-sm border border-[var(--color-danger-border)] p-3"
            >
              <div className="font-medium text-[var(--color-danger)]">
                Conflict · {conflict.attempts} attempts
              </div>
              <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                First {formatRecommendationDateTime(conflict.firstSeenAt)} ·
                last {formatRecommendationDateTime(conflict.lastSeenAt)}
              </p>
            </div>
          ))}
          {detail.audits.length === 0 && detail.conflicts.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-muted)]">
              No replay, rejection, late, or conflict facts are recorded.
            </p>
          ) : null}
        </div>
      </PageSection>
    </div>
  )
}

function deliverySummary(detail: RecommendationRequestDetailData) {
  const composed =
    detail.candidateExecution?.composedCount ?? detail.items.length
  const requested =
    detail.candidateExecution?.requestedCount ?? detail.expectedItemCount
  const mode = detail.personalization?.executionMode
  const modeCopy =
    mode === "hybrid_personalized"
      ? "Semantic context and consented profile signals contributed to one hybrid slate."
      : mode === "semantic_fallback"
        ? "The personalized path fell back to a semantic contextual slate."
        : mode === "semantic_contextual"
          ? "This is a semantic contextual slate; no profile signal influenced ranking."
          : "This request predates additive execution-mode evidence."
  return `${modeCopy} ${composed} of ${requested} requested positions were committed for ${detail.locale}.`
}
function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-[var(--color-surface)] px-3 py-3">
      <dt className="label-text">{label}</dt>
      <dd className="mt-1 break-words font-mono text-[11px] text-[var(--color-text-secondary)]">
        {value}
      </dd>
    </div>
  )
}

function formatMetrics(metrics: Record<string, unknown>) {
  const rows = Object.entries(metrics)
  return rows.length === 0
    ? "No projected metrics"
    : rows
        .map(
          ([key, value]) =>
            `${displayRecommendationToken(key)}: ${String(value)}`,
        )
        .join(" · ")
}

function eligibilityTone(
  state: "pending" | "eligible" | "excluded" | "quarantined",
) {
  if (state === "eligible") return "success" as const
  if (state === "quarantined") return "danger" as const
  if (state === "excluded") return "muted" as const
  return "warning" as const
}
