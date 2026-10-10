"use client"

import { AlertTriangle, Beaker, FileText, Plus } from "lucide-react"
import { useState, type FormEvent } from "react"

import { apiFetch } from "@/lib/api-fetch"

import {
  comparisonEvidenceWarnings,
  formatSubtitleLabDate,
} from "./subtitle-lab-operator-presenter"
import type { SubtitleLabComparison } from "./subtitle-lab-operator-types"

const INPUT =
  "min-h-11 w-full rounded-[var(--ds-radius)] border border-[color:var(--ds-line-strong)] bg-[color:var(--ds-panel)] px-3 py-2 text-sm text-[color:var(--ds-ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ds-black)]"
const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--ds-radius)] border border-[color:var(--ds-black)] bg-[color:var(--ds-black)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"

type DeltaMetric = { metric: string; sampleCount: number; meanDelta: number }
type DeltaGroup = { key: string; sampleCount: number; metrics: DeltaMetric[] }

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseGroups(value: unknown): DeltaGroup[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 50).flatMap((candidate) => {
    const group = record(candidate)
    if (!group || typeof group.key !== "string") return []
    const sampleCount =
      typeof group.sampleCount === "number" && group.sampleCount >= 0
        ? group.sampleCount
        : 0
    const metrics = Array.isArray(group.metrics)
      ? group.metrics.slice(0, 100).flatMap((rawMetric) => {
          const metric = record(rawMetric)
          if (
            !metric ||
            typeof metric.metric !== "string" ||
            typeof metric.meanDelta !== "number" ||
            !Number.isFinite(metric.meanDelta)
          ) {
            return []
          }
          return [
            {
              metric: metric.metric,
              sampleCount:
                typeof metric.sampleCount === "number"
                  ? metric.sampleCount
                  : sampleCount,
              meanDelta: metric.meanDelta,
            },
          ]
        })
      : []
    return [{ key: group.key, sampleCount, metrics }]
  })
}

function comparisonGroups(value: unknown) {
  const root = record(value)
  if (root) {
    return {
      byLanguage: parseGroups(root.byLanguage),
      byCollection: parseGroups(root.byCollection),
    }
  }
  // Compatibility for early fixture/report projections that emitted one
  // scope-tagged list before the canonical grouped object was introduced.
  const flat = Array.isArray(value) ? value : []
  return {
    byLanguage: parseGroups(
      flat.filter((entry) => record(entry)?.scope === "language"),
    ),
    byCollection: parseGroups(
      flat.filter((entry) => record(entry)?.scope === "collection"),
    ),
  }
}

function humanComparison(value: unknown) {
  const root = record(value)
  const cells = Array.isArray(root?.cells)
    ? root.cells.slice(0, 100).flatMap((candidate) => {
        const cell = record(candidate)
        const baseline = record(cell?.baseline)
        const next = record(cell?.candidate)
        if (!cell || typeof cell.key !== "string") return []
        return [
          {
            key: cell.key,
            status: typeof cell.status === "string" ? cell.status : "UNKNOWN",
            baselineVerdicts: record(baseline?.verdictCounts) ?? {},
            candidateVerdicts: record(next?.verdictCounts) ?? {},
          },
        ]
      })
    : []
  const parseHumanGroups = (groups: unknown) =>
    !Array.isArray(groups)
      ? []
      : groups.slice(0, 50).flatMap((candidate) => {
          const group = record(candidate)
          if (!group || typeof group.key !== "string") return []
          const scoreDeltas = Array.isArray(group.scoreDeltas)
            ? group.scoreDeltas
            : []
          return [
            {
              key: group.key,
              sampleCount:
                typeof group.reviewedPairCount === "number"
                  ? group.reviewedPairCount
                  : 0,
              metrics:
                parseGroups([
                  {
                    key: group.key,
                    sampleCount: group.reviewedPairCount,
                    metrics: scoreDeltas,
                  },
                ])[0]?.metrics ?? [],
            },
          ]
        })
  return {
    reviewedPairCount:
      typeof root?.reviewedPairCount === "number" ? root.reviewedPairCount : 0,
    pendingPairCount:
      typeof root?.pendingPairCount === "number" ? root.pendingPairCount : 0,
    unmatchedPairCount:
      typeof root?.unmatchedPairCount === "number"
        ? root.unmatchedPairCount
        : 0,
    cells,
    byLanguage: parseHumanGroups(root?.byLanguage),
    byCollection: parseHumanGroups(root?.byCollection),
  }
}

function formatVerdictCounts(counts: Record<string, unknown>) {
  const labels = Object.entries(counts)
    .filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isInteger(entry[1]),
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([verdict, count]) => `${verdict.replaceAll("_", " ")}: ${count}`)
  return labels.length > 0 ? labels.join(" · ") : "Pending"
}

