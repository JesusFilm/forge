import Link from "next/link"
import { DashboardPageHeader, PageSection } from "@/components/admin-ui"
import type { loadPrecomputedStorageCapacityReport } from "@/services/recommendations/precomputed/storage-capacity"

type Report = Awaited<ReturnType<typeof loadPrecomputedStorageCapacityReport>>
const bytes = (value: number) => new Intl.NumberFormat("en-US").format(value)

export function PrecomputedStorageView({
  report,
  generationId,
}: {
  report: Report
  generationId?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <DashboardPageHeader
        eyebrow="Recommendation operations / private experiment"
        title="Storage and retention capacity"
        description="Read-only PostgreSQL observation. Relation bytes include every generation and dead space; the selected-generation row-value estimate is not physical allocation. This report does not approve a catalog build or launch."
        action={
          <Link
            href="/dashboard/recommendations/precomputed"
            className="text-[13px] underline underline-offset-4"
          >
            Saved Video connections
          </Link>
        }
      />
      <PageSection title="Readiness" meta={report.measuredAt}>
        <div className="space-y-2 p-4 text-[13px]">
          <p>Admission evidence is incomplete. Live approval: no.</p>
          <p>Missing: {report.readiness.missing.join(", ")}.</p>
          <p>
            Database size: {bytes(report.databaseBytes)} bytes. Shared cluster
            cumulative WAL:{" "}
            {report.globalWal.bytes === null
              ? "unavailable"
              : `${bytes(report.globalWal.bytes)} bytes`}
            .
          </p>
          <p>
            Raw experiment visits: {bytes(report.rawVisits.count)}; 29-day
            retention; visit relation{" "}
            {bytes(report.rawVisits.physicalRelationBytes)} bytes.
          </p>
          <p>
            Shared visit relation / live row:{" "}
            {report.rawVisits.sharedRelationBytesPerLiveRow === null
              ? "unavailable"
              : `${bytes(Math.round(report.rawVisits.sharedRelationBytesPerLiveRow))} bytes`}
            . This includes reusable pages and is not an attributable cost per
            visit.
          </p>
        </div>
      </PageSection>
      <PageSection title="Observed Watch traffic" meta="RECORDED REQUESTS ONLY">
        <div className="space-y-2 p-4 text-[13px]">
          <p>
            Last seven days: {bytes(report.observedTraffic.recordedRequests)}{" "}
            recorded below-player seeded requests and{" "}
            {bytes(report.observedTraffic.expectedItems)} expected cards;{" "}
            {report.observedTraffic.recordedRequestsPerDayAverage.toFixed(1)}{" "}
            requests/day average; largest UTC calendar group{" "}
            {bytes(
              report.observedTraffic.largestObservedUtcCalendarDayRequests,
            )}
            .
          </p>
          <p>
            Bot filtering is unverified. Eligible human visits/day: unavailable.
            First and last calendar groups may be partial.
          </p>
          <p>
            Twenty-nine-day recorded-request-equivalent scenario:{" "}
            {bytes(
              Math.round(
                report.retainedVolumeProjection
                  .recordedRequestEquivalent29DayAverage,
              ),
            )}{" "}
            requests if this seven-day rate continued. Retained byte projection:
            unqualified; verified eligibility, real generation bytes, and
            archive mix are missing.
          </p>
        </div>
      </PageSection>
      <PageSection title="Build and rollback overlap" meta="CURRENT INVENTORY">
        <div className="space-y-2 p-4 text-[13px]">
          <p>
            {bytes(report.buildRollbackOverlap.completeGenerations)} complete
            generations;{" "}
            {bytes(report.buildRollbackOverlap.newestTwoCompleteProtected)}{" "}
            protected as newest complete;{" "}
            {bytes(report.buildRollbackOverlap.rollbackHolds)} explicit rollback
            holds; {bytes(report.buildRollbackOverlap.activeBuilds)} active or
            capacity-blocked builds;{" "}
            {bytes(report.buildRollbackOverlap.retiringGenerations)} retiring.
          </p>
          <p>
            Active held reservations:{" "}
            {bytes(report.buildRollbackOverlap.activeReservationBytes)} bytes.
            These are reservations, not measured physical overlap; a rollback
            hold can also be one of the newest two. Physical
            build/retained/rollback overlap budget: unqualified.
          </p>
        </div>
      </PageSection>
      <PageSection title="Write and query impact" meta="LIVE EVIDENCE MISSING">
        <div className="space-y-2 p-4 text-[13px]">
          <p>
            Live feature write latency, source-read latency, and feature WAL
            bytes are not measured yet.
          </p>
          <p>
            Isolated local fixture receipt:{" "}
            <code className="break-all">
              {report.writeQueryImpact.localFixtureReceipt}
            </code>
            . Fixture timings are not production timings.
          </p>
        </div>
      </PageSection>
      <PageSection title="Inspect one generation" meta="READ ONLY">
        <form
          action="/dashboard/recommendations/precomputed/storage"
          method="get"
          className="flex min-w-0 gap-3 p-4"
        >
          <input
            name="generation"
            aria-label="Generation ID"
            maxLength={191}
            defaultValue={generationId}
            placeholder="Generation ID"
            className="min-w-0 w-full border border-[var(--color-hairline)] bg-transparent px-2 py-2 text-[13px]"
          />
          <button
            type="submit"
            className="shrink-0 border border-[var(--color-hairline)] px-3 py-2 text-[13px]"
          >
            Inspect
          </button>
        </form>
        {report.selectedGeneration ? (
          <div className="min-w-0 space-y-1 p-4 text-[13px]">
            <p className="break-all">
              {report.selectedGeneration.generationId}:{" "}
              {report.selectedGeneration.status}
            </p>
            <p>
              {bytes(report.selectedGeneration.sourceCount)} sources;{" "}
              {bytes(report.selectedGeneration.acceptedConnections)} accepted
              connections.
            </p>
            <p>
              Row-value estimate{" "}
              {bytes(report.selectedGeneration.inlineTupleBytes)} bytes;{" "}
              {report.selectedGeneration.inlineBytesPerConnection?.toFixed(1) ??
                "unknown"}{" "}
              bytes per accepted connection. This does not apportion TOAST,
              indexes, WAL, or dead space.
            </p>
          </div>
        ) : generationId ? (
          <p className="p-4 text-[13px]">Generation not found.</p>
        ) : null}
      </PageSection>
      <PageSection title="PostgreSQL relations" meta="PHYSICAL BYTES">
        <div className="min-w-0 overflow-x-auto p-4">
          <table className="min-w-[800px] text-left text-[12px]">
            <thead>
              <tr>
                <th>Relation</th>
                <th>Heap</th>
                <th>Indexes</th>
                <th>TOAST</th>
                <th>Auxiliary</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {report.relations.map((row) => (
                <tr
                  key={row.table}
                  className="border-t border-[var(--color-hairline)]"
                >
                  <td className="pr-4">{row.table}</td>
                  <td>{bytes(row.heapBytes)}</td>
                  <td>{bytes(row.indexBytes)}</td>
                  <td>{bytes(row.toastBytes)}</td>
                  <td>{bytes(row.auxBytes)}</td>
                  <td>{bytes(row.totalBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PageSection>
    </div>
  )
}
