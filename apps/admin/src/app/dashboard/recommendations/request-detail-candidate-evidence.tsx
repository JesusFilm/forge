import { PageSection, StatusPill } from "@/components/admin-ui"
import type { RecommendationRequestDetailData } from "@/services/recommendations/admin-ops"
import {
  displayRecommendationToken,
  formatRecommendationDateTime,
} from "./recommendation-display"

export function RecommendationCandidateEvidence({
  detail,
}: {
  detail: RecommendationRequestDetailData
}) {
  return (
    <>
      {detail.shadowComparisons.length > 0 ? (
        <PageSection
          title="Live versus shadow candidates"
          meta="COUNTERFACTUAL ONLY / LIVE ORDER IMMUTABLE"
        >
          <div className="grid gap-4 p-4">
            {detail.shadowComparisons.map((comparison) => (
              <article
                key={comparison.runId}
                className="rounded-sm border border-[var(--color-hairline)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="font-medium">
                      {comparison.generatorVersion}
                    </h3>
                    <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                      Sample {comparison.sampleOrdinal + 1} · run{" "}
                      {displayRecommendationToken(comparison.runState)} · input{" "}
                      {formatRecommendationDateTime(comparison.inputCapturedAt)}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                      sampling {comparison.versions.sampling} · context{" "}
                      {comparison.versions.context} · eligibility{" "}
                      {comparison.versions.eligibility}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <StatusPill
                      tone={
                        comparison.liveSlateUnchanged ? "success" : "danger"
                      }
                    >
                      {comparison.liveSlateUnchanged
                        ? "Live slate untouched"
                        : "Isolation unproven"}
                    </StatusPill>
                    {comparison.decision ? (
                      <StatusPill
                        tone={shadowDecisionTone(comparison.decision.state)}
                      >
                        {displayRecommendationToken(comparison.decision.state)}
                      </StatusPill>
                    ) : (
                      <StatusPill tone="warning">Decision pending</StatusPill>
                    )}
                  </div>
                </div>

                {comparison.decision ? (
                  <div className="mt-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 text-[12px]">
                    <p className="font-medium">
                      {displayRecommendationToken(
                        comparison.decision.reasonCode,
                      )}
                    </p>
                    <p className="mt-1 text-[var(--color-text-muted)]">
                      Reevaluate when{" "}
                      {displayRecommendationToken(
                        comparison.decision.reevaluationCondition,
                      )}
                      .
                    </p>
                  </div>
                ) : null}

                <dl className="mt-4 grid gap-px overflow-hidden rounded-sm bg-[var(--color-hairline)] sm:grid-cols-4 lg:grid-cols-8">
                  <Definition
                    label="Coverage"
                    value={formatRate(comparison.metrics.coverage)}
                  />
                  <Definition
                    label="Overlap"
                    value={formatRate(comparison.metrics.overlap)}
                  />
                  <Definition
                    label="Novelty"
                    value={formatRate(comparison.metrics.novelty)}
                  />
                  <Definition
                    label="Diversity"
                    value={formatRate(comparison.metrics.diversity)}
                  />
                  <Definition
                    label="Rejection"
                    value={formatRate(comparison.metrics.rejection)}
                  />
                  <Definition
                    label="Latency"
                    value={formatMilliseconds(comparison.metrics.latencyMs)}
                  />
                  <Definition
                    label="Cohort quality"
                    value={formatRate(comparison.metrics.cohortQuality)}
                  />
                  <Definition
                    label="Input freshness"
                    value={formatMilliseconds(
                      comparison.metrics.inputFreshnessMs,
                    )}
                  />
                </dl>

                <details className="mt-4">
                  <summary className="cursor-pointer text-[12px] font-medium">
                    Inspect {comparison.nominations.length} bounded nomination
                    {comparison.nominations.length === 1 ? "" : "s"}
                  </summary>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[820px] border-collapse text-left text-[12px]">
                      <thead>
                        <tr className="border-y border-[var(--color-hairline)] text-[var(--color-text-muted)]">
                          <th className="px-3 py-2 font-medium">Candidate</th>
                          <th className="px-3 py-2 font-medium">
                            Contribution
                          </th>
                          <th className="px-3 py-2 font-medium">Eligibility</th>
                          <th className="px-3 py-2 font-medium">Comparison</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparison.nominations.map((nomination) => (
                          <tr
                            key={`${comparison.runId}:${nomination.ordinal}`}
                            className="border-b border-[var(--color-hairline)] align-top"
                          >
                            <td className="px-3 py-3">
                              <div className="break-all font-mono text-[10px]">
                                {nomination.targetMediaId}
                              </div>
                              <div className="mt-1 text-[var(--color-text-muted)]">
                                shadow position{" "}
                                {nomination.shadowPosition == null
                                  ? "none"
                                  : nomination.shadowPosition + 1}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              {nomination.generator} · rank{" "}
                              {nomination.sourceRank} · score{" "}
                              {nomination.sourceScore.toFixed(3)}
                              <div className="mt-1 text-[var(--color-text-muted)]">
                                {Object.entries(nomination.provenance ?? {})
                                  .map(([key, value]) => `${key}=${value}`)
                                  .join(" · ") ||
                                  `provenance keys ${nomination.provenanceKeys.join(", ") || "none"}`}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <StatusPill
                                tone={nomination.eligible ? "success" : "muted"}
                              >
                                {nomination.eligible ? "Eligible" : "Rejected"}
                              </StatusPill>
                              {nomination.reasonCodes.length > 0 ? (
                                <div className="mt-2 text-[var(--color-warning)]">
                                  {nomination.reasonCodes
                                    .map(displayRecommendationToken)
                                    .join(" · ")}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-3">
                              {nomination.overlapsLive
                                ? "Also in live slate"
                                : "Shadow-only candidate"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </article>
            ))}
          </div>
        </PageSection>
      ) : null}

      {detail.candidateExecution ? (
        <PageSection
          title="Candidate execution"
          meta="NOMINATION / ELIGIBILITY / DETERMINISTIC ORDER / COMPOSITION"
        >
          <div className="grid gap-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  Purpose {detail.candidateExecution.purpose} · evidence{" "}
                  {detail.candidateExecution.evidenceComplete
                    ? "complete"
                    : "incomplete"}
                </p>
                <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                  eligibility {detail.candidateExecution.versions.eligibility} ·
                  ranker {detail.candidateExecution.versions.ranker} · composer{" "}
                  {detail.candidateExecution.versions.composer}
                </p>
                {detail.candidateExecution.fallbackReason ? (
                  <p className="mt-2 text-[12px] text-[var(--color-warning)]">
                    Fallback:{" "}
                    {displayRecommendationToken(
                      detail.candidateExecution.fallbackReason,
                    )}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusPill
                  tone={parityTone(
                    detail.candidateExecution.parity.candidateEligibility,
                  )}
                >
                  Candidate / eligibility parity ·{" "}
                  {displayRecommendationToken(
                    detail.candidateExecution.parity.candidateEligibility,
                  )}
                </StatusPill>
                <StatusPill
                  tone={parityTone(detail.candidateExecution.parity.ranker)}
                >
                  Deterministic ranker parity ·{" "}
                  {displayRecommendationToken(
                    detail.candidateExecution.parity.ranker,
                  )}
                </StatusPill>
              </div>
            </div>
            <dl className="grid gap-px overflow-hidden rounded-sm bg-[var(--color-hairline)] sm:grid-cols-4 lg:grid-cols-7">
              {Object.entries(detail.candidateExecution.counts).map(
                ([stage, count]) => (
                  <Definition
                    key={stage}
                    label={displayRecommendationToken(stage)}
                    value={String(count)}
                  />
                ),
              )}
            </dl>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left text-[12px]">
                <thead>
                  <tr className="border-y border-[var(--color-hairline)] text-[var(--color-text-muted)]">
                    <th scope="col" className="px-3 py-2 font-medium">
                      Stage
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Candidate
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Source
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Scores / position
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Reasons
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.candidateExecution.stages.map((stage) => (
                    <tr
                      key={`${stage.stage}:${stage.ordinal}:${stage.candidateKey}`}
                      className="border-b border-[var(--color-hairline)] align-top"
                    >
                      <td className="px-3 py-3">
                        {displayRecommendationToken(stage.stage)} #
                        {stage.ordinal + 1}
                      </td>
                      <td className="px-3 py-3">
                        <div className="break-all font-mono text-[10px]">
                          {stage.targetMediaId ?? stage.candidateKey}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {stage.sourceGenerator ?? "combined"} ·{" "}
                        {stage.sourceCount} source
                        {stage.sourceCount === 1 ? "" : "s"}
                        {stage.sourceRank == null
                          ? ""
                          : ` · rank ${stage.sourceRank}`}
                        {stage.sourceSummaries.length > 0 ? (
                          <ul className="mt-2 grid gap-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                            {stage.sourceSummaries.map((source, index) => (
                              <li key={`${stage.candidateKey}:source:${index}`}>
                                {source}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 font-mono text-[10px]">
                        source {formatNullableDecimal(stage.sourceScore)} ·
                        normalized{" "}
                        {formatNullableDecimal(stage.normalizedScore)} · RRF{" "}
                        {formatNullableDecimal(stage.rrfScore)} · deterministic{" "}
                        {formatNullableDecimal(stage.deterministicScore)} ·
                        position{" "}
                        {stage.finalPosition == null
                          ? "n/a"
                          : stage.finalPosition + 1}
                      </td>
                      <td className="px-3 py-3 text-[var(--color-text-muted)]">
                        {stage.reasonCodes.length === 0
                          ? "None"
                          : stage.reasonCodes
                              .map(displayRecommendationToken)
                              .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </PageSection>
      ) : null}
    </>
  )
}

export function FinalSlatePanel({
  detail,
}: {
  detail: RecommendationRequestDetailData
}) {
  const stages = detail.candidateExecution?.stages ?? []
  return (
    <PageSection
      title="Final served slate"
      meta="FINAL ORDER / CONTRIBUTORS / MOVEMENT / REFILL"
    >
      <div className="grid gap-4 p-4">
        {detail.items.map((item) => {
          const composition = item.composition
          const contributors = composition?.contributors ?? []
          const itemStages = stages.filter(
            (stage) => stage.targetMediaId === item.targetMediaId,
          )
          return (
            <article
              key={item.id}
              className="rounded-sm border border-[var(--color-hairline)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone="info">
                      Position {item.position + 1}
                    </StatusPill>
                    {composition?.refill ? (
                      <StatusPill tone="warning">
                        {contributors.length > 0 &&
                        contributors.every(
                          (contributor) => contributor.generator === "semantic",
                        )
                          ? "Semantic refill"
                          : "Refill after suppression"}
                      </StatusPill>
                    ) : null}
                    {contributors.length > 1 ? (
                      <StatusPill tone="success">Dual-source</StatusPill>
                    ) : null}
                  </div>
                  <h3 className="mt-3 font-medium">
                    {item.presentation.videoTitle ?? item.targetMediaId}
                  </h3>
                  <p className="mt-1 break-all font-mono text-[10px] text-[var(--color-text-muted)]">
                    {item.targetMediaId} · {item.candidateGenerator}
                  </p>
                </div>
                <div className="text-right text-[11px] text-[var(--color-text-muted)]">
                  <div>
                    Pre-composition order{" "}
                    {composition?.orderedPosition == null
                      ? "not recorded"
                      : composition.orderedPosition + 1}
                  </div>
                  <div className="mt-1">
                    Movement {formatMovement(composition?.movement ?? null)}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {(contributors.length > 0
                  ? contributors
                  : [
                      {
                        generator: item.candidateGenerator,
                        generatorVersion: "legacy-unrecorded",
                        rank: 0,
                      },
                    ]
                ).map((contributor, contributorIndex) => (
                  <span
                    key={`${item.id}:${contributor.generator}:${contributor.generatorVersion}:${contributor.rank}:${contributorIndex}`}
                    className="rounded-sm border border-[var(--color-hairline)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-secondary)]"
                  >
                    {contributor.generator} · {contributor.generatorVersion}
                    {contributor.rank > 0
                      ? ` · source rank ${contributor.rank}`
                      : ""}
                  </span>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <StatusPill tone={item.renderedAt ? "success" : "muted"}>
                  {item.renderedAt ? "Rendered" : "Not rendered"}
                </StatusPill>
                <StatusPill tone={item.impressionAt ? "success" : "muted"}>
                  {item.impressionAt ? "Impression" : "No impression"}
                </StatusPill>
                <StatusPill tone={item.selectedAt ? "info" : "muted"}>
                  {item.selectedAt ? "Selection" : "Not selected"}
                </StatusPill>
              </div>

              {item.explanation ? (
                <p className="mt-3 text-[12px] text-[var(--color-warning)]">
                  {item.explanation}
                </p>
              ) : null}

              <details className="mt-4 border-t border-[var(--color-hairline)] pt-3">
                <summary className="cursor-pointer text-[12px] font-medium">
                  Inspect nomination, scoring, and composition evidence
                </summary>
                {itemStages.length > 0 ? (
                  <ol className="mt-3 grid gap-2">
                    {itemStages.map((stage) => (
                      <li
                        key={`${item.id}:${stage.stage}:${stage.ordinal}`}
                        className="rounded-sm bg-[var(--color-surface)] p-3 text-[11px]"
                      >
                        <div className="font-medium">
                          {displayRecommendationToken(stage.stage)} · position{" "}
                          {stage.finalPosition == null
                            ? "n/a"
                            : stage.finalPosition + 1}
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                          deterministic{" "}
                          {formatNullableDecimal(stage.deterministicScore)} ·
                          RRF {formatNullableDecimal(stage.rrfScore)} · reasons{" "}
                          {stage.reasonCodes
                            .map(displayRecommendationToken)
                            .join(" · ") || "none"}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3 text-[12px] text-[var(--color-text-muted)]">
                    No additive candidate-stage evidence was recorded for this
                    compatible legacy item.
                  </p>
                )}
              </details>
            </article>
          )
        })}

        {detail.items.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-muted)]">
            No served items committed.
          </p>
        ) : null}

        {detail.candidateExecution?.suppressions?.length ? (
          <div className="rounded-sm border border-[var(--color-warning-border)] p-4">
            <h3 className="font-medium">Suppressed before final composition</h3>
            <ul className="mt-3 grid gap-2 text-[12px]">
              {detail.candidateExecution.suppressions.map(
                (suppression, index) => (
                  <li
                    key={`${suppression.targetMediaId}:${index}`}
                    className="flex flex-wrap justify-between gap-2"
                  >
                    <span className="break-all font-mono text-[10px]">
                      {suppression.targetMediaId}
                    </span>
                    <span className="text-[var(--color-text-muted)]">
                      {suppression.reasonCodes
                        .map(displayRecommendationToken)
                        .join(" · ") || "Rejected by eligibility"}
                    </span>
                  </li>
                ),
              )}
            </ul>
          </div>
        ) : null}
      </div>
    </PageSection>
  )
}

function formatMovement(movement: number | null) {
  if (movement == null) return "not recorded"
  if (movement === 0) return "retained"
  return movement > 0 ? `down ${movement}` : `up ${Math.abs(movement)}`
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

function formatNullableDecimal(value: number | null) {
  return value == null ? "n/a" : value.toFixed(3)
}

function formatRate(value: number | null) {
  return value == null ? "n/a" : `${Math.round(value * 100)}%`
}

function formatMilliseconds(value: number | null) {
  return value == null ? "n/a" : `${value.toLocaleString("en-US")} ms`
}

function shadowDecisionTone(
  state: "promote_to_experiment" | "revise" | "retire" | "inconclusive",
) {
  if (state === "promote_to_experiment") return "success" as const
  if (state === "inconclusive") return "warning" as const
  return "danger" as const
}

function parityTone(state: "passed" | "failed" | "not_evaluated") {
  if (state === "passed") return "success" as const
  if (state === "failed") return "danger" as const
  return "warning" as const
}
