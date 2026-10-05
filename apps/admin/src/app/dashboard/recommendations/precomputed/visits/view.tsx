import { PageSection, StatusPill } from "@/components/admin-ui"
import type { PrivateVisitDiagnostics } from "@/services/recommendations/precomputed/visit-admission"

export function PrivateVisitDiagnosticsView({
  report,
}: {
  report: PrivateVisitDiagnostics | null
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
      <PageSection title="Frozen assignment" meta="PRIVATE / OBSERVED">
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
        </div>
      </PageSection>
      <PageSection
        title="Eligible visits"
        meta="DENOMINATOR INCLUDES ZERO CARDS"
      >
        <div className="overflow-x-auto p-4 text-[13px]">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>Arm</th>
                <th>Eligible</th>
                <th>Cards served</th>
                <th>Empty</th>
                <th>Unavailable</th>
                <th>Not attempted</th>
                <th>Technical fallback</th>
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
    </>
  )
}
