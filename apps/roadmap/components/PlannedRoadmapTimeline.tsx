"use client"

import { useEffect, useState } from "react"

import {
  PLANNED_PHASES,
  PLANNED_END_ISO,
  PLANNED_START_ISO,
  PLANNED_TIMELINE_ROWS,
  PLANNED_TRACK_BARS,
  PLANNED_TRACKS,
  PLANNED_WEEK_COUNT,
  PLANNED_WEEKS,
  type PlannedPhase,
  type PlannedTrackId,
  type PlannedTimelineRow,
  type PlannedTone,
  type PlannedTrackBar,
} from "@/lib/plannedRoadmap"

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
  PlannedTone,
  {
    bar: string
    badge: string
    card: string
    accent: string
  }
> = {
  stone: {
    bar: "bg-gradient-to-r from-stone-500/14 via-stone-400/10 to-stone-300/8 text-stone-100",
    badge: "bg-stone-100/10 text-stone-200",
    card: "border-stone-700/80 bg-stone-950/50",
    accent: "text-stone-200",
  },
  amber: {
    bar: "bg-gradient-to-r from-amber-500/18 via-amber-400/14 to-amber-300/10 text-amber-50",
    badge: "bg-amber-500/15 text-amber-200",
    card: "border-amber-500/30 bg-amber-500/8",
    accent: "text-amber-200",
  },
  sky: {
    bar: "bg-gradient-to-r from-sky-500/18 via-sky-400/14 to-sky-300/10 text-sky-50",
    badge: "bg-sky-500/15 text-sky-200",
    card: "border-sky-500/30 bg-sky-500/8",
    accent: "text-sky-200",
  },
  emerald: {
    bar: "bg-gradient-to-r from-emerald-500/16 via-emerald-400/12 to-emerald-300/8 text-emerald-50",
    badge: "bg-emerald-500/15 text-emerald-200",
    card: "border-emerald-500/30 bg-emerald-500/8",
    accent: "text-emerald-200",
  },
  lime: {
    bar: "bg-gradient-to-r from-lime-500/16 via-lime-400/12 to-lime-300/8 text-lime-50",
    badge: "bg-lime-500/15 text-lime-200",
    card: "border-lime-500/30 bg-lime-500/8",
    accent: "text-lime-200",
  },
  rose: {
    bar: "bg-gradient-to-r from-rose-500/16 via-rose-400/12 to-rose-300/8 text-rose-50",
    badge: "bg-rose-500/15 text-rose-200",
    card: "border-rose-500/30 bg-rose-500/8",
    accent: "text-rose-200",
  },
  red: {
    bar: "bg-gradient-to-r from-red-500/16 via-red-400/12 to-red-300/8 text-red-50",
    badge: "bg-red-500/15 text-red-200",
    card: "border-red-500/30 bg-red-500/8",
    accent: "text-red-200",
  },
}

function weekLeftPct(startWeek: number): number {
  return (startWeek / PLANNED_WEEK_COUNT) * 100
}

function weekWidthPct(spanWeeks: number): number {
  return (spanWeeks / PLANNED_WEEK_COUNT) * 100
}

