"use client"

import { useEffect, useState } from "react"

import * as deliveryHistory from "@/lib/plannedRoadmap"
import * as yearEndPlan from "@/lib/yearEndRoadmap"

type RoadmapTone =
  | "stone"
  | "amber"
  | "sky"
  | "emerald"
  | "lime"
  | "rose"
  | "red"

type RoadmapTrack = {
  id: string
  label: string
}

type RoadmapWeek = {
  index: number
  shortLabel: string
  dateLabel: string
  isoDate: string
}

type RoadmapPhase = {
  id: string
  title: string
  track: string
  tone: RoadmapTone
  startWeek: number
  spanWeeks: number
  badge: string
  rangeLabel: string
  summary: string
  sections: Array<{ label: string; items: string[] }>
}

type RoadmapTrackBar = {
  id: string
  title: string
  summary: string
  track: string
  tone: RoadmapTone
  startWeek: number
  spanWeeks: number
  badge?: string
  details?: string[]
  overdueStartWeek?: number
}

type RoadmapTimelineRow = {
  id: string
  label: string
  description: string
  trackIds: string[]
  sublanes?: Array<{ id: string; trackIds: string[] }>
}

type RoadmapLegendItem = {
  label: string
  markerClassName: string
  divider?: boolean
}

type RoadmapTimelineModel = {
  startIso: string
  weekCount: number
  weeks: RoadmapWeek[]
  tracks: RoadmapTrack[]
  rows: RoadmapTimelineRow[]
  phases: RoadmapPhase[]
  trackBars: RoadmapTrackBar[]
  legend: RoadmapLegendItem[]
}

export type RoadmapTimelineVariant = "delivery-history" | "year-end"

const TIMELINE_MODELS: Record<RoadmapTimelineVariant, RoadmapTimelineModel> = {
  "delivery-history": {
    startIso: deliveryHistory.PLANNED_START_ISO,
    weekCount: deliveryHistory.PLANNED_WEEK_COUNT,
    weeks: deliveryHistory.PLANNED_WEEKS,
    tracks: deliveryHistory.PLANNED_TRACKS,
    rows: deliveryHistory.PLANNED_TIMELINE_ROWS,
    phases: deliveryHistory.PLANNED_PHASES,
    trackBars: deliveryHistory.PLANNED_TRACK_BARS,
    legend: [
      { label: "Foundation", markerClassName: "bg-stone-300" },
      {
        label: "Player / Experiences / Homepage",
        markerClassName: "bg-amber-400",
      },
      { label: "Search", markerClassName: "bg-sky-400" },
      { label: "Agentic Framework", markerClassName: "bg-emerald-400" },
      { label: "Mobile + TV", markerClassName: "bg-lime-400" },
      {
        label: "Important events",
        markerClassName: "bg-rose-500",
        divider: true,
      },
    ],
  },
  "year-end": {
    startIso: yearEndPlan.PLANNED_START_ISO,
    weekCount: yearEndPlan.PLANNED_WEEK_COUNT,
    weeks: yearEndPlan.PLANNED_WEEKS,
    tracks: yearEndPlan.PLANNED_TRACKS,
    rows: yearEndPlan.PLANNED_TIMELINE_ROWS,
    phases: yearEndPlan.PLANNED_PHASES,
    trackBars: yearEndPlan.PLANNED_TRACK_BARS,
    legend: [
      { label: "Reliability", markerClassName: "bg-stone-300" },
      { label: "Accounts & journeys", markerClassName: "bg-amber-400" },
      {
        label: "Localization & quality",
        markerClassName: "bg-sky-400",
      },
      { label: "Devotional AI", markerClassName: "bg-emerald-400" },
      {
        label: "Distribution experiments",
        markerClassName: "bg-rose-500",
      },
      { label: "Mobile + TV", markerClassName: "bg-lime-400" },
      { label: "Operating rhythm", markerClassName: "bg-red-500" },
    ],
  },
}

const DAY_MS = 86400000
const TRACK_LABEL_WIDTH_PX = 220
const WEEK_WIDTH_PX = 132
const TIMELINE_MARKER_LABEL_BAND_PX = 0
const TIMELINE_HEADER_MARKER_BAND_PX = 18
const TIMELINE_BAR_GAP_PX = 8
const TRACK_ROW_VERTICAL_INSET_PX = 10
const TRACK_SUBLANE_GAP_PX = 8
const TRACK_ROW_HEIGHT_PX = 116
const STACKED_TRACK_ROW_HEIGHT_PX = 168
const ACTUAL_DELIVERY_ROW_HEIGHT_PX = 144

