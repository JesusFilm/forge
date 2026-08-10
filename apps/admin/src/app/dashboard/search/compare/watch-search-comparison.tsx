"use client"

import { useActionState } from "react"

import { PrimaryButton, StatusPill } from "@/components/admin-ui"

import {
  runWatchSearchComparison,
  type WatchSearchComparisonActionState,
  type WatchSearchComparisonView,
} from "./comparison-actions"

const initialState: WatchSearchComparisonActionState = { status: "idle" }

function displayToken(value: string | null | undefined) {
  return value?.replaceAll("_", " ").replaceAll("-", " ") ?? "None"
}

function ResultPane({
  label,
  side,
}: {
  label: "Current" | "Candidate"
  side: WatchSearchComparisonView["current"]
}) {
  if (side.status === "error") {
    return (
      <div className="min-w-0 rounded-sm border border-[var(--color-danger-border)] bg-[var(--color-surface)] p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">{label}</h3>
          <StatusPill tone="danger">Failed</StatusPill>
        </div>
        <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
          {label} search failed. The other pane remains valid.
        </p>
        <div className="mono-meta mt-2 text-[var(--color-text-muted)]">
          {side.error.code} / {side.error.errorClass}
        </div>
      </div>
    )
  }

  const { response, diagnostics } = side
  return (
    <div className="min-w-0 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-hairline)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">{label}</h3>
          <StatusPill tone={response.degraded ? "warning" : "success"}>
            {response.degraded ? "Degraded" : "Complete"}
          </StatusPill>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs lg:grid-cols-3">
          <Metric label="Version" value={diagnostics.profile} />
          <Metric
            label="Generation"
            value={diagnostics.generationId ?? "Current"}
          />
          <Metric
            label="App revision"
            value={diagnostics.applicationRevision ?? "Current"}
          />
          <Metric
            label="Target"
            value={response.languageInterpretation.targetLanguageSlug}
          />
          <Metric
            label="Latency"
            value={`${response.latencyMs.toFixed(1)} ms`}
          />
          <Metric
            label="Typesense wall"
            value={`${diagnostics.typesenseWallTimeMs.toFixed(1)} ms`}
          />
          <Metric
            label="Calls / lanes"
            value={`${diagnostics.retrievalCalls} / ${diagnostics.logicalSubsearches}`}
          />
          <Metric
            label="Candidates / hydrated"
            value={`${diagnostics.candidates} / ${diagnostics.hydratedRecords}`}
          />
          <Metric
            label="Fields / grouped hits"
            value={`${diagnostics.queryFieldCount} / ${diagnostics.groupedHits}`}
          />
          <Metric
            label="Engine / retries"
            value={`${diagnostics.typesenseSearchTimeMs} ms / ${diagnostics.retryCount}`}
          />
          <Metric
            label="Request / response"
            value={`${diagnostics.requestBytes} B / ${diagnostics.parsedResponseBytes} B`}
          />
        </dl>
        <details className="mt-3 text-xs text-[var(--color-text-muted)]">
          <summary className="cursor-pointer font-mono uppercase">
            Exact binding
          </summary>
          <div className="mt-2 break-all font-mono">
            {Object.entries(diagnostics.binding).map(([role, collection]) => (
              <div key={role}>
                {role}: {collection}
              </div>
            ))}
          </div>
        </details>
        <details className="mt-3 text-xs text-[var(--color-text-muted)]">
          <summary className="cursor-pointer font-mono uppercase">
            Lane outcomes
          </summary>
          <div className="mt-2 space-y-1 font-mono">
            {response.laneStatuses.length === 0 ? (
              <div>No lane events</div>
            ) : (
              response.laneStatuses.map((lane) => (
                <div key={`${lane.lane}-${lane.startedOffsetMs}`}>
                  {lane.lane}: {lane.status} / {lane.elapsedMs.toFixed(1)} ms /{" "}
                  {lane.resultCount} results
                  {lane.detail ? ` / ${lane.detail}` : ""}
                  {lane.reason ? ` / ${lane.reason}` : ""}
                </div>
              ))
            )}
          </div>
        </details>
      </div>

      <div className="divide-y divide-[var(--color-hairline)]">
        {response.results.length === 0 ? (
          <div className="p-4 text-sm text-[var(--color-text-muted)]">
            No results
          </div>
        ) : (
          response.results.map((result, index) => (
            <article key={`${result.type}-${result.id}`} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="mono-meta text-[var(--color-text-muted)]">
                    #{index + 1} / {result.type} / video ID {result.id}
                  </div>
                  <h4 className="mt-1 truncate font-medium">{result.title}</h4>
                </div>
                <div className="font-mono text-xs">
                  {result.score.toFixed(3)}
                </div>
              </div>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <Metric
                  label="Content language"
                  value={
                    result.languageEnglishName ??
                    displayToken(result.languageSlug)
                  }
                />
                <Metric
                  label="Evidence"
                  value={`${displayToken(result.evidence.kind)} / ${displayToken(result.evidence.languageSlug)}`}
                />
                <Metric
                  label="Playback"
                  value={`${displayToken(result.availability.kind)} / ${displayToken(result.availability.languageSlug)}`}
                />
                <Metric
                  label="Action language"
                  value={displayToken(result.action.hrefLanguageSlug)}
                />
                <Metric
                  label="Playback ID"
                  value={result.playbackId ?? "Unavailable"}
                />
              </dl>
            </article>
          ))
        )}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono uppercase text-[var(--color-text-muted)]">
        {label}
      </dt>
      <dd className="truncate text-[var(--color-text-secondary)]" title={value}>
        {value}
      </dd>
    </div>
  )
}

