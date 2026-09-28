import { PageSection } from "@/components/admin-ui"
import type {
  WatchExposureBreakdown,
  WatchExposureRegistryFilter,
} from "@/services/recommendations/admin-ops/watch-exposure.service"
import { WATCH_EXPOSURE_REGISTRY } from "@/services/recommendations/watch-surface-registry"

function registryEntryKey(entry: WatchExposureRegistryFilter): string {
  return `${entry.surface}:${entry.block}:${entry.presentation}`
}

export function resolveWatchExposureInspectionFilter(
  rawEntry?: string | string[],
  rawPlacement?: string | string[],
) {
  const entryKey = typeof rawEntry === "string" ? rawEntry : ""
  const placement = typeof rawPlacement === "string" ? rawPlacement : ""
  const entry = WATCH_EXPOSURE_REGISTRY.find(
    (candidate) => registryEntryKey(candidate) === entryKey,
  )
  const invalid =
    Array.isArray(rawEntry) ||
    Array.isArray(rawPlacement) ||
    (entryKey !== "" && !entry) ||
    (placement !== "" && (!entry || !/^[a-zA-Z0-9_-]{1,64}$/.test(placement)))
  const filter: WatchExposureRegistryFilter | undefined = entry
    ? {
        surface: entry.surface,
        block: entry.block,
        presentation: entry.presentation,
        ...(placement ? { placement } : {}),
      }
    : undefined
  return { entryKey, placement, filter, invalid }
}

export function WatchExposureInspection({
  rows,
  truncated,
  replays,
  window,
  selection,
}: {
  rows: WatchExposureBreakdown[] | null
  truncated: boolean
  replays: number | null
  window: "24h" | "7d" | "29d"
  selection: ReturnType<typeof resolveWatchExposureInspectionFilter>
}) {
  const complete = WATCH_EXPOSURE_REGISTRY.filter(
    (entry) => entry.complete,
  ).length
  return (
    <PageSection title="Watch surface exposure" meta="MEASUREMENT / PARTIAL">
      <div className="space-y-3 px-4 py-4 text-[13px]">
        <form method="get" className="grid gap-3 md:grid-cols-3">
          <input type="hidden" name="window" value={window} />
          <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
            Registry entry
            <select
              name="exposure"
              defaultValue={selection.entryKey}
              className="h-9 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 text-[12px] text-[var(--color-text-primary)]"
            >
              <option value="">All entries</option>
              {WATCH_EXPOSURE_REGISTRY.map((entry) => (
                <option
                  key={registryEntryKey(entry)}
                  value={registryEntryKey(entry)}
                >
                  {entry.surface} / {entry.block} / {entry.presentation}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
            Placement (optional for one entry)
            <input
              name="exposurePlacement"
              defaultValue={selection.placement}
              maxLength={64}
              pattern="[a-zA-Z0-9_-]{1,64}"
              className="h-9 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 text-[12px] text-[var(--color-text-primary)]"
            />
          </label>
          <button
            type="submit"
            className="mt-auto h-9 rounded-sm bg-[var(--color-brand)] px-3 text-[12px] font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            Inspect exposure
          </button>
        </form>
        {selection.invalid && (
          <p role="status">
            Choose a registered entry and a valid optional placement. Counts are
            withheld.
          </p>
        )}
        {selection.filter && !selection.invalid && (
          <p>
            Exposure rows are scoped to the selected registry entry
            {selection.placement ? ` and placement ${selection.placement}` : ""}
            . Overview and replay counts retain the selected time window.
          </p>
        )}
        <p>
          Registry completeness: {complete}/{WATCH_EXPOSURE_REGISTRY.length}{" "}
          click-bearing surface/presentation entries. Missing facts have unknown
          counts, not measured zero. V2 anonymous served counts measure
          origin-issued card manifests after ordinary activation, separately
          from cached HTML responses. Legacy V1 facts have unknown served
          counts. CTR is eligible selections / eligible impressions for
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
            table. Select a registry entry and, if needed, placement to inspect
            a narrower cohort.
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
                    key={`${row.surface}:${row.block}:${row.presentation}:${row.placement}:${row.policyVersion}:${row.position}`}
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
                <li
                  key={`${entry.surface}:${entry.block}:${entry.presentation}`}
                >
                  {entry.surface} / {entry.block} / {entry.presentation}:{" "}
                  {entry.instrumented
                    ? "origin-issued manifest measurement available for V2; legacy V1 served unknown; deployed reconciliation pending"
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
