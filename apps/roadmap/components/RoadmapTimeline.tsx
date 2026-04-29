"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import type { Feature, FeatureStatus, Lane } from "@/lib/features"
import RoadmapFeaturePreviewPopover from "./RoadmapFeaturePreviewPopover"

const DAY_MS = 86400000
const MIN_WEEK_WIDTH_PX = 80
const MIN_TIMELINE_WIDTH_PX = 600
const TIMELINE_MARKER_LABEL_BAND_PX = 28
const PREVIEW_OPEN_DELAY_MS = 80
const PREVIEW_CLOSE_DELAY_MS = 120
const BASE_ROW_HEIGHT_PX = 26
const STACK_ROW_GAP_PX = 4

const STATUS_COLORS: Record<FeatureStatus, string> = {
  "not-started": "bg-stone-700 border-stone-600 hover:bg-stone-600",
  "in-progress": "bg-blue-900/60 border-blue-500/50 hover:bg-blue-900/80",
  complete: "bg-green-900/60 border-green-500/50 hover:bg-green-900/80",
  blocked: "bg-red-900/60 border-red-500/50 hover:bg-red-900/80",
}

const STATUS_DOT: Record<FeatureStatus, string> = {
  "not-started": "bg-stone-400",
  "in-progress": "bg-blue-400",
  complete: "bg-green-400",
  blocked: "bg-red-400",
}

const PRIORITY_BORDER: Record<string, string> = {
  P0: "border-l-red-500 border-l-[3px]",
  P1: "border-l-yellow-500 border-l-[3px]",
  P2: "border-l-stone-500 border-l-[3px]",
}

const LANE_COLORS: Record<Lane, string> = {
  "content-discovery": "text-purple-400",
  "topic-experiences": "text-blue-400",
  "media-generation": "text-amber-400",
  platform: "text-stone-400",
}

type HighlightState =
  | "normal"
  | "hovered"
  | "dependency"
  | "blocked-by"
  | "dimmed"

const HIGHLIGHT_RING: Record<HighlightState, string> = {
  normal: "",
  hovered: "brightness-125 z-20",
  dependency: "brightness-125 z-20",
  "blocked-by": "brightness-125 z-20",
  dimmed: "opacity-65",
}

/** Parse YYYY-MM-DD to a Date at midnight UTC-safe local time */
function toDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00")
}

