import { displayRecommendationToken } from "./recommendation-display"

type SlateNomination = Readonly<{
  ordinal: number
  targetMediaId: string
  provenance: Readonly<Record<string, string | number>>
}>

export function ShadowSlateEvidence({
  nominations,
}: {
  nominations: readonly SlateNomination[]
}) {
  const rows = nominations.filter(
    (row) => typeof row.provenance?.slatePolicy === "string",
  )
  const summary = rows[0]?.provenance
  if (!summary) return null
  return (
    <details className="mt-4 rounded-sm border border-[var(--color-hairline)] p-3">
      <summary className="cursor-pointer text-[12px] font-medium">
        Composition policy comparison · decision pending
      </summary>
      <p className="mt-3 text-[12px] text-[var(--color-text-muted)]">
        This row comparison needs its own terminal decision before an
        experiment. The candidate evaluation decision above does not approve
        this composition policy. History:{" "}
        {displayRecommendationToken(
          String(summary.slateHistory ?? "unavailable"),
        )}
        . Published editorial constraints and weight calibration remain
        unavailable.
      </p>
      <p className="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">
        {summary.slatePolicy}
      </p>
      <p className="mt-2 text-[12px]">
        Source coverage {coverage(summary.slateSourceCoverage)} · interest
        coverage {coverage(summary.slateInterestCoverage)} · items with themes{" "}
        {coverage(summary.slateThemeCoverage)} · composition{" "}
        {summary.slateLatencyMs} ms · fallback{" "}
        {displayRecommendationToken(String(summary.slateFallback))}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[700px] border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-y border-[var(--color-hairline)] text-[var(--color-text-muted)]">
              <th className="px-3 py-2 font-medium">Candidate</th>
              <th className="px-3 py-2 font-medium">Item rank</th>
              <th className="px-3 py-2 font-medium">Composed position</th>
              <th className="px-3 py-2 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ ordinal, targetMediaId, provenance }) => (
              <tr
                key={ordinal}
                className="border-b border-[var(--color-hairline)] align-top"
              >
                <td className="break-all px-3 py-3 font-mono text-[10px]">
                  {targetMediaId}
                </td>
                <td className="px-3 py-3">{position(provenance.slateRank)}</td>
                <td className="px-3 py-3">
                  {position(provenance.slatePosition)}
                </td>
                <td className="px-3 py-3">
                  {String(provenance.slateReasons ?? "")
                    .split(",")
                    .map(displayRecommendationToken)
                    .join(" · ")}
                  {typeof provenance.slateScore === "number" ? (
                    <p className="mt-1 text-[var(--color-text-muted)]">
                      Policy score {provenance.slateScore.toFixed(3)} · theme
                      overlap {provenance.slateThemeSimilarity} · new sources{" "}
                      {provenance.slateSourceGain} · new interests{" "}
                      {provenance.slateInterestGain}
                    </p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function position(value: string | number | undefined): string | number {
  return typeof value === "number" ? value + 1 : "none"
}

function coverage(value: string | number | undefined): string | number {
  return value == null || value === "0/0" ? "not available" : value
}