const TONE_STYLES: Record<
  RoadmapTone,
  {
    bar: string
    badge: string
    marker: string
    markerLabel: string
    card: string
    accent: string
  }
> = {
  stone: {
    bar: "bg-gradient-to-r from-stone-500/14 via-stone-400/10 to-stone-300/8 text-stone-100",
    badge: "bg-stone-100/10 text-stone-200",
    marker: "border-stone-400/50 bg-stone-300 text-stone-950",
    markerLabel: "bg-stone-300 text-stone-950",
    card: "border-stone-700/80 bg-stone-950/50",
    accent: "text-stone-200",
  },
  amber: {
    bar: "bg-gradient-to-r from-amber-500/18 via-amber-400/14 to-amber-300/10 text-amber-50",
    badge: "bg-amber-500/15 text-amber-200",
    marker: "border-amber-400/50 bg-amber-300 text-amber-950",
    markerLabel: "bg-amber-400 text-amber-950",
    card: "border-amber-500/30 bg-amber-500/8",
    accent: "text-amber-200",
  },
  sky: {
    bar: "bg-gradient-to-r from-sky-500/18 via-sky-400/14 to-sky-300/10 text-sky-50",
    badge: "bg-sky-500/15 text-sky-200",
    marker: "border-sky-400/50 bg-sky-300 text-sky-950",
    markerLabel: "bg-sky-400 text-sky-950",
    card: "border-sky-500/30 bg-sky-500/8",
    accent: "text-sky-200",
  },
  emerald: {
    bar: "bg-gradient-to-r from-emerald-500/16 via-emerald-400/12 to-emerald-300/8 text-emerald-50",
    badge: "bg-emerald-500/15 text-emerald-200",
    marker: "border-emerald-400/50 bg-emerald-300 text-emerald-950",
    markerLabel: "bg-emerald-400 text-emerald-950",
    card: "border-emerald-500/30 bg-emerald-500/8",
    accent: "text-emerald-200",
  },
  lime: {
    bar: "bg-gradient-to-r from-lime-500/16 via-lime-400/12 to-lime-300/8 text-lime-50",
    badge: "bg-lime-500/15 text-lime-200",
    marker: "border-lime-400/50 bg-lime-300 text-lime-950",
    markerLabel: "bg-lime-400 text-lime-950",
    card: "border-lime-500/30 bg-lime-500/8",
    accent: "text-lime-200",
  },
  rose: {
    bar: "bg-gradient-to-r from-rose-500/16 via-rose-400/12 to-rose-300/8 text-rose-50",
    badge: "bg-rose-500/15 text-rose-200",
    marker: "border-rose-400/50 bg-rose-300 text-rose-950",
    markerLabel: "bg-rose-500 text-white",
    card: "border-rose-500/30 bg-rose-500/8",
    accent: "text-rose-200",
  },
  red: {
    bar: "bg-gradient-to-r from-red-500/16 via-red-400/12 to-red-300/8 text-red-50",
    badge: "bg-red-500/15 text-red-200",
    marker: "border-red-400/50 bg-red-300 text-red-950",
    markerLabel: "bg-red-500 text-white",
    card: "border-red-500/30 bg-red-500/8",
    accent: "text-red-200",
  },
}

function weekLeftPct(startWeek: number, weekCount: number): number {
  return (startWeek / weekCount) * 100
}

function weekWidthPct(spanWeeks: number, weekCount: number): number {
  return (spanWeeks / weekCount) * 100
}

