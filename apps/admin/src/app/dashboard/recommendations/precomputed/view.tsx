import { PageSection, StatusPill } from "@/components/admin-ui"
import type { PrecomputedComparison } from "@/services/recommendations/precomputed/contract"

type ExperimentalCard = Extract<
  PrecomputedComparison,
  { state: "ready" }
>["experimental"][number]

function ExperimentalCards({ cards }: { cards: ExperimentalCard[] }) {
  if (cards.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-text-muted)]">
        No experimental cards for this audio language.
      </p>
    )
  }
  return (
    <ol className="space-y-3">
      {cards.map((card, index) => (
        <li
          key={card.targetVideoId}
          className="border border-[var(--color-hairline)] p-3 text-[13px]"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[var(--color-text-primary)]">
              {index + 1}. {card.videoTitle}
            </span>
            <StatusPill tone={card.kind === "direct" ? "success" : "warning"}>
              {card.kind}
            </StatusPill>
            <span>{card.relationship.replaceAll("_", " ")}</span>
          </div>
          <p className="mt-1">{card.reasonEnglish}</p>
          {card.addedViewingValueEnglish ? (
            <p className="mt-1">
              Additional viewing value: {card.addedViewingValueEnglish}
            </p>
          ) : null}
          {card.evidence.basis === "metadata" ? (
            <p className="mt-2 text-[var(--color-text-muted)]">
              Metadata only: {card.evidence.fields.join(", ")}. No transcript
              passage supports this judgment.
            </p>
          ) : (
            <div className="mt-2 space-y-1">
              <p className="text-[var(--color-text-muted)]">
                Transcript-backed evidence
              </p>
              {card.evidence.passages.map((passage) => (
                <blockquote
                  key={passage.chunkId}
                  className="border-l-2 border-[var(--color-hairline)] pl-2"
                >
                  <span lang={passage.language}>{passage.excerpt}</span>
                  <span className="ml-2 text-[var(--color-text-muted)]">
                    {passage.language} · {passage.videoId} · {passage.chunkId}
                  </span>
                </blockquote>
              ))}
            </div>
          )}
          <code className="mt-2 block break-all text-[11px] text-[var(--color-text-muted)]">
            {card.targetVideoId}
          </code>
        </li>
      ))}
    </ol>
  )
}