/** Build week columns spanning the timeline range, starting each Monday */
function buildWeekColumns(
  rangeStart: Date,
  rangeEnd: Date,
): { start: Date; label: string }[] {
  const columns: { start: Date; label: string }[] = []
  // Snap to the Monday on or before rangeStart
  const first = new Date(rangeStart)
  const day = first.getDay()
  const diffToMonday = day === 0 ? 6 : day - 1
  first.setDate(first.getDate() - diffToMonday)

  const cur = new Date(first)
  while (cur <= rangeEnd) {
    columns.push({
      start: new Date(cur),
      label: cur.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    })
    cur.setDate(cur.getDate() + 7)
  }
  return columns
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

function buildQuarterMarkers(
  rangeStart: Date,
  rangeEnd: Date,
  totalDays: number,
): { date: Date; label: string; pct: number }[] {
  const markers: { date: Date; label: string; pct: number }[] = []

  for (
    let year = rangeStart.getFullYear();
    year <= rangeEnd.getFullYear();
    year++
  ) {
    const quarterBoundaries = [
      { date: new Date(year, 3, 1), label: "Q1" },
      { date: new Date(year, 6, 1), label: "Q2" },
      { date: new Date(year, 9, 1), label: "Q3" },
      { date: new Date(year + 1, 0, 1), label: "Q4" },
    ]

    for (const marker of quarterBoundaries) {
      if (marker.date < rangeStart || marker.date > rangeEnd) continue

      const offsetDays = (marker.date.getTime() - rangeStart.getTime()) / DAY_MS
      const pct = (offsetDays / totalDays) * 100

      markers.push({
        date: marker.date,
        label: marker.label,
        pct,
      })
    }
  }

  return markers
}

function buildMonthBands(
  rangeStart: Date,
  rangeEnd: Date,
  totalDays: number,
): { key: string; leftPct: number; widthPct: number; shaded: boolean }[] {
  const bands: {
    key: string
    leftPct: number
    widthPct: number
    shaded: boolean
  }[] = []

  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
  let monthIndex = 0

  while (cursor < rangeEnd) {
    const monthStart = new Date(cursor)
    const nextMonthStart = new Date(
      cursor.getFullYear(),
      cursor.getMonth() + 1,
      1,
    )
    const visibleStart = monthStart < rangeStart ? rangeStart : monthStart
    const visibleEnd = nextMonthStart > rangeEnd ? rangeEnd : nextMonthStart
    const visibleDays = (visibleEnd.getTime() - visibleStart.getTime()) / DAY_MS

    if (visibleDays > 0) {
      const leftPct =
        ((visibleStart.getTime() - rangeStart.getTime()) / DAY_MS / totalDays) *
        100
      const widthPct = (visibleDays / totalDays) * 100

      bands.push({
        key: `${cursor.getFullYear()}-${cursor.getMonth()}`,
        leftPct,
        widthPct,
        shaded: monthIndex % 2 === 1,
      })
    }

    cursor.setMonth(cursor.getMonth() + 1)
    monthIndex += 1
  }

  return bands
}

function FeatureBlock({
  feature,
  rangeStart,
  totalDays,
  ownerAvatars,
  highlight,
  topPx,
  heightPx,
  onMouseEnter,
  onMouseLeave,
  onFocusOpen,
  onBlurClose,
  onEscapeClose,
}: {
  feature: Feature
  rangeStart: Date
  totalDays: number
  ownerAvatars: Record<string, string | null>
  highlight: HighlightState
  topPx: number
  heightPx: number
  onMouseEnter: (anchor: HTMLAnchorElement) => void
  onMouseLeave: () => void
  onFocusOpen: (anchor: HTMLAnchorElement) => void
  onBlurClose: () => void
  onEscapeClose: () => void
}) {
  const start = toDate(feature.start_date)
  const daysFromStart = (start.getTime() - rangeStart.getTime()) / DAY_MS
  const leftPct = (daysFromStart / totalDays) * 100
  const widthPct = (feature.duration / totalDays) * 100
  const avatar = ownerAvatars[feature.owner]

  return (
    <Link
      href={`/ticket/${feature.id}`}
      className={`group absolute flex cursor-pointer items-center gap-1 overflow-hidden rounded border px-1.5 transition-all duration-150 sm:gap-1.5 sm:px-2 ${STATUS_COLORS[feature.status]} ${PRIORITY_BORDER[feature.priority]} ${HIGHLIGHT_RING[highlight]}`}
      style={{
        left: `${leftPct}%`,
        width: `${Math.max(widthPct, 1)}%`,
        top: `${topPx}px`,
        height: `${heightPx}px`,
        zIndex: highlight === "normal" || highlight === "dimmed" ? 1 : 30,
      }}
      title="Click for more details"
      onMouseEnter={(event) => onMouseEnter(event.currentTarget)}
      onMouseLeave={onMouseLeave}
      onFocus={(event) => onFocusOpen(event.currentTarget)}
      onBlur={onBlurClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          onEscapeClose()
          event.currentTarget.blur()
        }
      }}
    >
      {avatar ? (
        <img
          src={`${avatar}&s=24`}
          alt={feature.owner}
          className="h-3.5 w-3.5 shrink-0 rounded-full bg-white"
        />
      ) : (
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[feature.status]}`}
        />
      )}
      <span className="truncate text-[11px] font-medium text-stone-200 group-hover:text-white sm:text-xs">
        {feature.title}
      </span>
      {highlight === "dependency" && (
        <span className="ml-auto shrink-0 text-[9px] text-stone-400">dep</span>
      )}
      {highlight === "blocked-by" && (
        <span className="ml-auto shrink-0 text-[9px] text-stone-400">
          blocks
        </span>
      )}
    </Link>
  )
}

type Group = {
  key: string
  label: string
  avatar?: string | null
  href: string
  colorClass: string
  features: Feature[]
}

export type GroupByMode = "lane" | "person"

type PositionedFeature = {
  feature: Feature
  layer: number
}

type OwnerTimelineRow = {
  owner: string
  earliestStart: string
  stackDepth: number
  features: PositionedFeature[]
}

function compareFeatureStart(a: Feature, b: Feature): number {
  const startDiff = a.start_date.localeCompare(b.start_date)
  if (startDiff !== 0) return startDiff
  const durationDiff = b.duration - a.duration
  if (durationDiff !== 0) return durationDiff
  return a.title.localeCompare(b.title)
}

function buildOwnerTimelineRows(features: Feature[]): OwnerTimelineRow[] {
  const byOwner = new Map<string, Feature[]>()

  for (const feature of features) {
    const ownerFeatures = byOwner.get(feature.owner) ?? []
    ownerFeatures.push(feature)
    byOwner.set(feature.owner, ownerFeatures)
  }

  return Array.from(byOwner.entries())
    .map(([owner, ownerFeatures]) => {
      const sorted = [...ownerFeatures].sort(compareFeatureStart)
      const layerEndTimes: number[] = []
      const positionedFeatures = sorted.map((feature) => {
        const start = toDate(feature.start_date).getTime()
        const end = start + feature.duration * DAY_MS

        let layer = layerEndTimes.findIndex((layerEnd) => layerEnd <= start)
        if (layer === -1) {
          layer = layerEndTimes.length
          layerEndTimes.push(end)
        } else {
          layerEndTimes[layer] = end
        }

        return { feature, layer }
      })

      return {
        owner,
        earliestStart: sorted[0]?.start_date ?? "",
        stackDepth: Math.max(layerEndTimes.length, 1),
        features: positionedFeatures,
      }
    })
    .sort((a, b) => {
      const startDiff = a.earliestStart.localeCompare(b.earliestStart)
      if (startDiff !== 0) return startDiff
      return a.owner.localeCompare(b.owner)
    })
}

export default function RoadmapTimeline({
  features,
  lanes,
  owners,
  laneLabels,
  ownerAvatars,
  groupBy,
}: {
  features: Feature[]
  lanes: Lane[]
  owners: string[]
  laneLabels: Record<Lane, string>
  ownerAvatars: Record<string, string | null>
  groupBy: GroupByMode
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [previewedKey, setPreviewedKey] = useState<string | null>(null)
  const [supportsPreview, setSupportsPreview] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const openTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  // Only include features that have valid date-based timelines
  const timelineFeatures = features.filter(
    (f) => f.start_date && f.duration > 0,
  )

  // Compute the date range from all features
  const {
    rangeStart,
    totalDays,
    weekColumns,
    todayPct,
    quarterMarkers,
    monthBands,
  } = useMemo(() => {
    if (timelineFeatures.length === 0) {
      const now = new Date()
      return {
        rangeStart: now,
        totalDays: 1,
        weekColumns: [] as { start: Date; label: string }[],
        todayPct: null as number | null,
        quarterMarkers: [] as { date: Date; label: string; pct: number }[],
        monthBands: [] as {
          key: string
          leftPct: number
          widthPct: number
          shaded: boolean
        }[],
      }
    }

    let minDate = toDate(timelineFeatures[0].start_date)
    let maxDate = new Date(
      minDate.getTime() + timelineFeatures[0].duration * DAY_MS,
    )

    for (const f of timelineFeatures) {
      const s = toDate(f.start_date)
      const e = new Date(s.getTime() + f.duration * DAY_MS)
      if (s < minDate) minDate = s
      if (e > maxDate) maxDate = e
    }

    // Add a small buffer (3 days each side)
    const rStart = new Date(minDate.getTime() - 3 * DAY_MS)
    const rEnd = new Date(maxDate.getTime() + 3 * DAY_MS)
    const columns = buildWeekColumns(rStart, rEnd)
    const snappedRangeStart = columns[0]?.start ?? rStart
    const snappedRangeEnd = addDays(
      columns[columns.length - 1]?.start ?? rEnd,
      7,
    )
    const tDays =
      (snappedRangeEnd.getTime() - snappedRangeStart.getTime()) / DAY_MS

    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const todayOffset = (now.getTime() - snappedRangeStart.getTime()) / DAY_MS
    const tPct =
      todayOffset >= 0 && todayOffset <= tDays
        ? (todayOffset / tDays) * 100
        : null

    return {
      rangeStart: snappedRangeStart,
      totalDays: tDays,
      weekColumns: columns,
      todayPct: tPct,
      quarterMarkers: buildQuarterMarkers(
        snappedRangeStart,
        snappedRangeEnd,
        tDays,
      ),
      monthBands: buildMonthBands(snappedRangeStart, snappedRangeEnd, tDays),
    }
  }, [timelineFeatures])

  const timelineMinWidthPx = Math.max(
    MIN_TIMELINE_WIDTH_PX,
    weekColumns.length * MIN_WEEK_WIDTH_PX,
  )

  // Precompute dependency lookup
  const depMap = useMemo(() => {
    const map = new Map<
      string,
      { dependsOn: Set<string>; blocks: Set<string> }
    >()
    for (const f of features) {
      map.set(f.filePath, {
        dependsOn: new Set(f.depends_on),
        blocks: new Set(f.blocks),
      })
    }
    return map
  }, [features])

  function getHighlight(featureKey: string, featureId: string): HighlightState {
    if (!hoveredKey) return "normal"
    if (featureKey === hoveredKey) return "hovered"
    const hovered = depMap.get(hoveredKey)
    if (!hovered) return "dimmed"
    if (hovered.dependsOn.has(featureId)) return "dependency"
    if (hovered.blocks.has(featureId)) return "blocked-by"
    return "dimmed"
  }

  const groups: Group[] =
    groupBy === "lane"
      ? lanes.map((lane) => ({
          key: lane,
          label: laneLabels[lane],
          href: `/lane/${lane}`,
          colorClass: LANE_COLORS[lane],
          features: timelineFeatures.filter((f) => f.lane === lane),
        }))
      : owners.map((owner) => ({
          key: owner,
          label: owner,
          avatar: ownerAvatars[owner],
          href: `/person/${owner}`,
          colorClass: "text-stone-300",
          features: timelineFeatures.filter((f) => f.owner === owner),
        }))

  const visibleGroups = groups.filter((g) => g.features.length > 0)
  const previewedFeature =
    previewedKey != null
      ? (timelineFeatures.find(
          (feature) => feature.filePath === previewedKey,
        ) ?? null)
      : null

  function clearTimer(ref: { current: number | null }) {
    if (ref.current !== null) {
      window.clearTimeout(ref.current)
      ref.current = null
    }
  }

  function clearPreviewTimers() {
    clearTimer(openTimerRef)
    clearTimer(closeTimerRef)
  }

  function openPreview(
    featureKey: string,
    _anchor: HTMLAnchorElement,
    immediate = false,
  ) {
    if (!supportsPreview) return
    clearTimer(closeTimerRef)

    const applyOpen = () => {
      setHoveredKey(featureKey)
      setPreviewedKey(featureKey)
    }

    if (previewedKey === featureKey) {
      applyOpen()
      return
    }

    clearTimer(openTimerRef)
    if (immediate) {
      applyOpen()
      return
    }

    openTimerRef.current = window.setTimeout(applyOpen, PREVIEW_OPEN_DELAY_MS)
  }

  function closePreview(immediate = false) {
    clearTimer(openTimerRef)

    const applyClose = () => {
      setHoveredKey(null)
      setPreviewedKey(null)
    }

    clearTimer(closeTimerRef)
    if (immediate) {
      applyClose()
      return
    }

    closeTimerRef.current = window.setTimeout(
      applyClose,
      PREVIEW_CLOSE_DELAY_MS,
    )
  }

  useEffect(() => {
    if (typeof window === "undefined") return

    const mediaQuery = window.matchMedia("(hover: hover) and (pointer: fine)")
    const syncSupport = () => {
      const next = mediaQuery.matches
      setSupportsPreview(next)
      if (!next) {
        clearPreviewTimers()
        setHoveredKey(null)
        setPreviewedKey(null)
      }
    }

    syncSupport()
    mediaQuery.addEventListener("change", syncSupport)

    return () => {
      mediaQuery.removeEventListener("change", syncSupport)
    }
  }, [])

  useEffect(() => {
    return () => {
      clearPreviewTimers()
    }
  }, [])

  return (
    <div>
      {/* Timeline */}
      <div ref={scrollContainerRef} className="overflow-x-auto">
        <div
          className="relative"
          style={{
            minWidth: `${timelineMinWidthPx}px`,
            paddingTop: `${TIMELINE_MARKER_LABEL_BAND_PX}px`,
          }}
        >
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-0"
            style={{ top: `${TIMELINE_MARKER_LABEL_BAND_PX}px` }}
          >
            {monthBands
              .filter((band) => band.shaded)
              .map((band) => (
                <div
                  key={band.key}
                  className="absolute top-0 bottom-0 bg-white/[0.025]"
                  style={{
                    left: `${band.leftPct}%`,
                    width: `${band.widthPct}%`,
                  }}
                />
              ))}
          </div>

          {/* Today hairline */}
          {todayPct !== null && (
            <div
              className="pointer-events-none absolute bottom-0 z-30 w-px bg-red-500/70"
              style={{
                top: `${TIMELINE_MARKER_LABEL_BAND_PX}px`,
                left: `${todayPct}%`,
              }}
            >
              <div className="absolute left-1/2 top-[-8px] h-2 w-px -translate-x-1/2 bg-red-500/70" />
              <div className="absolute left-1/2 top-[-24px] -translate-x-1/2 rounded bg-red-500 px-1 py-px text-[9px] font-medium whitespace-nowrap text-white">
                Today
              </div>
            </div>
          )}

          {quarterMarkers.map((marker) => (
            <div
              key={marker.date.toISOString()}
              className="pointer-events-none absolute bottom-0 z-20 w-px bg-sky-400/45"
              style={{
                top: `${TIMELINE_MARKER_LABEL_BAND_PX}px`,
                left: `${marker.pct}%`,
              }}
            >
              <div className="absolute left-1/2 top-[-8px] h-2 w-px -translate-x-1/2 bg-sky-400/45" />
              <div className="absolute left-1/2 top-[-24px] -translate-x-1/2 rounded border border-sky-400/40 bg-stone-800 px-1 py-px text-[9px] font-medium whitespace-nowrap text-sky-200">
                {marker.label}
              </div>
            </div>
          ))}

          {/* Week column headers */}
          <div className="flex border-b border-stone-700 pb-2">
            {weekColumns.map((col, i) => {
              const colStart =
                (col.start.getTime() - rangeStart.getTime()) / DAY_MS
              const nextStart =
                i + 1 < weekColumns.length
                  ? (weekColumns[i + 1].start.getTime() -
                      rangeStart.getTime()) /
                    DAY_MS
                  : totalDays
              const widthPct = ((nextStart - colStart) / totalDays) * 100

              return (
                <div
                  key={col.start.toISOString()}
                  className="text-center"
                  style={{ width: `${widthPct}%` }}
                >
                  <div className="hidden text-[10px] text-stone-500 sm:block">
                    {col.label}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Grouped rows */}
          <div className="divide-y divide-stone-800">
            {visibleGroups.map((g) => {
              const ownerRows = buildOwnerTimelineRows(g.features)

              return (
                <div key={g.key}>
                  <div className="flex items-center gap-2 py-2">
                    <Link
                      href={g.href}
                      className={`flex items-center gap-1.5 text-sm font-semibold capitalize ${g.colorClass} hover:underline`}
                    >
                      {g.avatar && (
                        <img
                          src={`${g.avatar}&s=32`}
                          alt={g.label}
                          className="h-4 w-4 rounded-full"
                        />
                      )}
                      {g.label}
                    </Link>
                    <span className="text-xs text-stone-500">
                      {g.features.length}
                    </span>
                  </div>
                  <div className="space-y-2 pb-2">
                    {ownerRows.map((ownerRow) => {
                      const rowHeightPx =
                        ownerRow.stackDepth * BASE_ROW_HEIGHT_PX +
                        (ownerRow.stackDepth - 1) * STACK_ROW_GAP_PX

                      return (
                        <div
                          key={`${g.key}-${ownerRow.owner}`}
                          className={
                            groupBy === "lane" ? "grid gap-3" : "grid gap-0"
                          }
                          style={
                            groupBy === "lane"
                              ? {
                                  gridTemplateColumns:
                                    "minmax(0, 120px) minmax(0, 1fr)",
                                }
                              : undefined
                          }
                        >
                          {groupBy === "lane" && (
                            <div className="flex min-w-0 items-start gap-2 pt-1">
                              {ownerAvatars[ownerRow.owner] ? (
                                <img
                                  src={`${ownerAvatars[ownerRow.owner]}&s=32`}
                                  alt={ownerRow.owner}
                                  className="h-4 w-4 shrink-0 rounded-full bg-white"
                                />
                              ) : (
                                <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-stone-400" />
                              )}
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium capitalize text-stone-300">
                                  {ownerRow.owner}
                                </div>
                                <div className="text-[10px] text-stone-500">
                                  {ownerRow.features.length} task
                                  {ownerRow.features.length === 1 ? "" : "s"}
                                </div>
                              </div>
                            </div>
                          )}

                          <div
                            className="relative"
                            style={{ height: `${rowHeightPx}px` }}
                          >
                            {/* Grid lines at week boundaries */}
                            <div className="absolute inset-0">
                              {weekColumns.map((col) => {
                                const colLeft =
                                  ((col.start.getTime() -
                                    rangeStart.getTime()) /
                                    DAY_MS /
                                    totalDays) *
                                  100
                                return (
                                  <div
                                    key={col.start.toISOString()}
                                    className="absolute top-0 bottom-0 w-px border-r border-stone-800"
                                    style={{ left: `${colLeft}%` }}
                                  />
                                )
                              })}
                            </div>

                            {ownerRow.features.map(({ feature, layer }) => (
                              <FeatureBlock
                                key={feature.filePath}
                                feature={feature}
                                rangeStart={rangeStart}
                                totalDays={totalDays}
                                ownerAvatars={ownerAvatars}
                                highlight={getHighlight(
                                  feature.filePath,
                                  feature.id,
                                )}
                                topPx={
                                  layer *
                                  (BASE_ROW_HEIGHT_PX + STACK_ROW_GAP_PX)
                                }
                                heightPx={BASE_ROW_HEIGHT_PX}
                                onMouseEnter={(anchor) =>
                                  openPreview(feature.filePath, anchor)
                                }
                                onMouseLeave={() => closePreview()}
                                onFocusOpen={(anchor) =>
                                  openPreview(feature.filePath, anchor, true)
                                }
                                onBlurClose={() => closePreview(true)}
                                onEscapeClose={() => closePreview(true)}
                              />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {supportsPreview && previewedFeature && (
        <RoadmapFeaturePreviewPopover
          feature={previewedFeature}
          laneLabel={laneLabels[previewedFeature.lane]}
          ownerAvatar={ownerAvatars[previewedFeature.owner]}
          onMouseEnter={() => clearTimer(closeTimerRef)}
          onMouseLeave={() => closePreview()}
        />
      )}
    </div>
  )
}
