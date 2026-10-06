import { PageSection, StatusPill } from "@/components/admin-ui"
import type { loadDurablePrecomputedBuildReport } from "@/services/recommendations/precomputed/durable-build"
import { HistoricalQualificationDetails } from "./view"

type Report = NonNullable<
  Awaited<ReturnType<typeof loadDurablePrecomputedBuildReport>>
>

function bytes(value: number) {
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value / 1_000_000)} MB`
}
function usd(value: number) {
  return `$${value.toFixed(4)}`
}

export function DurableBuildReportView({ report }: { report: Report }) {
  const capacity = report.capacity as {
    status?: string
    measuredAt?: string
    availableBytes?: number
    reserveBytes?: number
    projectedBytes?: number
    otherReservedBytes?: number
    observedDbGrowthBytes?: number
    recentTerminalProjectedBytes?: number
    unaccountedGrowthBytes?: number
    source?: string
  } | null
  return (
    <PageSection title="Durable catalog build" meta="PRIVATE / NO ACTIVATION">
      <div className="space-y-3 p-4 text-[13px] text-[var(--color-text-secondary)]">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            tone={report.state === "complete" ? "success" : "warning"}
          >
            {report.state.replaceAll("_", " ")}
          </StatusPill>
          <span>
            {report.modelId} · prompt {report.promptVersion}
          </span>
        </div>
        <p>
          {report.completeEdgesSourceCount} sources with connections ·{" "}
          {report.completeEmptySourceCount} explicit empty ·{" "}
          {report.failedSourceCount} failed · {report.claimedSourceCount}{" "}
          claimed · {report.pendingSourceCount} pending, from{" "}
          {report.expectedSourceCount} declared sources. {report.acceptedCount}{" "}
          accepted connections stored.
        </p>
        {report.failures.length > 0 ? (
          <p>
            Failures:{" "}
            {report.failures
              .map((item) => `${item.code} (${item.count})`)
              .join(", ")}
          </p>
        ) : null}
        <p>
          Model: {report.usage.modelCallCount} reserved calls,{" "}
          {report.usage.modelPendingCount} unresolved; known provider charge{" "}
          {usd(report.usage.modelKnownCostUsd)} with{" "}
          {report.usage.modelUnknownCostCount} calls whose charge is unknown.{" "}
          {report.usage.inputTokens} input / {report.usage.outputTokens} output
          / {report.usage.cachedInputTokens} cached input tokens reported.
        </p>
        <p>
          GA: {report.usage.historyCallCount} request reservations, including
          qualification and retries;{" "}
          {report.usage.historyCallCount - report.usage.historyPendingCount}{" "}
          completed receipts and {report.usage.historyPendingCount} pending with
          dispatch and charge unresolved.{" "}
          {bytes(report.usage.historyKnownBytes)} known processed bytes with{" "}
          {report.usage.historyUnknownBytesCount} unknown,{" "}
          {usd(report.usage.historyKnownCostUsd)} known charge with{" "}
          {report.usage.historyUnknownCostCount} unknown. Unknown is never
          displayed as free.
        </p>
        <p>
          Elapsed {Math.round(report.elapsedMs / 60_000)} min including pauses.
          Generation inline tuple bytes{" "}
          {bytes(report.storedSize.generationRowBytes)} (excludes TOAST,
          indexes, and WAL); durable build tables across all generations{" "}
          {bytes(report.storedSize.tablesPhysicalBytesAllGenerations)} physical
          including indexes (shared across generations). Neither figure alone is
          per-generation physical allocation.
        </p>
        {report.projectedKnownModelUsd !== null ? (
          <p>
            Early extrapolation from completed sources: about{" "}
            {usd(report.projectedKnownModelUsd)} known model charge and{" "}
            {Math.round((report.projectedElapsedMs ?? 0) / 60_000)} min. This
            excludes unreported provider charges and is not a total budget.
          </p>
        ) : (
          <p>
            Full-run cost/runtime extrapolation unavailable until at least ten
            sources finish with known model charges.
          </p>
        )}
        {capacity ? (
          <p>
            Capacity {capacity.status};{" "}
            {report.capacityFresh ? "fresh" : "expired or blocked"} PGDATA
            physical observation at {capacity.measuredAt ?? "unknown"} from{" "}
            {capacity.source ?? "unknown"}. Available{" "}
            {bytes(capacity.availableBytes ?? 0)}, operator reserve{" "}
            {bytes(capacity.reserveBytes ?? 0)} (with a conservative 5 GB
            implementation floor), projected build storage{" "}
            {bytes(capacity.projectedBytes ?? 0)}, other active reservations{" "}
            {bytes(capacity.otherReservedBytes ?? 0)}; database growth since
            observation {bytes(capacity.observedDbGrowthBytes ?? 0)}, recently
            finished build projections{" "}
            {bytes(capacity.recentTerminalProjectedBytes ?? 0)}. The larger
            overlapping amount, {bytes(capacity.unaccountedGrowthBytes ?? 0)},
            is held against this observation until a new physical sample.
            Conservative write estimate since this observation{" "}
            {bytes(report.capacityEstimatedConsumedBytes)}. Admin verified
            database size and cluster identity; physical free space was
            externally observed, not measured from the Admin app filesystem.
          </p>
        ) : (
          <p>No measured capacity preflight. Source work is held.</p>
        )}
        {report.historicalQualification ? (
          <div className="space-y-2 border-t border-[var(--color-hairline)] pt-2">
            <p>
              GA input is qualified referrer navigation evidence, not a playback
              sequence; bots, exposure, and historical URL ownership remain
              unverified. Source aggregate rows {report.historyTotals.rowCount},
              mapped {report.historyTotals.mappedRows}, unmapped{" "}
              {report.historyTotals.unmappedRows};{" "}
              {report.historyTotals.pageCount} pages and{" "}
              {report.historyTotals.queryExecutionCount} snapshot queries.
              Reserved HTTP requests, including qualification and retries, are
              counted separately above; pending reservations have unknown
              dispatch.
            </p>
            {report.historyTotals.navigationCoverage ? (
              <p>
                Across {report.historyTotals.sourceCount} submitted source
                snapshots, navigation events{" "}
                {report.historyTotals.navigationCoverage.candidateEvents}:
                qualified{" "}
                {report.historyTotals.navigationCoverage.qualifiedEvents}; home{" "}
                {report.historyTotals.navigationCoverage.homeEvents}, self{" "}
                {report.historyTotals.navigationCoverage.selfEvents}, cross-host{" "}
                {report.historyTotals.navigationCoverage.crossHostEvents},
                malformed{" "}
                {report.historyTotals.navigationCoverage.malformedEvents},
                unmapped{" "}
                {report.historyTotals.navigationCoverage.unmappedEvents},
                ambiguous{" "}
                {report.historyTotals.navigationCoverage.ambiguousEvents}. These
                are observed event counts, separate from aggregate row counts.
              </p>
            ) : (
              <p>
                No source navigation snapshot has been submitted yet; event
                counts are unknown.
              </p>
            )}
            <HistoricalQualificationDetails
              quality={report.historicalQualification}
            />
          </div>
        ) : null}
        {report.source ? (
          <div className="space-y-1 border-t border-[var(--color-hairline)] pt-2">
            <p>
              Selected source{" "}
              <code className="break-all">{report.source.id}</code>:{" "}
              {report.source.state.replaceAll("_", " ")}, attempt{" "}
              {report.source.attemptNumber}, checkpoint{" "}
              {report.source.checkpointRevision}.
            </p>
            {report.source.failureCode ? (
              <p>Failure: {report.source.failureCode}</p>
            ) : null}
            {report.source.historicalProvenance ? (
              <p>
                Source GA snapshot{" "}
                {report.source.historicalProvenance.rangeStart} to{" "}
                {report.source.historicalProvenance.rangeEnd}:{" "}
                {report.source.historicalProvenance.mappedRows}/
                {report.source.historicalProvenance.rowCount} rows mapped,{" "}
                {report.source.historicalProvenance.unmappedRows} unmapped;
                navigation{" "}
                {
                  report.source.historicalProvenance.navigationCoverage
                    .qualifiedEvents
                }
                /
                {
                  report.source.historicalProvenance.navigationCoverage
                    .candidateEvents
                }{" "}
                qualified,{" "}
                {
                  report.source.historicalProvenance.navigationCoverage
                    .unmappedEvents
                }{" "}
                unmapped events; result digest{" "}
                <code className="break-all">
                  {report.source.historicalProvenance.resultDigest}
                </code>
                .
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </PageSection>
  )
}