function DeltaTable({
  groups,
  title,
}: {
  groups: DeltaGroup[]
  title: string
}) {
  return (
    <section
      aria-labelledby={`comparison-${title.toLowerCase().replaceAll(" ", "-")}`}
    >
      <h3
        className="text-base font-semibold"
        id={`comparison-${title.toLowerCase().replaceAll(" ", "-")}`}
      >
        {title}
      </h3>
      {groups.length === 0 ? (
        <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
          No matched numeric evidence in this scope.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-[var(--ds-radius)] border border-[color:var(--ds-line)]">
          <table className="w-full min-w-[620px] border-collapse text-left text-sm">
            <thead className="bg-[color:var(--ds-hover)] text-xs uppercase tracking-wide text-[color:var(--ds-muted)]">
              <tr>
                <th className="px-3 py-2">Group</th>
                <th className="px-3 py-2">Metric</th>
                <th className="px-3 py-2">Matched n</th>
                <th className="px-3 py-2">Candidate − baseline</th>
              </tr>
            </thead>
            <tbody>
              {groups.flatMap((group) =>
                group.metrics.map((metric) => (
                  <tr
                    className="border-t border-[color:var(--ds-line)]"
                    key={`${group.key}:${metric.metric}`}
                  >
                    <td className="px-3 py-2" dir="auto">
                      {group.key}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {metric.metric}
                    </td>
                    <td className="px-3 py-2">{metric.sampleCount}</td>
                    <td className="px-3 py-2 font-mono">
                      {metric.meanDelta > 0 ? "+" : ""}
                      {metric.meanDelta.toFixed(3)}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function SubtitleRunComparison({
  comparison,
}: {
  comparison: SubtitleLabComparison
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const groups = comparisonGroups(comparison.descriptiveDeltas)
  const human = humanComparison(comparison.humanEvidence)
  const warnings = comparisonEvidenceWarnings(comparison)

  async function appendNarrative(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSubmitting(true)
    setMessage(null)
    const response = await apiFetch(
      `/api/subtitle-lab/comparisons/${encodeURIComponent(comparison.id)}/narratives`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hypothesis: String(form.get("hypothesis") ?? ""),
          conclusion: String(form.get("conclusion") ?? "") || null,
          rationale: String(form.get("rationale") ?? "") || null,
          followUpAction: String(form.get("followUpAction") ?? "") || null,
        }),
      },
    ).catch(() => null)
    setSubmitting(false)
    setMessage(
      response?.ok
        ? "Experiment narrative appended. Reload to see the new immutable version."
        : "Narrative was not recorded.",
    )
  }

  return (
    <article className="grid gap-5" aria-labelledby="comparison-title">
      <header className="rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="studio-page-eyebrow">Matched-cell evidence</span>
            <h2 className="mt-1 text-xl font-semibold" id="comparison-title">
              Run comparison
            </h2>
            <p className="mt-1 break-all font-mono text-xs text-[color:var(--ds-muted)]">
              {comparison.id}
            </p>
          </div>
          <span className="rounded-full border border-[color:var(--ds-line-strong)] px-3 py-1 text-xs font-semibold">
            {comparison.coverageLabel.replaceAll("_", " ")}
          </span>
        </div>
        <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold uppercase text-[color:var(--ds-muted)]">
              Declared changed axis
            </dt>
            <dd className="mt-1 font-semibold">
              {comparison.changedAxis.replaceAll("_", " ")}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-[color:var(--ds-muted)]">
              Matched cells
            </dt>
            <dd className="mt-1">{comparison.matchedCellCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-[color:var(--ds-muted)]">
              Collections
            </dt>
            <dd className="mt-1">{comparison.matchedCollectionCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-[color:var(--ds-muted)]">
              Reports
            </dt>
            <dd className="mt-1 break-all font-mono text-xs">
              {comparison.baselineReportId} → {comparison.candidateReportId}
            </dd>
          </div>
        </dl>
      </header>

      <section
        className="rounded-[var(--ds-radius)] border border-[color:var(--ds-line-strong)] bg-[color:var(--ds-hover)] p-4"
        aria-label="Comparison evidence warnings"
      >
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle aria-hidden="true" size={18} /> Evidence limits
        </div>
        <ul className="mt-2 grid gap-1 pl-5 text-sm text-[color:var(--ds-muted)]">
          {warnings.map((warning) => (
            <li className="list-disc" key={warning}>
              {warning}
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <DeltaTable groups={groups.byLanguage} title="Per-language deltas" />
        <DeltaTable
          groups={groups.byCollection}
          title="Per-collection deltas"
        />
      </div>

      <section className="rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] p-5">
        <h3 className="text-base font-semibold">Human validation evidence</h3>
        <p className="mt-1 text-sm text-[color:var(--ds-muted)]">
          Live latest non-superseded reviews: {human.reviewedPairCount} reviewed
          pairs, {human.pendingPairCount} pending, {human.unmatchedPairCount}
          unmatched. These scores are separate from frozen machine metrics.
        </p>
        <div className="mt-4 grid gap-5 xl:grid-cols-2">
          <DeltaTable
            groups={human.byLanguage}
            title="Human scores by language"
          />
          <DeltaTable
            groups={human.byCollection}
            title="Human scores by collection"
          />
        </div>
        {human.cells.length > 0 ? (
          <div className="mt-5 overflow-x-auto rounded-[var(--ds-radius)] border border-[color:var(--ds-line)]">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead className="bg-[color:var(--ds-hover)] text-xs uppercase tracking-wide text-[color:var(--ds-muted)]">
                <tr>
                  <th className="px-3 py-2">Cell</th>
                  <th className="px-3 py-2">Review state</th>
                  <th className="px-3 py-2">Baseline verdicts</th>
                  <th className="px-3 py-2">Candidate verdicts</th>
                </tr>
              </thead>
              <tbody>
                {human.cells.map((cell) => (
                  <tr
                    className="border-t border-[color:var(--ds-line)]"
                    key={cell.key}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{cell.key}</td>
                    <td className="px-3 py-2">{cell.status}</td>
                    <td className="px-3 py-2">
                      {formatVerdictCounts(cell.baselineVerdicts)}
                    </td>
                    <td className="px-3 py-2">
                      {formatVerdictCounts(cell.candidateVerdicts)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="experiment-narratives">
        <div className="flex items-center gap-2">
          <FileText aria-hidden="true" size={18} />
          <h3 className="text-base font-semibold" id="experiment-narratives">
            Experiment narratives
          </h3>
        </div>
        <div className="mt-3 grid gap-3">
          {comparison.narratives.length === 0 ? (
            <p className="text-sm text-[color:var(--ds-muted)]">
              No interpretation has been appended yet.
            </p>
          ) : (
            comparison.narratives.map((narrative) => (
              <article
                className="rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] p-4"
                key={narrative.id}
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>Version {narrative.version}</strong>
                  <span className="text-xs text-[color:var(--ds-muted)]">
                    {formatSubtitleLabDate(narrative.createdAt)}
                  </span>
                </div>
                <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                  <div>
                    <dt className="font-semibold">Hypothesis</dt>
                    <dd className="mt-1" dir="auto">
                      {narrative.hypothesis}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Conclusion</dt>
                    <dd className="mt-1" dir="auto">
                      {narrative.conclusion ?? "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Rationale</dt>
                    <dd className="mt-1" dir="auto">
                      {narrative.rationale ?? "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Follow-up</dt>
                    <dd className="mt-1" dir="auto">
                      {narrative.followUpAction ?? "Not recorded"}
                    </dd>
                  </div>
                </dl>
              </article>
            ))
          )}
        </div>
      </section>

      <form
        className="rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] p-4"
        onSubmit={appendNarrative}
      >
        <div className="flex items-center gap-2">
          <Beaker aria-hidden="true" size={18} />
          <h3 className="font-semibold">Append experiment narrative</h3>
        </div>
        <p className="mt-1 text-xs text-[color:var(--ds-muted)]">
          Interpretation appends; it cannot change evidence or activate the
          candidate.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium">
            Pre-run hypothesis
            <textarea
              className={`${INPUT} mt-1 min-h-24`}
              maxLength={4000}
              name="hypothesis"
              required
            />
          </label>
          <label className="text-sm font-medium">
            Post-review conclusion
            <textarea
              className={`${INPUT} mt-1 min-h-24`}
              maxLength={4000}
              name="conclusion"
            />
          </label>
          <label className="text-sm font-medium">
            Decision rationale
            <textarea
              className={`${INPUT} mt-1 min-h-24`}
              maxLength={4000}
              name="rationale"
            />
          </label>
          <label className="text-sm font-medium">
            Follow-up action
            <textarea
              className={`${INPUT} mt-1 min-h-24`}
              maxLength={4000}
              name="followUpAction"
            />
          </label>
        </div>
        <button
          className={`${BUTTON} mt-4`}
          disabled={submitting}
          type="submit"
        >
          <Plus aria-hidden="true" size={17} /> Append narrative
        </button>
        {message ? (
          <p className="mt-3 text-sm" role="status">
            {message}
          </p>
        ) : null}
      </form>
    </article>
  )
}