function formatCalendarRange(startIsoDate: string, endIsoDate: string): string {
  const startDate = new Date(`${startIsoDate}T00:00:00Z`)
  const endDate = new Date(`${endIsoDate}T00:00:00Z`)
  const startMonth = startDate.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  })
  const startDay = startDate.toLocaleDateString("en-US", {
    day: "numeric",
    timeZone: "UTC",
  })
  const endMonth = endDate.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  })
  const endDay = endDate.toLocaleDateString("en-US", {
    day: "numeric",
    timeZone: "UTC",
  })

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay} - ${endDay}`
  }

  return `${startMonth} ${startDay} - ${endMonth} ${endDay}`
}

function getPhaseCalendarRangeLabel(
  phase: RoadmapPhase,
  weeks: RoadmapWeek[],
): string {
  const startWeek = weeks[phase.startWeek]
  const endWeek = weeks[phase.startWeek + phase.spanWeeks - 1]

  if (!startWeek || !endWeek) {
    return phase.rangeLabel
  }

  const endDate = new Date(`${endWeek.isoDate}T00:00:00Z`)
  endDate.setUTCDate(endDate.getUTCDate() + 6)

  return `${phase.badge} | ${formatCalendarRange(
    startWeek.isoDate,
    endDate.toISOString().slice(0, 10),
  )}`
}

function renderWeekGuides(weeks: RoadmapWeek[], weekCount: number) {
  return weeks.map((week) => {
    const leftPct = (week.index / weekCount) * 100
    return (
      <div
        key={week.isoDate}
        className="absolute top-0 bottom-0 w-px border-r border-stone-800"
        style={{ left: `${leftPct}%` }}
      />
    )
  })
}

function isPlannedPhase(
  item: RoadmapPhase | RoadmapTrackBar,
): item is RoadmapPhase {
  return "sections" in item
}

function getPhaseSectionId(phaseId: string) {
  return `planned-phase-${phaseId}`
}

function getTrackSectionId(trackBarId: string) {
  return `planned-track-${trackBarId}`
}

function getTimelineTargetId(item: RoadmapPhase | RoadmapTrackBar) {
  return isPlannedPhase(item)
    ? getPhaseSectionId(item.id)
    : getTrackSectionId(item.id)
}

function getOverdueLeftPct(item: RoadmapPhase | RoadmapTrackBar) {
  if (!("overdueStartWeek" in item) || item.overdueStartWeek === undefined) {
    return null
  }

  const overdueOffsetWeeks = item.overdueStartWeek - item.startWeek

  return Math.max(0, Math.min(100, (overdueOffsetWeeks / item.spanWeeks) * 100))
}

function TimelineBar({
  item,
  topPx,
  heightPx,
  weekCount,
}: {
  item: RoadmapPhase | RoadmapTrackBar
  topPx: number
  heightPx: number
  weekCount: number
}) {
  const tone = TONE_STYLES[item.tone]
  const leftPct = weekLeftPct(item.startWeek, weekCount)
  const widthPct = Math.max(weekWidthPct(item.spanWeeks, weekCount), 8)
  const isCompact = heightPx <= 52
  const isActualDelivery = item.track.startsWith("actual-")
  const overdueLeftPct = getOverdueLeftPct(item)
  const showBadge = Boolean(item.badge) && !isCompact
  const targetId = getTimelineTargetId(item)
  return (
    <a
      href={`#${targetId}`}
      className={`absolute overflow-hidden rounded-xl shadow-[0_10px_24px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-sm transition-[transform,filter,box-shadow] duration-150 hover:-translate-y-0.5 hover:brightness-125 hover:saturate-140 hover:shadow-[0_16px_34px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.1)] focus:outline-none focus:ring-2 focus:ring-white/30 ${tone.bar} ${
        isCompact ? "px-4 py-1.5" : "px-3 py-2"
      } ${isActualDelivery ? "flex items-center" : ""}`}
      style={{
        left: `calc(${leftPct}% + ${TIMELINE_BAR_GAP_PX / 2}px)`,
        width: `calc(${widthPct}% - ${TIMELINE_BAR_GAP_PX}px)`,
        top: `${topPx}px`,
        height: `${heightPx}px`,
      }}
      aria-label={`Jump to ${item.title} details`}
    >
      <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-white/6" />
      {overdueLeftPct !== null && (
        <div
          className="pointer-events-none absolute top-0 right-0 bottom-0"
          style={{
            left: `${overdueLeftPct}%`,
            backgroundImage:
              "repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0 1px, transparent 1px 5px)",
          }}
        >
          <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[9px] font-semibold tracking-[0.18em] whitespace-nowrap text-white/45">
            DELAYED
          </span>
        </div>
      )}
      {showBadge && (
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${tone.badge}`}
          >
            {item.badge}
          </span>
        </div>
      )}
      <div
        className={`relative z-10 truncate font-semibold text-white ${
          isCompact || isActualDelivery
            ? "text-[13px] leading-4"
            : "mt-1 text-sm leading-5"
        }`}
      >
        {item.title}
      </div>
      {!isActualDelivery && (
        <div
          className={`relative z-10 text-stone-300 ${
            isCompact
              ? "mt-0.5 line-clamp-2 text-[10px] leading-3.5"
              : "line-clamp-2 text-[11px] leading-4"
          }`}
        >
          {item.summary}
        </div>
      )}
    </a>
  )
}

function getBarsForTrackIds(trackIds: string[], model: RoadmapTimelineModel) {
  return [
    ...model.phases.filter((phase) => trackIds.includes(phase.track)),
    ...model.trackBars.filter((bar) => trackIds.includes(bar.track)),
  ]
}

function TrackRow({
  row,
  model,
  showTopBorder = true,
}: {
  row: RoadmapTimelineRow
  model: RoadmapTimelineModel
  showTopBorder?: boolean
}) {
  const lanes = row.sublanes
    ? row.sublanes.map((sublane) => ({
        id: sublane.id,
        bars: getBarsForTrackIds(sublane.trackIds, model),
      }))
    : [{ id: row.id, bars: getBarsForTrackIds(row.trackIds, model) }]
  const isActualDeliveryRow = row.id === "delivery-actual"
  const rowHeightPx =
    lanes.length > 1
      ? isActualDeliveryRow
        ? ACTUAL_DELIVERY_ROW_HEIGHT_PX
        : STACKED_TRACK_ROW_HEIGHT_PX
      : TRACK_ROW_HEIGHT_PX
  const laneHeightPx =
    (rowHeightPx -
      TRACK_ROW_VERTICAL_INSET_PX * 2 -
      TRACK_SUBLANE_GAP_PX * (lanes.length - 1)) /
    lanes.length

  return (
    <div
      className={`grid ${showTopBorder ? "border-t border-stone-800" : ""}`}
      style={{
        gridTemplateColumns: `${TRACK_LABEL_WIDTH_PX}px minmax(0, 1fr)`,
      }}
    >
      <div className="flex items-center gap-3 px-4 py-4">
        <div>
          <div className="text-sm font-semibold text-white">{row.label}</div>
          {row.description && (
            <div className="text-xs text-stone-500">{row.description}</div>
          )}
        </div>
      </div>
      <div className="relative" style={{ height: `${rowHeightPx}px` }}>
        <div className="absolute inset-0">
          {renderWeekGuides(model.weeks, model.weekCount)}
        </div>
        <div className="absolute top-0 right-0 bottom-0 border-r border-stone-800" />
        {lanes.length > 1 &&
          !isActualDeliveryRow &&
          lanes.slice(0, -1).map((lane, index) => (
            <div
              key={`${row.id}-${lane.id}-divider`}
              className="absolute left-0 right-0 border-t border-stone-800/80"
              style={{
                top: `${TRACK_ROW_VERTICAL_INSET_PX + (index + 1) * laneHeightPx + index * TRACK_SUBLANE_GAP_PX + TRACK_SUBLANE_GAP_PX / 2}px`,
              }}
            />
          ))}
        {lanes.map((lane, index) => {
          const laneTopPx =
            TRACK_ROW_VERTICAL_INSET_PX +
            index * (laneHeightPx + TRACK_SUBLANE_GAP_PX)

          return lane.bars.map((bar) => (
            <TimelineBar
              key={`${row.id}-${lane.id}-${bar.id}`}
              item={bar}
              topPx={laneTopPx}
              heightPx={laneHeightPx}
              weekCount={model.weekCount}
            />
          ))
        })}
      </div>
    </div>
  )
}

function PhaseCard({
  phase,
  model,
}: {
  phase: RoadmapPhase
  model: RoadmapTimelineModel
}) {
  const tone = TONE_STYLES[phase.tone]
  const track = model.tracks.find((candidate) => candidate.id === phase.track)
  const calendarRangeLabel = getPhaseCalendarRangeLabel(phase, model.weeks)

  return (
    <div
      id={getPhaseSectionId(phase.id)}
      className={`scroll-mt-24 rounded-2xl border p-4 ${tone.card}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone.badge}`}
        >
          {phase.badge}
        </span>
        {track && (
          <span className="text-[11px] text-stone-500">{track.label}</span>
        )}
      </div>
      <h3 className="mt-3 text-base font-semibold text-white">{phase.title}</h3>
      <p className="mt-1 text-sm text-stone-300">{phase.summary}</p>
      <p className={`mt-2 text-xs ${tone.accent}`}>{calendarRangeLabel}</p>

      <div className="mt-4 space-y-4">
        {phase.sections.map((section) => (
          <div key={`${phase.id}-${section.label}`}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
              {section.label}
            </div>
            <ul className="mt-2 space-y-1.5 text-sm text-stone-300">
              {section.items.map((item) => (
                <li key={`${phase.id}-${section.label}-${item}`}>- {item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

function TrackBarCard({
  bar,
  tracks,
}: {
  bar: RoadmapTrackBar
  tracks: RoadmapTrack[]
}) {
  const tone = TONE_STYLES[bar.tone]
  const track = tracks.find((candidate) => candidate.id === bar.track)

  return (
    <div
      id={getTrackSectionId(bar.id)}
      className={`scroll-mt-24 rounded-2xl border p-4 ${tone.card}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {track && (
          <span className="text-[11px] text-stone-500">{track.label}</span>
        )}
      </div>
      <h3 className="mt-3 text-base font-semibold text-white">{bar.title}</h3>
      <p className="mt-1 text-sm text-stone-300">{bar.summary}</p>
      {bar.details && bar.details.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-sm text-stone-300">
          {bar.details.map((detail) => (
            <li key={`${bar.id}-${detail}`}>- {detail}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function PlannedRoadmapRenderer({
  variant,
}: {
  variant: RoadmapTimelineVariant
}) {
  const model = TIMELINE_MODELS[variant]
  const minWidthPx = TRACK_LABEL_WIDTH_PX + model.weekCount * WEEK_WIDTH_PX
  const [todayPct, setTodayPct] = useState<number | null>(null)

  useEffect(() => {
    const plannedStartDate = new Date(`${model.startIso}T00:00:00`)
    const today = new Date()
    const normalizedToday = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    )
    const todayOffsetDays =
      (normalizedToday.getTime() - plannedStartDate.getTime()) / DAY_MS
    const nextTodayPct = Math.max(
      0,
      Math.min(100, (todayOffsetDays / (model.weekCount * 7)) * 100),
    )

    setTodayPct(nextTodayPct)
  }, [model.startIso, model.weekCount])

  return (
    <div className="space-y-6">
      <div className="pr-0">
        <div className="-mr-4 overflow-hidden md:-mr-8">
          <div className="-mb-6 overflow-x-auto pb-6">
            <div
              className="relative"
              style={{
                minWidth: `${minWidthPx}px`,
                paddingTop: `${TIMELINE_HEADER_MARKER_BAND_PX}px`,
              }}
            >
              <div
                className="pointer-events-none absolute right-0 z-30"
                style={{
                  left: `${TRACK_LABEL_WIDTH_PX}px`,
                  top: "0px",
                  bottom: "0px",
                }}
              >
                {todayPct !== null && (
                  <div
                    className="absolute inset-y-0 z-30 w-px bg-red-500/70"
                    style={{ left: `${todayPct}%` }}
                  >
                    <div className="absolute left-1/2 top-0 -translate-x-1/2 rounded bg-red-500 px-1 py-px text-[9px] font-medium whitespace-nowrap text-white">
                      Today
                    </div>
                    <div
                      className="absolute left-1/2 w-px -translate-x-1/2 bg-red-500/70"
                      style={{
                        top: `${TIMELINE_HEADER_MARKER_BAND_PX - 2}px`,
                        bottom: "0px",
                      }}
                    />
                  </div>
                )}
              </div>

              <div
                className="grid"
                style={{
                  gridTemplateColumns: `${TRACK_LABEL_WIDTH_PX}px repeat(${model.weekCount}, minmax(${WEEK_WIDTH_PX}px, 1fr))`,
                }}
              >
                <div className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  Track
                </div>
                {model.weeks.map((week) => (
                  <div
                    key={week.isoDate}
                    className="flex flex-col items-center justify-center gap-0.5 px-1 py-3 text-center text-[11px] text-stone-500"
                  >
                    <div className="font-semibold text-stone-300">
                      {week.shortLabel}
                    </div>
                    <div className="text-[10px] text-stone-400">
                      {week.dateLabel}
                    </div>
                  </div>
                ))}
              </div>

              <div
                className="relative"
                style={{ paddingTop: `${TIMELINE_MARKER_LABEL_BAND_PX}px` }}
              >
                {model.rows.map((row, index) => (
                  <TrackRow
                    key={row.id}
                    row={row}
                    model={model}
                    showTopBorder={index !== 0}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 md:px-8">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-400">
          {model.legend.map((item) => (
            <span
              key={item.label}
              className={`flex items-center gap-1.5 ${
                item.divider ? "border-l border-stone-700 pl-3" : ""
              }`}
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${item.markerClassName}`}
              />
              {item.label}
            </span>
          ))}
          <span className="flex items-center gap-2 border-l border-stone-700 pl-3">
            <span className="h-3 border-l-2 border-l-red-500" />
            Today
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 md:px-8">
        <div className="grid gap-3 xl:grid-cols-2">
          {model.phases.map((phase) => (
            <PhaseCard key={phase.id} phase={phase} model={model} />
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 md:px-8">
        <div className="grid gap-3 xl:grid-cols-2">
          {model.trackBars.map((bar) => (
            <TrackBarCard key={bar.id} bar={bar} tracks={model.tracks} />
          ))}
        </div>
      </div>
    </div>
  )
}
