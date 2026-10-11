import { PageSection, StatusPill } from "@/components/admin-ui"
import type { PrivateVisitDiagnostics } from "@/services/recommendations/precomputed/visit-admission"
import type { PrivatePrecomputedClickDiagnostics } from "@/services/recommendations/precomputed/visit-clicks"

export function PrivateVisitDiagnosticsView({
  report,
  clicks,
}: {
  report: PrivateVisitDiagnostics | null
  clicks: PrivatePrecomputedClickDiagnostics | null
}) {
  if (!report) return null
  if (report.status === "unavailable")
    return (
      <PageSection title="Measurement unavailable" meta="PRIVATE">
        <p className="p-4 text-[13px]">{report.reason}</p>
      </PageSection>
    )
  return (
    <>
      <PageSection title="Frozen assignment" meta="PRIVATE / RAW LIFECYCLE">
        <div className="space-y-2 p-4 text-[13px]">
          <StatusPill tone="warning">
            {report.status.replaceAll("_", " ")}
          </StatusPill>
          <p>
            Generation <code>{report.generationId}</code> · control{" "}
            <code>{report.controlManifestId}</code>
          </p>
          <p>
            Source set{" "}
            <code className="break-all">{report.sourceSetDigest}</code>
          </p>
          <p>
            Routing{" "}
            <code className="break-all">{report.controlRoutingDigest}</code>
          </p>
          <p>
            Configuration{" "}
            <code className="break-all">{report.configurationDigest}</code>
          </p>
          <p>
            Enrollment {report.startsAt.toISOString()} to{" "}
            {report.endsAt.toISOString()}
          </p>
          <p>
            Measurement qualification:{" "}
            {report.measurementQualification.replaceAll("_", " ")}. A
            browser/user-agent signal is not proof of a human visit.
          </p>
          {report.status === "incomplete_raw_window" ? (
            <p>
              The 29-day raw window is incomplete; these counts cannot describe
              the full test.
            </p>
          ) : null}
          <p>
            This diagnostic reads retained raw visits and can diverge from the
            durable CTR report after ordinary 29-day expiry. Use the versioned
            CTR report for the full fixed cohort.
          </p>
        </div>
      </PageSection>
      <PageSection
        title="Eligible visits"
        meta="DENOMINATOR INCLUDES ZERO CARDS"
      >
        <div className="overflow-x-auto p-4 text-[13px]">
          <table className="w-full min-w-max text-left [&_td]:pr-4 [&_th]:pr-4 [&_th]:whitespace-nowrap">
            <thead>
              <tr>
                <th>Arm</th>
                <th>Eligible</th>
                <th>Cards served</th>
                <th>Empty</th>
                <th>Unavailable</th>
                <th>Not attempted</th>
                <th>Technical fallback</th>
                <th>Fallback rate</th>
              </tr>
            </thead>
            <tbody>
              {(["control", "challenger"] as const).map((arm) => {
                const row = report.eligible.byArm[arm]
                return (
                  <tr
                    key={arm}
                    className="border-t border-[var(--color-hairline)]"
                  >
                    <th className="py-2">{arm}</th>
                    <td>{row.total}</td>
                    <td>{row.served}</td>
                    <td>{row.empty}</td>
                    <td>{row.unavailable}</td>
                    <td>{row.notAttempted}</td>
                    <td>{row.fallback}</td>
                    <td>
                      {row.total
                        ? `${((100 * row.fallback) / row.total).toFixed(1)}%`
                        : "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </PageSection>
      <PageSection title="Excluded visits" meta="NOT IN DENOMINATOR">
        <p className="p-4 text-[13px]">
          {report.excluded.total} total · {report.excluded.automation} declared
          automation · {report.excluded.preview} preview/not enrolled ·{" "}
          {report.excluded.unknownSignal} unknown signal ·{" "}
          {report.excluded.outsideCohort} outside frozen cohort ·{" "}
          {report.excluded.other} other
        </p>
      </PageSection>
      {clicks?.status === "unavailable" ? (
        <PageSection title="Click measurement unavailable" meta="PRIVATE">
          <p className="p-4 text-[13px]">{clicks.reason}</p>
        </PageSection>
      ) : clicks ? (
        <>
          <PageSection
            title="Recommendation clicks"
            meta="DISTINCT ELIGIBLE WATCH VISITS"
          >
            <div className="space-y-3 overflow-x-auto p-4 text-[13px]">
              <p>
                Clicked visits include accepted selections without a qualified
                impression. Card CTR uses qualified impressions only. Lost
                browser events are {clicks.measurementLoss.replaceAll("_", " ")}{" "}
                and cannot be measured as zero engagement; bot qualification
                remains unverified. Disabling personalization does not remove
                contextual clicks from these counts. Reset or deletion clears
                the private browser identity used by subsequent requests.
              </p>
              {clicks.status === "incomplete_raw_window" ? (
                <p>The 29-day raw evidence window is incomplete.</p>
              ) : null}
              <table className="w-full min-w-max text-left [&_td]:pr-4 [&_th]:pr-4 [&_th]:whitespace-nowrap">
                <thead>
                  <tr>
                    <th>Arm</th>
                    <th>Eligible visits</th>
                    <th>Clicked visits</th>
                    <th>Visit click rate</th>
                    <th>Selections</th>
                    <th>Qualified impressions</th>
                    <th>Card CTR</th>
                    <th>Without impression</th>
                    <th>Unlinked deliveries</th>
                  </tr>
                </thead>
                <tbody>
                  {(["control", "challenger"] as const).map((arm) => {
                    const row = clicks.byArm[arm]
                    return (
                      <tr
                        key={arm}
                        className="border-t border-[var(--color-hairline)]"
                      >
                        <th className="py-2">{arm}</th>
                        <td>{row.eligibleVisits}</td>
                        <td>{row.clickedVisits}</td>
                        <td>
                          {row.eligibleVisits
                            ? `${((100 * row.clickedVisits) / row.eligibleVisits).toFixed(1)}%`
                            : "—"}
                        </td>
                        <td>{row.acceptedSelections}</td>
                        <td>{row.qualifiedImpressions}</td>
                        <td>
                          {row.cardCtr == null
                            ? "—"
                            : `${(100 * row.cardCtr).toFixed(1)}%`}
                        </td>
                        <td>{row.unmatchedSelections}</td>
                        <td>{row.unlinkedDeliveredVisits}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </PageSection>
          {clicks.recentCards ? (
            <PageSection title="Recent accepted cards" meta="LAST 25 / PRIVATE">
              <div className="overflow-x-auto p-4 text-[13px]">
                <table className="w-full min-w-max text-left [&_td]:pr-4 [&_th]:pr-4 [&_th]:whitespace-nowrap">
                  <thead>
                    <tr>
                      <th>Received</th>
                      <th>Visit / arm</th>
                      <th>Generation</th>
                      <th>Request / item</th>
                      <th>Position / target</th>
                      <th>Actual strategy</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clicks.recentCards.map((card) => (
                      <tr
                        key={card.itemId}
                        className="border-t border-[var(--color-hairline)]"
                      >
                        <td className="py-2">
                          {card.receivedAt.toISOString()}
                        </td>
                        <td>
                          <code>{card.visitId}</code> · {card.assignedArm}
                        </td>
                        <td>
                          <code>{card.generationId}</code>
                        </td>
                        <td>
                          <code>{card.requestId}</code> /{" "}
                          <code>{card.itemId}</code>
                        </td>
                        <td>
                          {card.position} · <code>{card.targetMediaId}</code>
                        </td>
                        <td>
                          <code>{card.actualStrategy}</code>
                          {card.privateFallback ? " · private fallback" : ""}
                          {card.fallbackReason
                            ? ` · matched visit-summary reason: ${card.fallbackReason}`
                            : card.privateFallback
                              ? " · reason unavailable for this request"
                              : ""}
                        </td>
                        <td>
                          {card.rendered ? "rendered" : "no render"} ·{" "}
                          {card.qualifiedImpression
                            ? "qualified impression"
                            : "no qualified impression"}{" "}
                          ·{" "}
                          {card.playbackClaimed
                            ? "playback claimed"
                            : "no claim"}
                          {card.late ? " · late" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!clicks.recentCards.length ? (
                  <p>No accepted cards yet.</p>
                ) : null}
              </div>
            </PageSection>
          ) : null}
        </>
      ) : null}
    </>
  )
}
