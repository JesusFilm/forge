import { PageSection, StatusPill } from "@/components/admin-ui"
import type { PrecomputedComparison } from "@/services/recommendations/precomputed/contract"

type ExperimentalCard = Extract<
  PrecomputedComparison,
  { state: "ready" }
>["experimental"][number]
type HistoricalQualification = NonNullable<
  NonNullable<
    Extract<PrecomputedComparison, { state: "ready" }>["history"]
  >["qualification"]
>

export function HistoricalQualificationDetails({
  quality,
}: {
  quality: HistoricalQualification
}) {
  if ("evidenceKind" in quality) {
    const { sourceAvailability, watchScope, mediaComponentIdCoverage } = quality
    return (
      <>
        <p>
          GA source {quality.sourceResource}: full requested history{" "}
          {sourceAvailability.requestedStart} to{" "}
          {sourceAvailability.requestedEnd}; usable query interval{" "}
          {sourceAvailability.usableStart} to {sourceAvailability.usableEnd}.
          Only the usable snapshot finished processing; full historical source
          coverage is partial.
        </p>
        <p>
          Unavailable historical prefix{" "}
          {sourceAvailability.unavailablePrefixStart} to{" "}
          {sourceAvailability.unavailablePrefixEnd} remains unknown. GA reported{" "}
          {sourceAvailability.truncationType} on{" "}
          {sourceAvailability.truncationDate}. Observed event months{" "}
          {sourceAvailability.observedFirstMonth ?? "unknown"} to{" "}
          {sourceAvailability.observedLastMonth ?? "unknown"}.
        </p>
        <p>
          Watch scope {watchScope.version}: hosts {watchScope.hosts.join(", ")};
          path /watch or /watch/...; query and fragment ignored.{" "}
          {watchScope.includedEvents} videostarts in the queried Watch scope.
          Total property events and excluded host/path/malformed/missing URL
          counts are unknown.
        </p>
        <p>
          Media component ID present for{" "}
          {mediaComponentIdCoverage.withMediaComponentIdEvents}/
          {mediaComponentIdCoverage.inScopeEvents} scoped videostarts; canonical
          ID mapping by that dimension is unknown. Current-catalog Watch path
          mapping has unverified historical ownership.
        </p>
        <p>
          Referrer navigation {quality.navigation.definitionVersion} links the
          page referrer to the page path on the same videostart event. This is
          navigation evidence, not a consecutive watched-video transition.
          Ordered transitions are unavailable because session identity is
          missing. Bot filtering, native overlap, and exposure are unverified or
          unavailable.
        </p>
      </>
    )
  }
  const { watchScope, videoIdCoverage, engagement, transitions } = quality
  return (
    <>
      <p>
        Source <code className="break-all">{quality.sourceTable}</code>;
        observed data {quality.observedStart} to {quality.observedEnd}. Declared
        Watch scope {watchScope.version}: hosts {watchScope.hosts.join(", ")};
        path /watch or /watch/...; query and fragment ignored.
      </p>
      <p>
        {watchScope.includedEvents}/{watchScope.totalEvents} events in scope;
        missing URL {watchScope.missingUrlEvents}, malformed URL{" "}
        {watchScope.malformedUrlEvents}, unverified host/origin{" "}
        {watchScope.excludedHostEvents}, other path{" "}
        {watchScope.excludedPathEvents}.
      </p>
      <p>
        {videoIdCoverage.withIdEvents}/{videoIdCoverage.inScopeEvents} Watch
        videostarts with video ID;{" "}
        {videoIdCoverage.mappedEvents === null
          ? "mapped event coverage unknown"
          : `${videoIdCoverage.mappedEvents} mapped events`}
        . Engagement {engagement.definitionVersion}: bot basis{" "}
        {engagement.botBasis}; overlap {engagement.overlapIdentity}.
      </p>
      <p>
        Transitions {transitions.definitionVersion}; all video starts preserve
        adjacency; verified session identity and timestamp/sequence order; bot
        basis {transitions.botBasis}; overlap {transitions.overlapIdentity}.
      </p>
    </>
  )
}

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
    const transitionReason =
      comparison.state === "failed" &&
      comparison.failureCode?.startsWith("analytics_transition_")
        ? comparison.failureCode
            .slice("analytics_transition_".length)
            .replaceAll("_", " ")
        : null
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
        {comparison.history ? (
          <div className="px-4 pb-4 text-[13px] text-[var(--color-text-secondary)]">
            <p>
              Historical input: {comparison.history.provider};{" "}
              {comparison.history.rowCount} aggregate rows,{" "}
              {comparison.history.unmappedRows} unmapped. Bot filtering:{" "}
              {comparison.history.botFiltering}.
            </p>
            {comparison.history.provider === "ga_data_api" ? (
              <HistoricalQualificationDetails
                quality={comparison.history.qualification}
              />
            ) : null}
          </div>
        ) : null}
        {comparison.state === "failed" &&
        comparison.failureCode === "analytics_incomplete" ? (
          <p className="px-4 pb-4 text-[13px] text-[var(--color-text-secondary)]">
            {comparison.history?.provider === "ga_data_api"
              ? "Usable GA navigation snapshot or bounded query coverage could not be established. No history-backed result was published."
              : "Historical input remains unqualified: Watch scope, event coverage, ordered transitions, or bounded query coverage could not be established. No history-backed result was published."}
          </p>
        ) : null}
        {transitionReason ? (
          <p className="px-4 pb-4 text-[13px] text-[var(--color-text-secondary)]">
            Ordered transitions unavailable: {transitionReason}. No
            history-backed result was published.
          </p>
        ) : null}
        {comparison.state === "failed" &&
        comparison.failureCode === "analytics_mapping_unverified" ? (
          <p className="px-4 pb-4 text-[13px] text-[var(--color-text-secondary)]">
            Historical source identity mapping is unverified or ambiguous. Alias
            totals were not combined.
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
            <StatusPill tone="success">
              {comparison.history?.provider === "ga_data_api"
                ? "Usable snapshot complete"
                : "Complete"}
            </StatusPill>
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
              ? comparison.history
                ? comparison.history.provider === "ga_data_api"
                  ? "Catalog rows checked against cutoff; GA Data API aggregates were observed during this build and may change on a later run."
                  : "Catalog rows checked against cutoff; warehouse aggregates were observed during this build and may change on a later run."
                : "Observed current rows checked against cutoff; overwritten or deleted historical versions cannot be reconstructed."
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
          {comparison.history ? (
            <div className="space-y-1 border-t border-[var(--color-hairline)] pt-2">
              <p>
                Historical analytics (
                {comparison.history.provider === "fixture"
                  ? "controlled fixture"
                  : comparison.history.provider}
                ):{" "}
                {comparison.history.provider === "ga_data_api"
                  ? "usable query "
                  : ""}
                {comparison.history.rangeStart} to {comparison.history.rangeEnd}
                ; query {comparison.history.queryId}.
              </p>
              <p>
                {comparison.history.mappedRows}/{comparison.history.rowCount}{" "}
                aggregate rows mapped; {comparison.history.unmappedRows} unknown
                mappings; {comparison.history.pageCount} pages across{" "}
                {comparison.history.queryExecutionCount}{" "}
                {comparison.history.provider === "ga_data_api"
                  ? "snapshot queries. Source qualification requests are excluded from these counts."
                  : "query jobs."}{" "}
                Bot filtering {comparison.history.botFiltering}; native overlap{" "}
                {comparison.history.overlap}.
              </p>
              <p>
                {comparison.history.inspectedCandidates}/
                {comparison.history.catalogCandidates} catalog candidates
                inspected through bounded historical queries;{" "}
                {comparison.history.unmappedCandidates}{" "}
                {comparison.history.provider === "ga_data_api"
                  ? "had no unique current-catalog Watch path mapping."
                  : "lacked a verified legacy mapping."}
              </p>
              {comparison.history.provider === "ga_data_api" ? (
                <p>
                  Queried navigation events{" "}
                  {comparison.history.navigationCoverage.candidateEvents}:
                  qualified{" "}
                  {comparison.history.navigationCoverage.qualifiedEvents}; home{" "}
                  {comparison.history.navigationCoverage.homeEvents}, self{" "}
                  {comparison.history.navigationCoverage.selfEvents}, cross-host{" "}
                  {comparison.history.navigationCoverage.crossHostEvents},
                  malformed{" "}
                  {comparison.history.navigationCoverage.malformedEvents},
                  unmapped{" "}
                  {comparison.history.navigationCoverage.unmappedEvents},
                  ambiguous{" "}
                  {comparison.history.navigationCoverage.ambiguousEvents}. These
                  counts describe only queried rows.
                </p>
              ) : null}
              {comparison.history.qualification ? (
                <HistoricalQualificationDetails
                  quality={comparison.history.qualification}
                />
              ) : (
                <p>
                  Watch scope and transition capability unknown for this legacy
                  historical record; it is unqualified for a new
                  history-required build.
                </p>
              )}
              <p>
                Sanitized result hash{" "}
                <code className="break-all">
                  {comparison.history.resultDigest}
                </code>{" "}
                · usage hash{" "}
                <code className="break-all">
                  {comparison.history.queryUsageDigest}
                </code>{" "}
                · cutoff {comparison.history.cutoff} · processed bytes{" "}
                {comparison.history.bytesProcessed ?? "unavailable"} · cost{" "}
                {comparison.history.costQualification}.
              </p>
              {comparison.history.unmappedDigest ? (
                <p>
                  Unmapped aggregate hash{" "}
                  <code className="break-all">
                    {comparison.history.unmappedDigest}
                  </code>
                  . No viewer-level rows stored.
                </p>
              ) : null}
            </div>
          ) : comparison.generation.inputMode === "content_only" ? (
            <p>Historical analytics unavailable in this content-only build.</p>
          ) : null}
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
