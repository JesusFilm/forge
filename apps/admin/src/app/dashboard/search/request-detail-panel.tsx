"use client"

import { useState } from "react"
import { StatusPill, cx } from "@/components/admin-ui"
import type { WatchSearchAnalyticsRequestRow } from "@/app/dashboard/ops-data"

type RequestDetailTab = "results" | "timing"
type SignalTone = "success" | "warning" | "danger" | "info" | "muted"

const SCORE_SIGNAL_MAX = {
  relevance: 0.75,
  sourceRelevance: 0.55,
  evidenceBoost: 0.2,
  availability: 0.25,
} as const

function statusTone(value: string): SignalTone {
  if (value === "success" || value === "fulfilled") return "success"
  if (value === "degraded") return "warning"
  if (value === "skipped") return "muted"
  if (value === "unavailable" || value === "failed") return "danger"
  return "info"
}

function displayToken(value: string | null | undefined) {
  const normalized = value?.replace(/[_-]+/g, " ").trim()
  if (!normalized) return "None"
  return normalized
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase()
      if (/^\d+[a-z]+$/i.test(word)) return word.toLowerCase()
      return `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`
    })
    .join(" ")
}

function signalToneClass(tone: SignalTone) {
  if (tone === "success") return "bg-[var(--color-success)]"
  if (tone === "warning") return "bg-[var(--color-warning)]"
  if (tone === "danger") return "bg-[var(--color-danger)]"
  if (tone === "info") return "bg-[var(--color-info)]"
  return "bg-[var(--color-text-muted)]"
}

function scorePercent(score: number | null) {
  if (score == null) return null
  return Math.max(0, Math.min(100, score * 100))
}

function scoreLabel(score: number | null) {
  const percent = scorePercent(score)
  return percent == null ? "n/a" : `${Math.round(percent)}%`
}

function ContributionBar({ value, max }: { value: number; max: number }) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div
      className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/15"
      aria-hidden="true"
    >
      <div
        className="h-full rounded-full bg-[var(--color-success)]"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

function ScoreCompositionBar({
  scoreBreakdown,
}: {
  scoreBreakdown: WatchSearchAnalyticsRequestRow["results"][number]["scoreBreakdown"]
}) {
  const sourcePercent = Math.max(
    0,
    Math.min(100, scoreBreakdown.sourceRelevance * 100),
  )
  const boostPercent = Math.max(
    0,
    Math.min(100 - sourcePercent, scoreBreakdown.evidenceBoost * 100),
  )
  const availabilityPercent = Math.max(
    0,
    Math.min(
      100 - sourcePercent - boostPercent,
      scoreBreakdown.availability * 100,
    ),
  )

  return (
    <div
      className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/20"
      aria-hidden="true"
    >
      <div
        className="h-full bg-[var(--color-info)]"
        style={{ width: `${sourcePercent}%` }}
      />
      <div
        className="h-full bg-blue-500"
        style={{ width: `${boostPercent}%` }}
      />
      <div
        className="h-full bg-[var(--color-success)]"
        style={{ width: `${availabilityPercent}%` }}
      />
    </div>
  )
}

function StackedRelevanceBar({
  sourceRelevance,
  evidenceBoost,
}: {
  sourceRelevance: number
  evidenceBoost: number
}) {
  const sourcePercent = Math.max(
    0,
    Math.min(100, (sourceRelevance / SCORE_SIGNAL_MAX.relevance) * 100),
  )
  const boostPercent = Math.max(
    0,
    Math.min(
      100 - sourcePercent,
      (evidenceBoost / SCORE_SIGNAL_MAX.relevance) * 100,
    ),
  )
  return (
    <div
      className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/15"
      aria-hidden="true"
    >
      <div
        className="h-full bg-[var(--color-info)]"
        style={{ width: `${sourcePercent}%` }}
      />
      <div
        className="h-full bg-blue-500"
        style={{ width: `${boostPercent}%` }}
      />
    </div>
  )
}

function ContributionRow({
  label,
  value,
  max,
}: {
  label: string
  value: number
  max: number
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[10px] tracking-[0.12em] text-white/55 uppercase">
          {label}
        </span>
        <span className="font-mono text-[11px] text-white">
          {Math.round(value * 100)} / {Math.round(max * 100)}
        </span>
      </div>
      <ContributionBar value={value} max={max} />
    </div>
  )
}