function formatCalendarRange(startIsoDate: string, endIsoDate: string): string {
  const startDate = new Date(`${startIsoDate}T00:00:00`)
  const endDate = new Date(`${endIsoDate}T00:00:00`)
  const startMonth = startDate.toLocaleDateString("en-US", { month: "short" })
  const startDay = startDate.toLocaleDateString("en-US", { day: "numeric" })
  const endMonth = endDate.toLocaleDateString("en-US", { month: "short" })
  const endDay = endDate.toLocaleDateString("en-US", { day: "numeric" })

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay} - ${endDay}`
  }

  return `${startMonth} ${startDay} - ${endMonth} ${endDay}`
}

function getPhaseCalendarRangeLabel(phase: PlannedPhase): string {
  const startWeek = PLANNED_WEEKS[phase.startWeek]
  const endWeek = PLANNED_WEEKS[phase.startWeek + phase.spanWeeks - 1]

  if (!startWeek || !endWeek) {
    return phase.rangeLabel
  }

  const endDate = new Date(`${endWeek.isoDate}T00:00:00`)
  endDate.setDate(endDate.getDate() + 6)

  return `${phase.badge} | ${formatCalendarRange(
    startWeek.isoDate,
    endDate.toISOString().slice(0, 10),
  )}`
}

function renderWeekGuides() {
  return PLANNED_WEEKS.map((week) => {
    const leftPct = (week.index / PLANNED_WEEK_COUNT) * 100
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
  item: PlannedPhase | PlannedTrackBar,
): item is PlannedPhase {
  return "sections" in item
}

function getPhaseSectionId(phaseId: string) {
  return `planned-phase-${phaseId}`
}

function getTrackSectionId(trackBarId: string) {
  return `planned-track-${trackBarId}`
}

function getTimelineTargetId(item: PlannedPhase | PlannedTrackBar) {
  return isPlannedPhase(item)
    ? getPhaseSectionId(item.id)
    : getTrackSectionId(item.id)
}

function getOverdueLeftPct(item: PlannedPhase | PlannedTrackBar) {
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
}: {
  item: PlannedPhase | PlannedTrackBar
  topPx: number
  heightPx: number
}) {
  const tone = TONE_STYLES[item.tone]
  const leftPct = weekLeftPct(item.startWeek)
  const widthPct = weekWidthPct(item.spanWeeks)
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

function getBarsForTrackIds(trackIds: PlannedTrackId[]) {
  return [
    ...PLANNED_PHASES.filter((phase) => trackIds.includes(phase.track)),
    ...PLANNED_TRACK_BARS.filter((bar) => trackIds.includes(bar.track)),
  ]
}

function TrackRow({
  row,
  showTopBorder = true,
}: {
  row: PlannedTimelineRow
  showTopBorder?: boolean
}) {
  const lanes = row.sublanes
    ? row.sublanes.map((sublane) => ({
        id: sublane.id,
        bars: getBarsForTrackIds(sublane.trackIds),
      }))
    : [{ id: row.id, bars: getBarsForTrackIds(row.trackIds) }]
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
        <div className="absolute inset-0">{renderWeekGuides()}</div>
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
            />
          ))
        })}
      </div>
    </div>
  )
}

function PhaseCard({ phase }: { phase: PlannedPhase }) {
  const tone = TONE_STYLES[phase.tone]
  const track = PLANNED_TRACKS.find((candidate) => candidate.id === phase.track)
  const calendarRangeLabel = getPhaseCalendarRangeLabel(phase)

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

function TrackBarCard({ bar }: { bar: PlannedTrackBar }) {
  const tone = TONE_STYLES[bar.tone]
  const track = PLANNED_TRACKS.find((candidate) => candidate.id === bar.track)

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

export default function PlannedRoadmapTimeline() {
  const minWidthPx = TRACK_LABEL_WIDTH_PX + PLANNED_WEEK_COUNT * WEEK_WIDTH_PX
  const [todayPct, setTodayPct] = useState<number | null>(null)

  useEffect(() => {
    const plannedStartDate = new Date(`${PLANNED_START_ISO}T00:00:00`)
    const plannedEndDate = new Date(`${PLANNED_END_ISO}T00:00:00`)
    const today = new Date()
    const normalizedToday = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    )
    const todayOffsetDays =
      (normalizedToday.getTime() - plannedStartDate.getTime()) / DAY_MS
    const nextTodayPct =
      normalizedToday > plannedEndDate
        ? 100
        : Math.max(
            0,
            Math.min(100, (todayOffsetDays / (PLANNED_WEEK_COUNT * 7)) * 100),
          )

    setTodayPct(nextTodayPct)
  }, [])

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
                  gridTemplateColumns: `${TRACK_LABEL_WIDTH_PX}px repeat(${PLANNED_WEEK_COUNT}, minmax(${WEEK_WIDTH_PX}px, 1fr))`,
                }}
              >
                <div className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  Track
                </div>
                {PLANNED_WEEKS.map((week) => (
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
                {PLANNED_TIMELINE_ROWS.map((row, index) => (
                  <TrackRow
                    key={row.id}
                    row={row}
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
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-stone-300" />{" "}
            Foundation
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />{" "}
            Player / Experiences / Homepage
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-sky-400" />{" "}
            Search
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm bg-stone-700" />{" "}
            Year-end priorities
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />{" "}
            Agentic Framework
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-lime-400" />{" "}
            Mobile + TV
          </span>
          <span className="flex items-center gap-2 border-l border-stone-700 pl-3">
            <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
            Important events
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 border-l-2 border-l-red-500" />
            Today
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 md:px-8">
        <div className="grid gap-3 xl:grid-cols-2">
          {PLANNED_PHASES.map((phase) => (
            <PhaseCard key={phase.id} phase={phase} />
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 md:px-8">
        <div className="grid gap-3 xl:grid-cols-2">
          {PLANNED_TRACK_BARS.map((bar) => (
            <TrackBarCard key={bar.id} bar={bar} />
          ))}
        </div>
      </div>
    </div>
  )
}
