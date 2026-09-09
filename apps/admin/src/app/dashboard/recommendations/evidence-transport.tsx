import { PageSection } from "@/components/admin-ui"
import type { EvidenceTransportOverview } from "@/services/recommendations/admin-ops/evidence-transport.service"

export function EvidenceTransport({
  overview,
}: {
  overview: EvidenceTransportOverview
}) {
  return (
    <PageSection title="Evidence transport" meta="OPERATIONAL OBSERVATIONS">
      <div className="space-y-3 px-4 py-5 text-[13px] text-[var(--color-text-muted)]">
        <p>
          {overview.state === "unknown"
            ? "Unknown — the shared collector is unavailable or has no observations."
            : overview.state === "partial"
              ? "Partial observations — a source or some counts are missing."
              : "Web and Admin observations are present in this window."}
        </p>
        <p>
          Window: {overview.start.toISOString()} to {overview.end.toISOString()}
          . These best-effort counts do not prove committed playback or a
          production acceptance rate. Missing observations are not zero.
        </p>
        {overview.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <caption className="sr-only">
                Evidence transport observations by source, action and outcome
              </caption>
              <thead>
                <tr>
                  {[
                    "Source",
                    "Action",
                    "Outcome",
                    "Reason",
                    "HTTP",
                    "Timeout",
                    "Retry",
                    "Crawler",
                    "Count",
                  ].map((label) => (
                    <th
                      className="px-2 py-2 font-medium"
                      key={label}
                      scope="col"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overview.rows.map((row, index) => (
                  <tr key={index}>
                    <td className="px-2 py-2">{row.source}</td>
                    <td className="px-2 py-2">{row.action}</td>
                    <td className="px-2 py-2">{row.outcome}</td>
                    <td className="px-2 py-2">{row.reason}</td>
                    <td className="px-2 py-2">{row.httpStatus ?? "—"}</td>
                    <td className="px-2 py-2">{row.timeoutStage}</td>
                    <td className="px-2 py-2">
                      {row.retryDisposition} (
                      {row.retryAttempt === undefined
                        ? "unknown"
                        : row.retryAttempt === 4
                          ? "4+"
                          : row.retryAttempt}
                      )
                    </td>
                    <td className="px-2 py-2">{row.crawler}</td>
                    <td className="px-2 py-2">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {overview.suppressed && (
          <p>Groups with fewer than three observations are suppressed.</p>
        )}
        <p>
          Historical crawler attribution remains uncertain for September 7, 2026
          at 23:20 UTC through September 8 at 01:05 UTC. Aggregate crawler
          traffic cannot identify affected playback records. Existing evidence
          is unchanged.
        </p>
      </div>
    </PageSection>
  )
}