function RelevanceContributionRow({
  sourceRelevance,
  evidenceBoost,
}: {
  sourceRelevance: number
  evidenceBoost: number
}) {
  const relevance = sourceRelevance + evidenceBoost
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[10px] tracking-[0.12em] text-white/55 uppercase">
          Relevance
        </span>
        <span className="font-mono text-[11px] text-white">
          {Math.round(relevance * 100)} /{" "}
          {Math.round(SCORE_SIGNAL_MAX.relevance * 100)}
        </span>
      </div>
      <StackedRelevanceBar
        sourceRelevance={sourceRelevance}
        evidenceBoost={evidenceBoost}
      />
    </div>
  )
}

function InlineStatus({
  tone,
  children,
}: {
  tone: SignalTone
  children: string
}) {
  return (
    <span className="mt-1 inline-flex items-center gap-1.5 font-mono text-[13px] leading-none text-[var(--color-text-muted)]">
      <span
        aria-hidden="true"
        className={cx("h-1.5 w-1.5 rounded-full", signalToneClass(tone))}
      />
      {children}
    </span>
  )
}

function ResultSignals({
  score,
  scoreBreakdown,
}: {
  score: number | null
  scoreBreakdown: WatchSearchAnalyticsRequestRow["results"][number]["scoreBreakdown"]
}) {
  return (
    <div className="grid w-full gap-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] tracking-[0.18em] text-white/55 uppercase">
            Ranking score
          </div>
        </div>
        <div className="font-mono text-[18px] leading-none text-white">
          {scoreLabel(score)}
        </div>
      </div>

      <RelevanceContributionRow
        sourceRelevance={scoreBreakdown.sourceRelevance}
        evidenceBoost={scoreBreakdown.evidenceBoost}
      />
      <ContributionRow
        label="Availability"
        value={scoreBreakdown.availability}
        max={SCORE_SIGNAL_MAX.availability}
      />
    </div>
  )
}

function SearchScoreComposition({
  score,
  scoreBreakdown,
}: {
  score: number | null
  scoreBreakdown: WatchSearchAnalyticsRequestRow["results"][number]["scoreBreakdown"]
}) {
  const label = scoreLabel(score)
  return (
    <div className="flex w-full items-center gap-2">
      <span className="w-9 shrink-0 font-mono text-[12px] text-white/85">
        {label}
      </span>
      <ScoreCompositionBar scoreBreakdown={scoreBreakdown} />
    </div>
  )
}

function formatMs(value: number | null | undefined) {
  if (value == null) return "n/a"
  return `${Math.round(value)}ms`
}

function durationPercent(value: number | null | undefined, total: number) {
  if (value == null || total <= 0) return "0%"
  return `${Math.round((value / total) * 100)}%`
}

function laneEndMs(lane: WatchSearchAnalyticsRequestRow["lanes"][number]) {
  return lane.startedOffsetMs + (lane.elapsedMs ?? 0)
}

function laneTimelineTone(status: string) {
  const tone = statusTone(status)
  if (tone === "success") return "bg-[var(--color-success)]"
  if (tone === "warning") return "bg-[var(--color-warning)]"
  if (tone === "danger") return "bg-[var(--color-danger)]"
  if (tone === "muted") return "bg-[var(--color-text-muted)]"
  return "bg-[var(--color-info)]"
}

function laneSegmentTone(kind: string) {
  if (kind === "Embedding") return "bg-[var(--color-warning)]"
  if (kind === "Availability") return "bg-[var(--color-success)]"
  return "bg-[var(--color-info)]"
}

function laneDetailTone(detail: string | null) {
  if (detail === "cache_hit") return "text-[var(--color-success)]"
  if (detail === "cache_miss") return "text-[var(--color-text-muted)]"
  if (detail === "cache_expired" || detail === "cache_invalid") {
    return "text-[var(--color-warning)]"
  }
  return "text-[var(--color-text-muted)]"
}

function visibleTimingLane(
  lane: WatchSearchAnalyticsRequestRow["lanes"][number],
) {
  return !(lane.status === "skipped" && lane.resultCount === 0)
}