export function WatchSearchComparisonPanes({
  result,
}: {
  result: WatchSearchComparisonView
}) {
  return (
    <div>
      <div className="border-b border-[var(--color-hairline)] px-4 py-3 font-mono text-[11px] text-[var(--color-text-muted)]">
        Comparison {result.comparisonId}
      </div>
      <div className="grid gap-4 p-4 xl:grid-cols-2">
        <ResultPane label="Current" side={result.current} />
        <ResultPane label="Candidate" side={result.candidate} />
      </div>
    </div>
  )
}

export function WatchSearchComparison() {
  const [state, action, pending] = useActionState(
    runWatchSearchComparison,
    initialState,
  )

  return (
    <div>
      <form
        action={action}
        className="grid gap-3 border-b border-[var(--color-hairline)] p-4 md:grid-cols-2 xl:grid-cols-6"
      >
        <label className="md:col-span-2 xl:col-span-2">
          <span className="label-text">Query</span>
          <input
            name="query"
            required
            maxLength={200}
            className="mt-1 w-full rounded-sm border border-[var(--color-hairline)] bg-[var(--color-background)] px-3 py-2"
          />
        </label>
        <label>
          <span className="label-text">Target language slug</span>
          <input
            name="targetLanguageSlug"
            maxLength={128}
            placeholder="japanese"
            className="mt-1 w-full rounded-sm border border-[var(--color-hairline)] bg-[var(--color-background)] px-3 py-2"
          />
        </label>
        <label>
          <span className="label-text">Locale</span>
          <input
            name="locale"
            maxLength={32}
            placeholder="ja-JP"
            className="mt-1 w-full rounded-sm border border-[var(--color-hairline)] bg-[var(--color-background)] px-3 py-2"
          />
        </label>
        <label>
          <span className="label-text">Results</span>
          <select
            name="perPage"
            defaultValue="10"
            className="mt-1 w-full rounded-sm border border-[var(--color-hairline)] bg-[var(--color-background)] px-3 py-2"
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
          </select>
        </label>
        <input type="hidden" name="page" value="1" />
        <input type="hidden" name="contentType" value="video" />
        <div className="flex items-end">
          <PrimaryButton type="submit" disabled={pending}>
            {pending ? "Comparing…" : "Compare"}
          </PrimaryButton>
        </div>
      </form>
      {state.status === "error" ? (
        <div
          role="alert"
          className="border-b border-[var(--color-danger-border)] px-4 py-3 text-sm text-[var(--color-danger)]"
        >
          {state.message}
        </div>
      ) : null}
      {state.status === "success" ? (
        <WatchSearchComparisonPanes result={state.result} />
      ) : null}
    </div>
  )
}
