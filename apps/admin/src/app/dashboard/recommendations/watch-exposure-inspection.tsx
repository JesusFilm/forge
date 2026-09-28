import { PageSection } from "@/components/admin-ui"
import type { WatchExposureBreakdown } from "@/services/recommendations/admin-ops/watch-exposure.service"
import { WATCH_EXPOSURE_REGISTRY } from "@/services/recommendations/watch-surface-registry"

export function WatchExposureInspection({
  rows,
  truncated,
  replays,
}: {
  rows: WatchExposureBreakdown[] | null
  truncated: boolean
  replays: number | null
}) {
  const complete = WATCH_EXPOSURE_REGISTRY.filter(
    (entry) => entry.complete,
  ).length
  return (
    <PageSection title="Watch surface exposure" meta="MEASUREMENT / PARTIAL">
      <div className="space-y-3 px-4 py-4 text-[13px]">
        <p>
          Registry completeness: {complete}/{WATCH_EXPOSURE_REGISTRY.length}{" "}
          click-bearing surface/presentation entries. Missing facts have unknown
          counts, not measured zero. Anonymous authored surfaces collect render,
          eligible, and selection evidence but have no server-issued served
          count. CTR is eligible selections / eligible impressions for
          inspection only; it is not a ranking objective.
        </p>
        <p>
          Signed delivery evidence replay count, all positions:{" "}
          {replays ?? "unknown"}. A matching signed replay rate is unavailable
          because the replay audit combines rendered and impression attempts
          without position. Per-row anonymous replay rate is cumulative for
          facts in this window and may include retries received after the
          cutoff; repeats are shown separately.
        </p>
        {truncated && (
          <p role="status">
            Anonymous breakdown exceeds 128 groups in this window. Rows shown
            are truncated; totals and coverage cannot be inferred from this
            table.
          </p>
        )}
        {rows === null ? (
          <p>Exposure aggregation unavailable. Counts are withheld.</p>
        ) : rows.length === 0 ? (
          <p>No measured Watch exposure events in this window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className="p-2">Surface / block / presentation</th>
                  <th className="p-2">Placement / policy</th>
                  <th className="p-2">Position</th>
                  <th className="p-2">Served</th>
                  <th className="p-2">Rendered</th>
                  <th className="p-2">Eligible</th>
                  <th className="p-2">Selected</th>
                  <th className="p-2">Eligible selections</th>
                  <th className="p-2">CTR</th>
                  <th className="p-2">Early selections</th>
                  <th className="p-2">Repeats</th>
                  <th className="p-2">Replay rate to date</th>
                  <th className="p-2">Visibility V2 / unknown</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.surface}:${row.block}:${row.placement}:${row.policyVersion}:${row.position}`}
                  >
                    <td className="p-2">
                      {row.surface} / {row.block} / {row.presentation}
                    </td>
                    <td className="p-2">
                      {row.placement} / {row.policyVersion}
                    </td>
                    <td className="p-2">{row.position}</td>
                    <td className="p-2">{row.served ?? "unknown"}</td>
                    <td className="p-2">{row.rendered}</td>
                    <td className="p-2">{row.eligible}</td>
                    <td className="p-2">{row.selected}</td>
                    <td className="p-2">{row.eligibleSelected}</td>
                    <td className="p-2">
                      {row.ctr == null
                        ? "undefined"
                        : `${(row.ctr * 100).toFixed(1)}%`}
                    </td>
                    <td className="p-2">{row.selectionWithoutImpression}</td>
                    <td className="p-2">{row.repeats ?? "not attributable"}</td>
                    <td className="p-2">
                      {row.duplicateRate == null
                        ? "not attributable"
                        : `${(row.duplicateRate * 100).toFixed(1)}%`}
                    </td>
                    <td className="p-2">
                      {row.occlusionAware} / {row.visibilityUnknown}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div>
          <p className="font-semibold">Instrumentation gaps</p>
          <ul className="list-disc pl-5">
            {WATCH_EXPOSURE_REGISTRY.filter((entry) => !entry.complete).map(
              (entry) => (
                <li key={`${entry.surface}:${entry.block}`}>
                  {entry.surface} / {entry.block} / {entry.presentation}:{" "}
                  {entry.instrumented
                    ? "render/eligible/selection measured; server-issued served count missing"
                    : "no durable exposure contract yet"}
                </li>
              ),
            )}
          </ul>
        </div>
      </div>
    </PageSection>
  )
}