export function PrecomputedComparisonView({
  comparison,
}: {
  comparison: PrecomputedComparison
}) {
  if (comparison.state !== "ready") {
    return (
      <PageSection title="Saved generation" meta="PRIVATE / READ ONLY">
        <p className="p-4 text-[13px] text-[var(--color-text-secondary)]">
          {comparison.state === "incomplete"
            ? "Generation is incomplete and cannot be previewed as ready."
            : comparison.state === "failed"
              ? "Generation failed; previous complete builds remain available."
              : comparison.state === "not_in_generation"
                ? "This source Video is not in the selected generation."
                : "Generation not found."}
        </p>
        {comparison.state === "failed" && comparison.failureCode ? (
          <p className="px-4 pb-4 text-[13px] text-[var(--color-text-secondary)]">
            Source failure: {comparison.failureCode}.{" "}
            {comparison.usage?.unknownUsageCallCount
              ? `${comparison.usage.unknownUsageCallCount} model calls have unreported usage.`
              : ""}
          </p>
        ) : null}
        {comparison.state === "failed" &&
        comparison.inputSnapshotMode === "preflight_failed" ? (
          <p className="px-4 pb-4 text-[13px] text-[var(--color-text-secondary)]">
            Input discovery failed before a complete observed-input digest was
            available.
          </p>
        ) : null}
      </PageSection>
    )
  }
  return (
    <div className="space-y-5">
      <PageSection title="Saved generation" meta="PRIVATE / READ ONLY">
        <div className="space-y-2 p-4 text-[13px] text-[var(--color-text-secondary)]">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="success">Complete</StatusPill>
            <StatusPill tone="warning">No public activation</StatusPill>
          </div>
          <p>
            Generation <code>{comparison.generation.id}</code> ·{" "}
            {comparison.generation.modelId} · prompt{" "}
            {comparison.generation.promptVersion}
          </p>
          <p>Input cutoff {comparison.generation.inputCutoff.toISOString()}</p>
          <p>
            Input {comparison.generation.inputMode.replaceAll("_", " ")} ·{" "}
            {comparison.generation.inputSnapshotMode === "observed_fenced"
              ? "Observed current rows checked against cutoff; overwritten or deleted historical versions cannot be reconstructed."
              : "Fixture input"}
          </p>
          <p>
            {comparison.usage.callCount} model calls ·{" "}
            {comparison.usage.inputTokens} input tokens ·{" "}
            {comparison.usage.outputTokens} output tokens ·{" "}
            {comparison.usage.cachedInputTokens} cached input tokens
            {comparison.usage.unknownUsageCallCount > 0
              ? ` · ${comparison.usage.unknownUsageCallCount} calls with unreported usage`
              : ""}
          </p>
          <p>
            {comparison.allAcceptedCount} accepted choices stored; up to six
            shown after current audio-language checks.
          </p>
          {comparison.coverageGap === "no_connections" ? (
            <p>No accepted connections for this source.</p>
          ) : null}
          {comparison.coverageGap === "no_playable_connections" ? (
            <p>
              No saved connection is currently playable in this audio language.
            </p>
          ) : null}
        </div>
      </PageSection>
      <div className="grid gap-5 lg:grid-cols-2">
        <PageSection
          title="Anonymous contextual incumbent"
          meta="CURATED / READ ONLY"
        >
          <div className="p-4 text-[13px] text-[var(--color-text-secondary)]">
            <p className="mb-3 text-[var(--color-text-muted)]">
              Current source-context result for an anonymous, unmeasured Watch
              visit. Measured visits can use personalization and composition.
            </p>
            {comparison.anonymousBaselineState === "unavailable" ? (
              <p>Anonymous contextual incumbent unavailable.</p>
            ) : comparison.anonymousBaselineState !== "available" ? (
              <p>
                Curated context{" "}
                {comparison.anonymousBaselineState.replaceAll("_", " ")}.
              </p>
            ) : comparison.anonymousBaseline.length === 0 ? (
              <p>No current anonymous contextual cards.</p>
            ) : (
              <ol className="space-y-2">
                {comparison.anonymousBaseline.map((card, index) => (
                  <li
                    key={card.videoId}
                    className="border border-[var(--color-hairline)] p-3"
                  >
                    {index + 1}. {card.videoTitle}
                    <code className="mt-1 block break-all text-[11px]">
                      {card.videoId}
                    </code>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </PageSection>
        <PageSection title="Experimental saved choices" meta="SIX-CARD PREVIEW">
          <div className="p-4 text-[var(--color-text-secondary)]">
            <ExperimentalCards cards={comparison.experimental} />
          </div>
        </PageSection>
      </div>
      <PageSection
        title="Current semantic retrieval input"
        meta="PARTIAL MEASURED-VISIT SIGNAL"
      >
        <div className="p-4 text-[13px] text-[var(--color-text-secondary)]">
          <p className="mb-3 text-[var(--color-text-muted)]">
            These candidates are an input to measured Watch delivery.
            Composition, owner controls, personalization, and curated recovery
            can change the delivered slate.
          </p>
          {comparison.semanticBaselineState === "unavailable" ? (
            <p>
              Current semantic retrieval unavailable for this source and
              language.
            </p>
          ) : comparison.semanticBaseline.length === 0 ? (
            <p>No current semantic candidates.</p>
          ) : (
            <ol className="space-y-2">
              {comparison.semanticBaseline.map((card, index) => (
                <li key={card.videoId}>
                  {index + 1}. {card.videoTitle} <code>{card.videoId}</code>
                </li>
              ))}
            </ol>
          )}
        </div>
      </PageSection>
      <PageSection title="Current coverage gaps" meta="NOT STORED PER VISIT">
        <div className="p-4 text-[13px] text-[var(--color-text-secondary)]">
          {comparison.gaps.length === 0 ? (
            <p>No language or publication gaps among saved choices.</p>
          ) : (
            <ul className="space-y-1">
              {comparison.gaps.map((gap) => (
                <li key={gap.targetVideoId}>
                  <code>{gap.targetVideoId}</code>:{" "}
                  {gap.reason.replaceAll("_", " ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      </PageSection>
    </div>
  )
}