function visibleLaneReason(reason: string | null) {
  if (reason === "below_confidence_threshold") return null
  return reason
}

function WatchSearchTimingTimeline({
  request,
}: {
  request: WatchSearchAnalyticsRequestRow
}) {
  const laneTotalMs = Math.max(0, ...request.lanes.map(laneEndMs))
  const totalMs = Math.max(request.latencyMs ?? 0, laneTotalMs, 1)
  const lanesByName = new Map(request.lanes.map((lane) => [lane.lane, lane]))
  const groups = [
    {
      label: "Metadata",
      lanes: [
        { kind: "Search", lane: lanesByName.get("metadata_retrieval") },
        {
          kind: "Availability",
          lane: lanesByName.get("metadata_watchability"),
        },
      ],
    },
    {
      label: "Exact title",
      lanes: [
        { kind: "Search", lane: lanesByName.get("exact_title") },
        { kind: "Availability", lane: lanesByName.get("exact_watchability") },
      ],
    },
    {
      label: "Transcript",
      lanes: [
        { kind: "Embedding", lane: lanesByName.get("semantic_embedding") },
        { kind: "Search", lane: lanesByName.get("semantic_retrieval") },
        {
          kind: "Availability",
          lane: lanesByName.get("semantic_watchability"),
        },
      ],
    },
  ]
    .map((group) => {
      const lanes = group.lanes.filter(
        (
          item,
        ): item is {
          kind: string
          lane: WatchSearchAnalyticsRequestRow["lanes"][number]
        } => {
          if (!item.lane) return false
          return visibleTimingLane(item.lane)
        },
      )
      const startMs = Math.min(
        ...lanes.map((item) => item.lane.startedOffsetMs),
      )
      const endMs = Math.max(...lanes.map((item) => laneEndMs(item.lane)))
      return {
        ...group,
        lanes,
        startMs,
        durationMs: Math.max(0, endMs - startMs),
      }
    })
    .filter((group) => group.lanes.length > 0)

  return (
    <div className="grid gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="label-text">Execution timeline</div>
          <div className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
            Pipelines are positioned by when their work started inside the
            request.
          </div>
        </div>
        <div className="font-mono text-[16px]">{formatMs(totalMs)} total</div>
      </div>
      <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-[var(--color-text-muted)]">
        {["Embedding", "Search", "Availability"].map((kind) => (
          <span key={kind} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cx("h-1.5 w-1.5 rounded-full", laneSegmentTone(kind))}
            />
            {kind}
          </span>
        ))}
      </div>

      <div className="grid gap-2">
        <div className="grid grid-cols-[minmax(120px,180px)_1fr_84px] items-end gap-3 border-b border-[var(--color-hairline)] pb-2">
          <div className="label-text">Pipeline</div>
          <div className="relative h-5">
            <div className="absolute left-0 top-1/2 h-1 w-px -translate-y-1/2 bg-[var(--color-hairline-strong)]" />
            <div className="absolute right-0 top-1/2 h-1 w-px -translate-y-1/2 bg-[var(--color-hairline-strong)]" />
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--color-hairline)]" />
            <span className="absolute left-0 top-0 font-mono text-[10px] text-[var(--color-text-muted)]">
              0ms
            </span>
            <span className="absolute right-0 top-0 font-mono text-[10px] text-[var(--color-text-muted)]">
              {formatMs(totalMs)}
            </span>
          </div>
          <div className="label-text text-right">Duration</div>
        </div>

        {groups.map((group) => {
          const groupLeft = Math.max(
            0,
            Math.min(100, (group.startMs / totalMs) * 100),
          )
          const groupWidth = Math.max(
            group.durationMs === 0 ? 0.5 : 1.5,
            Math.min(100 - groupLeft, (group.durationMs / totalMs) * 100),
          )
          return (
            <div
              key={`${request.requestId}-${group.label}`}
              className="grid grid-cols-[minmax(120px,180px)_1fr_84px] items-center gap-3"
            >
              <div className="min-w-0">
                <div className="truncate font-mono text-[12px] text-[var(--color-text-primary)]">
                  {group.label}
                </div>
              </div>
              <div className="relative h-9 rounded-sm bg-[var(--color-surface)]">
                <div
                  className="absolute top-1/2 flex h-4 -translate-y-1/2 overflow-visible rounded-full"
                  style={{ left: `${groupLeft}%`, width: `${groupWidth}%` }}
                >
                  {group.lanes.map(({ kind, lane }) => {
                    const laneDetail = lane.detail
                      ? displayToken(lane.detail)
                      : null
                    const laneReason = visibleLaneReason(lane.reason)
                    const showResultCount = kind !== "Embedding"
                    const showLaneStatus = lane.status !== "fulfilled"
                    const durationLabel = `${formatMs(lane.elapsedMs)} (${durationPercent(lane.elapsedMs, group.durationMs)})`
                    const segmentWidth =
                      group.durationMs > 0
                        ? Math.max(
                            lane.elapsedMs === 0 ? 0.5 : 1.5,
                            ((lane.elapsedMs ?? 0) / group.durationMs) * 100,
                          )
                        : 100 / group.lanes.length
                    return (
                      <span
                        key={lane.lane}
                        className={cx(
                          "group/timing-segment relative h-full min-w-1 cursor-default first:rounded-l-full last:rounded-r-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
                          laneSegmentTone(kind),
                          lane.status === "skipped" ? "opacity-45" : null,
                          lane.status === "degraded" ? "brightness-90" : null,
                        )}
                        style={{ width: `${segmentWidth}%` }}
                        tabIndex={0}
                      >
                        <span className="pointer-events-none absolute left-1/2 bottom-full z-20 mb-2 hidden w-max max-w-[220px] -translate-x-1/2 rounded-sm border border-[var(--color-hairline-strong)] bg-[var(--color-surface-raised)] px-2.5 py-2 text-left shadow-lg group-hover/timing-segment:block group-focus-visible/timing-segment:block">
                          <span className="block font-mono text-[11px] text-[var(--color-text-primary)]">
                            {group.label} {kind.toLowerCase()}
                          </span>
                          <span className="mt-1 block font-mono text-[10px] text-[var(--color-text-secondary)]">
                            {durationLabel}
                          </span>
                          {showResultCount && lane.resultCount != null ? (
                            <span className="mt-1 block font-mono text-[10px] text-[var(--color-text-muted)]">
                              {lane.resultCount} results
                            </span>
                          ) : null}
                          {showLaneStatus ? (
                            <span className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                              <span
                                aria-hidden="true"
                                className={cx(
                                  "h-1.5 w-1.5 rounded-full",
                                  laneTimelineTone(lane.status),
                                )}
                              />
                              {displayToken(lane.status)}
                            </span>
                          ) : null}
                          {laneReason || laneDetail ? (
                            <span
                              className={cx(
                                "mt-1 block font-mono text-[10px] text-[var(--color-text-muted)]",
                                laneDetail ? laneDetailTone(lane.detail) : null,
                              )}
                            >
                              {laneReason ? displayToken(laneReason) : ""}
                              {laneReason && laneDetail ? " / " : ""}
                              {laneDetail ?? ""}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    )
                  })}
                </div>
              </div>
              <div className="text-right font-mono text-[12px] text-[var(--color-text-secondary)]">
                {formatMs(group.durationMs)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function WatchSearchRequestDetailPanel({
  request,
}: {
  request: WatchSearchAnalyticsRequestRow
}) {
  const [activeTab, setActiveTab] = useState<RequestDetailTab>("results")

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-3">
          <div className="label-text">Target</div>
          <div className="mt-2 font-mono text-[15px]">
            {request.targetLanguageLabel}
          </div>
          <div className="mono-meta mt-1 text-[var(--color-text-muted)]">
            {displayToken(request.targetLanguageSource)}
          </div>
        </div>
        <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-3">
          <div className="label-text">Results</div>
          <div className="mt-2 font-mono text-[15px]">
            {request.resultCount}
          </div>
          <InlineStatus tone={statusTone(request.outcome)}>
            {displayToken(request.outcome)}
          </InlineStatus>
        </div>
        <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-3">
          <div className="label-text">Click</div>
          <div className="mt-2 font-mono text-[15px]">
            {request.clickedPosition
              ? `rank ${request.clickedPosition}`
              : "none"}
          </div>
          <div className="mono-meta mt-1 text-[var(--color-text-muted)]">
            {request.clickCount} clicked result
          </div>
        </div>
        <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-3">
          <div className="label-text">Latency</div>
          <div className="mt-2 font-mono text-[15px]">
            {request.latencyMs === null
              ? "n/a"
              : `${Math.round(request.latencyMs)}ms`}
          </div>
          <div className="mono-meta mt-1 text-[var(--color-text-muted)]">
            {displayToken(request.searchMode)}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-hairline)]">
        <div
          className="inline-flex gap-1"
          role="tablist"
          aria-label="Request detail tabs"
        >
          {(["results", "timing"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls={`watch-search-${tab}-panel`}
              id={`watch-search-${tab}-tab`}
              onClick={() => setActiveTab(tab)}
              className={cx(
                "border-b-2 px-3 py-2 font-mono text-[11px] uppercase transition-all duration-[120ms] ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]",
                activeTab === tab
                  ? "border-[var(--color-brand)] text-[var(--color-text-primary)]"
                  : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]",
              )}
            >
              {tab === "results" ? "Results" : "Timing"}
            </button>
          ))}
        </div>
        {activeTab === "results" && request.clickCount > 0 ? (
          <StatusPill tone="success">{request.clickCount} clicked</StatusPill>
        ) : null}
      </div>

      {activeTab === "results" ? (
        <div
          id="watch-search-results-panel"
          role="tabpanel"
          aria-labelledby="watch-search-results-tab"
          className="grid content-start gap-3 md:grid-cols-2 2xl:grid-cols-3"
        >
          {request.results.length > 0 ? (
            request.results.map((result) => (
              <article
                key={`${request.requestId}-${result.id}`}
                className={cx(
                  "group min-w-0 overflow-hidden rounded-sm border bg-[var(--color-surface-raised)] transition-all duration-200 ease-out",
                  result.clicked
                    ? "border-[var(--color-success)] shadow-[inset_0_0_0_2px_var(--color-success),0_0_0_1px_var(--color-success)]"
                    : "border-[var(--color-hairline)]",
                )}
              >
                <div className="relative aspect-video overflow-hidden bg-[var(--color-surface)]">
                  {result.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={result.imageUrl}
                      alt={result.title ?? "Rendered video result"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full min-h-[120px] items-center justify-center bg-[var(--color-surface)] font-mono text-[28px] text-[var(--color-text-muted)]">
                      {(result.title ?? result.id).slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="absolute left-2 top-2 rounded-sm bg-black/70 px-2 py-1 font-mono text-[11px] text-white">
                    #{result.position}
                  </div>
                  {result.clicked ? (
                    <div className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-sm bg-black/80 px-2 py-1 font-mono text-[11px] text-white shadow-[0_3px_14px_rgba(0,0,0,0.65)]">
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]"
                      />
                      Clicked
                    </div>
                  ) : null}
                  <div className="pointer-events-none absolute inset-0 z-10 flex translate-y-1 items-center bg-black/60 px-3 py-3 opacity-0 backdrop-blur-md transition-all duration-200 ease-out group-hover:translate-y-0 group-hover:opacity-100">
                    <ResultSignals
                      score={result.score}
                      scoreBreakdown={result.scoreBreakdown}
                    />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/75 to-transparent px-3 pb-3 pt-12 transition-opacity duration-200 ease-out group-hover:opacity-0">
                    <div className="line-clamp-2 text-[14px] leading-snug font-semibold text-white drop-shadow">
                      {result.title ?? displayToken(result.type)}
                    </div>
                    <div className="mt-2">
                      <SearchScoreComposition
                        score={result.score}
                        scoreBreakdown={result.scoreBreakdown}
                      />
                    </div>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-4 text-[13px] text-[var(--color-text-secondary)]">
              This search returned no results.
            </div>
          )}
        </div>
      ) : (
        <div
          id="watch-search-timing-panel"
          role="tabpanel"
          aria-labelledby="watch-search-timing-tab"
          className="min-w-0"
        >
          <WatchSearchTimingTimeline request={request} />
        </div>
      )}
    </div>
  )
}
