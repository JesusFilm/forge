"use client"

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import {
  BadgeCheck,
  Bot,
  ChevronDown,
  Circle,
  Clapperboard,
  Film,
  LibraryBig,
  ListFilter,
  ListVideo,
  Search,
  ServerOff,
  SquarePlay,
  Tags,
  X,
} from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LanguageSelectionEmptyState } from "./coverage-empty-state"
import { EnrichActionControls } from "./enrich-action-controls"
import { LanguageGeoSelector } from "./LanguageGeoSelector"
import {
  clearRememberedCoverageLanguageIds,
  hasSelectedLanguages as hasSelectedLanguagesInSelection,
  normalizeCoverageLanguageSearchParams,
  readRememberedCoverageLanguageIds,
  resolveCoverageLanguageSelection,
  resolveLanguagePresets,
  writeRememberedCoverageLanguageIds,
  type LanguageOption,
  type LanguagePreset,
} from "./language-selection"
import {
  cmsCollectionsToClientCollections,
  groupJobsIntoCollections,
  type ClientCollection,
  type ClientVideo,
  type CmsCollection,
  type CmsVideo,
  type CoverageFilter,
  type CoverageStatus,
  type ReportType,
} from "./coverage-report-model"
import {
  buildEnrichRequestErrorFeedback,
  getVideoQaSelectionDisabledReason,
  isEnrichActionReady,
  isEnrichSelectionInputEnabled,
  isVideoQaSelectable,
  requiresLanguageSelectionForEnrich,
  resolveEnrichSelectionOutcome,
  type EnrichFeedback,
} from "@/features/enrich-selection"
import {
  ManagerShellSidebarSlot,
  useOptionalManagerShellState,
} from "@/features/shell/manager-shell"
import { apiFetch } from "@/lib/api-fetch"
import { cn } from "@/lib/utils"
import type { JobRecord } from "@/types/job"

function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: hydrate after mount to avoid SSR mismatch
  useEffect(() => setHydrated(true), [])
  return hydrated
}

interface CoverageReportClientProps {
  gatewayConfigured: boolean
  initialErrorMessage: string | null
  initialJobs?: JobRecord[]
  initialSelectedLanguageIds: string[]
  initialLanguages: LanguageOption[]
}

type HoveredVideoDetails = {
  video: ClientVideo
  collectionTitle: string
  status: CoverageStatus
}

type FilterDropdownOption = {
  value: string
  label: string
}

function FilterDropdownOptionIcon({
  className,
  option,
}: {
  className?: string
  option: FilterDropdownOption
}) {
  const label = option.label.toLowerCase()
  const normalizedValue = option.value.toLowerCase()

  if (label === "media type") {
    return <ListFilter className={className} aria-hidden="true" />
  }
  if (label === "origin") {
    return <Tags className={className} aria-hidden="true" />
  }
  if (label === "collection") {
    return <LibraryBig className={className} aria-hidden="true" />
  }
  if (label === "feature film") {
    return <Film className={className} aria-hidden="true" />
  }
  if (label === "series") {
    return <ListVideo className={className} aria-hidden="true" />
  }
  if (label === "short film") {
    return <Clapperboard className={className} aria-hidden="true" />
  }
  if (label === "standalone") {
    return <SquarePlay className={className} aria-hidden="true" />
  }
  if (normalizedValue === "human") {
    return <BadgeCheck className={className} aria-hidden="true" />
  }
  if (normalizedValue === "ai") {
    return <Bot className={className} aria-hidden="true" />
  }
  if (normalizedValue === "none") {
    return <Circle className={className} aria-hidden="true" />
  }

  return <Tags className={className} aria-hidden="true" />
}

type ToggleVideoSelectionOptions = {
  animate?: boolean
  revealStackVideoIds?: string[]
  sourceElement?: HTMLElement | null
}

type FlightRect = {
  height: number
  left: number
  top: number
  width: number
}

type FlyingSelection = {
  from: FlightRect
  id: string
  mid: {
    x: number
    y: number
  }
  revealVideoIds: string[]
  to: FlightRect
  video: ClientVideo
}

type LeavingStackVideo = {
  id: string
  index: number
  video: ClientVideo
}

type SelectedStackSlot = {
  id: string
  index: number
  state: "leaving" | "selected"
  video: ClientVideo
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_REPORT_KEY = "forge-coverage-report"
const SELECTED_VIDEO_STACK_THUMB_WIDTH = 44
const SELECTED_VIDEO_STACK_THUMB_HEIGHT = 34
const SELECTED_VIDEO_STACK_OVERLAP = 12
const SELECTED_VIDEO_STACK_LEFT_PADDING = 2
const SELECTED_VIDEO_STACK_OVERFLOW_WIDTH = 38
const SELECTED_VIDEO_FLYER_MIN_WIDTH = 92
const SELECTED_VIDEO_FLYER_MIN_HEIGHT = 58

// ---------------------------------------------------------------------------
// Report configuration
// ---------------------------------------------------------------------------

const REPORT_CONFIG: Record<
  ReportType,
  {
    label: string
    description: string
    intro: string
    ariaLabel: string
    segmentLabels: Record<CoverageStatus, string>
    statusLabels: Record<CoverageStatus, string>
    legendLabels: Record<CoverageStatus, string>
  }
> = {
  subtitles: {
    label: "Subtitles",
    description: "Subtitle coverage for the selected language.",
    intro:
      "Track subtitle coverage by language, collection, and generation state.",
    ariaLabel: "Subtitle coverage",
    segmentLabels: {
      human: "Verified",
      ai: "AI",
      none: "None",
    },
    statusLabels: {
      human: "Verified subtitles",
      ai: "AI subtitles",
      none: "None",
    },
    legendLabels: {
      human: "Verified subtitles",
      ai: "AI subtitles",
      none: "None",
    },
  },
  audio: {
    label: "Audio",
    description: "Audio coverage for the selected language.",
    intro: "Track audio coverage by language, collection, and source state.",
    ariaLabel: "Audio coverage",
    segmentLabels: {
      human: "Verified",
      ai: "AI",
      none: "None",
    },
    statusLabels: {
      human: "Verified audio",
      ai: "AI voiceover",
      none: "None",
    },
    legendLabels: {
      human: "Verified audio",
      ai: "AI voiceover",
      none: "None",
    },
  },
  meta: {
    label: "Meta",
    description: "Metadata coverage for the selected language.",
    intro:
      "Track metadata coverage across titles, summaries, and generated review states.",
    ariaLabel: "Metadata coverage",
    segmentLabels: {
      human: "Verified",
      ai: "AI",
      none: "None",
    },
    statusLabels: {
      human: "Verified metadata",
      ai: "AI metadata",
      none: "None",
    },
    legendLabels: {
      human: "Verified metadata",
      ai: "AI metadata",
      none: "None",
    },
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPercent(count: number, total: number): number {
  if (total === 0) return 0
  return Math.round((count / total) * 100)
}

function getSelectableNoneVideos(videos: ClientVideo[]): ClientVideo[] {
  return videos.filter(
    (video) => video.coverageStatus === "none" && isVideoQaSelectable(video.id),
  )
}

function rectFromDomRect(rect: DOMRect): FlightRect {
  return {
    height: rect.height,
    left: rect.left,
    top: rect.top,
    width: rect.width,
  }
}

function rectFromFlySource(rect: DOMRect): FlightRect {
  if (
    rect.width >= SELECTED_VIDEO_STACK_THUMB_WIDTH &&
    rect.height >= SELECTED_VIDEO_STACK_THUMB_HEIGHT
  ) {
    return rectFromDomRect(rect)
  }

  return {
    height: SELECTED_VIDEO_FLYER_MIN_HEIGHT,
    left: rect.left + rect.width / 2 - SELECTED_VIDEO_FLYER_MIN_WIDTH / 2,
    top: rect.top + rect.height / 2 - SELECTED_VIDEO_FLYER_MIN_HEIGHT / 2,
    width: SELECTED_VIDEO_FLYER_MIN_WIDTH,
  }
}

function rectFromStackRightEnd(
  target: HTMLElement,
  visibleVideoCount: number,
): FlightRect {
  const rect = target.getBoundingClientRect()
  const visibleThumbCount = Math.min(visibleVideoCount, 4)
  const hasOverflow = visibleVideoCount > 4
  const slotCount = visibleThumbCount + (hasOverflow ? 1 : 0)
  const slotIndex = Math.max(0, slotCount - 1)
  const width = hasOverflow
    ? SELECTED_VIDEO_STACK_OVERFLOW_WIDTH
    : SELECTED_VIDEO_STACK_THUMB_WIDTH

  return {
    height: SELECTED_VIDEO_STACK_THUMB_HEIGHT,
    left:
      rect.left +
      SELECTED_VIDEO_STACK_LEFT_PADDING +
      slotIndex *
        (SELECTED_VIDEO_STACK_THUMB_WIDTH - SELECTED_VIDEO_STACK_OVERLAP),
    top:
      rect.top +
      Math.max(
        0,
        (Math.max(rect.height, 40) - SELECTED_VIDEO_STACK_THUMB_HEIGHT) / 2,
      ),
    width,
  }
}

function midpointForFlyer(
  from: FlightRect,
  to: FlightRect,
): FlyingSelection["mid"] {
  return {
    x: (to.left - from.left) * 0.52,
    y: (to.top - from.top) * 0.42 - 52,
  }
}

function getVideoInitial(title: string): string {
  return title.trim().charAt(0).toUpperCase() || "V"
}

function useSessionReportType(
  initial: ReportType,
): [ReportType, (value: ReportType) => void] {
  const [reportType, setReportType] = useState<ReportType>(initial)

  /* eslint-disable react-hooks/set-state-in-effect -- intentional: hydrate from sessionStorage after mount to avoid SSR mismatch */
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(SESSION_REPORT_KEY)
      if (stored === "subtitles" || stored === "audio" || stored === "meta") {
        setReportType(stored)
      }
    } catch {
      // ignore storage errors
    }
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  const updateReportType = useCallback((value: ReportType) => {
    setReportType(value)
    if (typeof window === "undefined") return
    try {
      window.sessionStorage.setItem(SESSION_REPORT_KEY, value)
    } catch {
      // ignore storage errors
    }
  }, [])

  return [reportType, updateReportType]
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CoverageBar({
  counts,
  activeFilter,
  onFilter,
  interactive,
  labels,
  ariaLabel,
}: {
  counts: { human: number; ai: number; none: number }
  activeFilter: CoverageFilter
  onFilter: (filter: CoverageFilter) => void
  interactive: boolean
  labels: Record<CoverageStatus, string>
  ariaLabel: string
}) {
  const total = counts.human + counts.ai + counts.none
  const segments: Array<{
    key: CoverageStatus
    label: string
    percent: number
    className: string
  }> = [
    {
      key: "human",
      label: labels.human,
      percent: formatPercent(counts.human, total),
      className: "stat-segment--human",
    },
    {
      key: "ai",
      label: labels.ai,
      percent: formatPercent(counts.ai, total),
      className: "stat-segment--ai",
    },
    {
      key: "none",
      label: labels.none,
      percent: Math.max(
        0,
        100 -
          formatPercent(counts.human, total) -
          formatPercent(counts.ai, total),
      ),
      className: "stat-segment--none",
    },
  ]

  const handleSegmentClick = (status: CoverageStatus) => {
    onFilter(status)
  }

  return (
    <div className={`coverage-bar${interactive ? " is-interactive" : ""}`}>
      <div className="stat-bar" aria-label={ariaLabel}>
        {segments.map((segment) => (
          <button
            key={segment.key}
            type="button"
            className={`stat-segment ${segment.className}${
              activeFilter === segment.key ? " is-active" : ""
            }`}
            style={{ width: `${segment.percent}%` }}
            title={`${segment.label} videos: ${counts[segment.key]}`}
            aria-pressed={activeFilter === segment.key}
            onClick={() => handleSegmentClick(segment.key)}
            disabled={!interactive}
          />
        ))}
      </div>
      <div className="stat-legend">
        {segments.map((segment) => (
          <button
            key={segment.key}
            type="button"
            className={`stat-legend-item stat-legend-item--${segment.key}${
              activeFilter === segment.key ? " is-active" : ""
            }`}
            onClick={() => handleSegmentClick(segment.key)}
            disabled={!interactive}
          >
            {segment.label} {segment.percent}%
          </button>
        ))}
      </div>
    </div>
  )
}

function CoverageNumberDiagram({
  counts,
  activeFilter,
  onFilter,
  interactive,
  labels,
  ariaLabel,
}: {
  counts: { human: number; ai: number; none: number }
  activeFilter: CoverageFilter
  onFilter: (filter: CoverageFilter) => void
  interactive: boolean
  labels: Record<CoverageStatus, string>
  ariaLabel: string
}) {
  const total = counts.human + counts.ai + counts.none
  const humanPercent = formatPercent(counts.human, total)
  const aiPercent = formatPercent(counts.ai, total)
  const segments: Array<{
    key: CoverageStatus
    label: string
    percent: number
  }> = [
    {
      key: "human",
      label: labels.human,
      percent: humanPercent,
    },
    {
      key: "none",
      label: labels.none,
      percent: Math.max(0, 100 - humanPercent - aiPercent),
    },
    {
      key: "ai",
      label: labels.ai,
      percent: aiPercent,
    },
  ]
  const toggleFilter = (status: CoverageStatus) => {
    onFilter(activeFilter === status ? "all" : status)
  }

  return (
    <div
      className={`coverage-number-diagram${interactive ? " is-interactive" : ""}`}
      aria-label={ariaLabel}
    >
      {segments.map((segment) => (
        <button
          key={segment.key}
          type="button"
          className={`coverage-number-item coverage-number-item--${segment.key}${
            activeFilter === segment.key ? " is-active" : ""
          }`}
          aria-pressed={interactive ? activeFilter === segment.key : undefined}
          aria-label={`${segment.label} ${segment.percent}%`}
          onClick={() => toggleFilter(segment.key)}
          disabled={!interactive}
        >
          <span className="coverage-number-value">
            {segment.percent}
            <span className="coverage-number-percent">%</span>
          </span>
          <span className="coverage-number-label">{segment.label}</span>
        </button>
      ))}
    </div>
  )
}

function CoverageFilterDropdown({
  value,
  onChange,
  labels,
  options: customOptions,
}: {
  value: string
  onChange: (value: string) => void
  labels?: Record<CoverageStatus, string>
  options?: FilterDropdownOption[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const shellRef = useRef<HTMLSpanElement | null>(null)

  const options: FilterDropdownOption[] = customOptions ?? [
    { value: "all", label: "Origin" },
    { value: "human", label: labels?.human ?? "Verified" },
    { value: "ai", label: labels?.ai ?? "AI" },
    { value: "none", label: labels?.none ?? "None" },
  ]

  const currentLabel = options.find((o) => o.value === value)?.label ?? "Origin"
  const defaultValue = options[0]?.value ?? "all"
  const isActive = value !== defaultValue
  const currentOption = { value, label: currentLabel }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false)
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (
        shellRef.current &&
        !shellRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  return (
    <span className="relative w-auto shrink-0" ref={shellRef}>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className={cn(
          "h-10 w-[7.5rem] max-w-full cursor-pointer select-none justify-between gap-1 rounded-xl border-[color:color-mix(in_srgb,var(--ds-black)_14%,transparent)] bg-transparent px-2 text-sm font-medium text-[color:var(--ds-muted)] shadow-none ring-0 transition-colors duration-75 hover:bg-[color:color-mix(in_srgb,var(--ds-black)_6%,transparent)] active:bg-[color:color-mix(in_srgb,var(--ds-black)_10%,transparent)] focus-visible:border-[color:var(--ds-black)] focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)] sm:w-[10.5rem] sm:gap-2 sm:px-3",
          (isOpen || isActive) &&
            "border-[color:var(--ds-black)] bg-[color:color-mix(in_srgb,var(--ds-black)_3%,transparent)] ring-[0.5px] ring-[color:var(--ds-black)]",
          isActive && "text-[color:var(--ds-ink)]",
        )}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-pressed={isActive}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <FilterDropdownOptionIcon
            className="size-4 shrink-0 text-[color:var(--ds-muted)]"
            option={currentOption}
          />
          <span className="truncate text-left">{currentLabel}</span>
        </span>
        <ChevronDown
          className="size-4 text-[color:var(--ds-muted)] sm:size-5"
          aria-hidden="true"
        />
      </Button>
      {isOpen && (
        <div
          className="absolute left-0 right-0 top-full z-[70] mt-1.5 flex flex-col gap-1 rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] p-1 shadow-[0_12px_30px_rgba(8,8,8,0.12)] sm:left-auto sm:min-w-full"
          role="listbox"
          aria-label="Coverage filter"
        >
          {options.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant="ghost"
              size="lg"
              className={cn(
                "h-9 justify-start gap-2 rounded-lg px-3 text-sm font-medium text-[color:var(--ds-ink)] transition-colors duration-75 hover:bg-[color:color-mix(in_srgb,var(--ds-black)_6%,transparent)]",
                option.value === value &&
                  "bg-[color:var(--ds-hover)] font-medium text-[color:var(--ds-black)]",
              )}
              onClick={() => {
                onChange(option.value)
                setIsOpen(false)
              }}
              role="option"
              aria-selected={option.value === value}
            >
              <FilterDropdownOptionIcon
                className="size-4 shrink-0 text-[color:var(--ds-muted)]"
                option={option}
              />
              <span className="min-w-0 truncate">{option.label}</span>
            </Button>
          ))}
        </div>
      )}
    </span>
  )
}

export function SelectedVideoStack({
  leavingVideos = [],
  videos,
}: {
  leavingVideos?: LeavingStackVideo[]
  videos: ClientVideo[]
}) {
  if (videos.length === 0 && leavingVideos.length === 0) {
    return null
  }

  const selectedSlots: SelectedStackSlot[] = videos
    .slice(0, 4)
    .map((video, index) => ({
      id: video.id,
      index,
      state: "selected",
      video,
    }))
  const selectedIds = new Set(videos.map((video) => video.id))
  const stackSlots: SelectedStackSlot[] = [...selectedSlots]

  for (const leaving of leavingVideos) {
    if (selectedIds.has(leaving.video.id) || leaving.index > 3) {
      continue
    }

    stackSlots.splice(Math.min(leaving.index, stackSlots.length), 0, {
      id: leaving.id,
      index: leaving.index,
      state: "leaving" as const,
      video: leaving.video,
    })
  }

  const visibleSlots = stackSlots.slice(0, 4)
  const overflowCount = Math.max(0, videos.length - 4)

  return (
    <div
      className="selected-video-stack"
      aria-label={`${videos.length} selected video${videos.length === 1 ? "" : "s"}`}
    >
      <div className="selected-video-stack-list" aria-hidden="true">
        {visibleSlots.map((slot, index) => (
          <span
            key={slot.id}
            className={`selected-video-stack-thumb${
              slot.state === "leaving" ? " is-leaving" : ""
            }${slot.video.imageUrl ? " has-image" : ""}`}
            style={
              {
                "--stack-index": index,
                backgroundImage: slot.video.imageUrl
                  ? `url("${slot.video.imageUrl}")`
                  : undefined,
              } as React.CSSProperties
            }
            aria-label={slot.video.title}
          >
            {slot.video.imageUrl ? null : getVideoInitial(slot.video.title)}
          </span>
        ))}
        {overflowCount > 0 ? (
          <span className="selected-video-stack-overflow">
            +{overflowCount}
          </span>
        ) : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Collection card
// ---------------------------------------------------------------------------

type CollectionCardProps = {
  collection: ClientCollection
  reportConfig: (typeof REPORT_CONFIG)[ReportType]
  filter: CoverageFilter
  isExpanded: boolean
  isSelectMode: boolean
  selectionLocked: boolean
  selectedVideoIds: Set<string>
  searchMatchIds: Set<string>
  onToggleExpanded: (collectionId: string) => void
  onHoverVideo: (details: HoveredVideoDetails | null) => void
  onToggleVideo: (
    videoId: string,
    options?: ToggleVideoSelectionOptions,
  ) => void
}

const CollectionCard = memo(function CollectionCard({
  collection,
  reportConfig,
  filter,
  isExpanded,
  isSelectMode,
  selectionLocked,
  selectedVideoIds,
  searchMatchIds,
  onToggleExpanded,
  onHoverVideo,
  onToggleVideo,
}: CollectionCardProps) {
  const total = collection.videos.length

  const counts = useMemo(() => {
    return collection.videos.reduce(
      (acc, video) => {
        acc[video.coverageStatus] += 1
        return acc
      },
      { human: 0, ai: 0, none: 0 },
    )
  }, [collection.videos])

  const filteredVideos = useMemo(() => {
    if (filter === "all") return collection.videos
    return collection.videos.filter((video) => video.coverageStatus === filter)
  }, [collection.videos, filter])

  const toggleCollectionNoneVideos = useCallback(
    (sourceElement?: HTMLElement | null) => {
      const noneVideos = getSelectableNoneVideos(collection.videos)
      const allNoneSelected =
        noneVideos.length > 0 &&
        noneVideos.every((v) => selectedVideoIds.has(v.id))

      if (allNoneSelected) {
        for (const v of noneVideos) {
          onToggleVideo(v.id, { animate: false })
        }
        return
      }

      const newlySelectedVideos = noneVideos.filter(
        (v) => !selectedVideoIds.has(v.id),
      )
      const revealStackVideoIds = newlySelectedVideos.map((v) => v.id)

      newlySelectedVideos.forEach((v, index) => {
        onToggleVideo(v.id, {
          animate: index === 0,
          revealStackVideoIds:
            index === 0 && revealStackVideoIds.length > 0
              ? revealStackVideoIds
              : undefined,
          sourceElement,
        })
      })
    },
    [collection.videos, onToggleVideo, selectedVideoIds],
  )

  return (
    <section className="collection-card" key={collection.id}>
      <div
        className="collection-header"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={() => onToggleExpanded(collection.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onToggleExpanded(collection.id)
          }
        }}
      >
        <div className="collection-title-row">
          {isSelectMode &&
            (() => {
              const noneVideos = getSelectableNoneVideos(collection.videos)
              const allNoneSelected =
                noneVideos.length > 0 &&
                noneVideos.every((v) => selectedVideoIds.has(v.id))
              const selectionInputEnabled = isEnrichSelectionInputEnabled({
                isSelectMode,
                isSelectable: noneVideos.length > 0,
                isSubmitting: selectionLocked,
              })

              return noneVideos.length > 0 ? (
                <span
                  role="checkbox"
                  aria-checked={allNoneSelected}
                  aria-label={`Select all ${noneVideos.length} uncovered videos eligible for QA enrichment`}
                  aria-disabled={!selectionInputEnabled}
                  tabIndex={selectionInputEnabled ? 0 : undefined}
                  className={`tile tile--none tile--select collection-select-all${allNoneSelected ? " is-selected" : ""}${selectionInputEnabled ? "" : " is-disabled"}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!selectionInputEnabled) return
                    toggleCollectionNoneVideos(e.currentTarget)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault()
                      e.stopPropagation()
                      if (!selectionInputEnabled) return
                      toggleCollectionNoneVideos(e.currentTarget)
                    }
                  }}
                >
                  <span className="tile-checkbox" aria-hidden="true">
                    <span className="tile-checkbox-box" />
                  </span>
                </span>
              ) : null
            })()}
          <div className="collection-title-block">
            <div className="collection-title-line">
              <h2 className="collection-title">{collection.title}</h2>
              <span
                className={`collection-label collection-label--${collection.label}`}
                aria-label={`Group type: ${collection.labelDisplay}`}
              >
                {collection.labelDisplay}
              </span>
            </div>
            <div className="collection-meta-row">
              <p className="collection-meta">
                {total} video{total === 1 ? "" : "s"}
              </p>
            </div>
          </div>
        </div>
        <div className="collection-stats">
          <CoverageBar
            counts={counts}
            activeFilter="all"
            onFilter={() => {}}
            interactive={false}
            labels={reportConfig.segmentLabels}
            ariaLabel={reportConfig.ariaLabel}
          />
        </div>
      </div>
      <div className={`collection-divider${isExpanded ? " is-open" : ""}`}>
        <button
          type="button"
          className="collection-toggle"
          onClick={(event) => {
            event.stopPropagation()
            onToggleExpanded(collection.id)
          }}
          aria-expanded={isExpanded}
        >
          {isExpanded ? (
            <>
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="icon"
                aria-hidden="true"
              >
                <path d="m18 15-6-6-6 6" />
              </svg>
              Hide details
            </>
          ) : (
            <>
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="icon"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
              Show details
            </>
          )}
        </button>
      </div>
      <div className={`collection-details${isExpanded ? " is-open" : ""}`}>
        {(["human", "ai", "none"] as const).map((groupStatus) => {
          const groupVideos = filteredVideos.filter(
            (v) => v.coverageStatus === groupStatus,
          )
          if (groupVideos.length === 0) return null

          return (
            <div key={groupStatus} className="detail-group">
              <h3
                className={`detail-group-heading detail-group-heading--${groupStatus}`}
              >
                {reportConfig.statusLabels[groupStatus]}
                <span className="detail-group-count">{groupVideos.length}</span>
              </h3>
              <div className="detail-group-list">
                {groupVideos.map((video) => {
                  const status = groupStatus
                  const isSelected =
                    isSelectMode && selectedVideoIds.has(video.id)
                  const isSelectable = isVideoQaSelectable(video.id)
                  const selectionInputEnabled = isEnrichSelectionInputEnabled({
                    isSelectMode,
                    isSelectable,
                    isSubmitting: selectionLocked,
                  })
                  const detailRowDisabled =
                    isSelectMode &&
                    (!isSelectable || (isSelectMode && selectionLocked))
                  const disabledReason = getVideoQaSelectionDisabledReason(
                    video.id,
                  )
                  const rowContent = (
                    <>
                      {isSelectMode ? (
                        <input
                          type="checkbox"
                          className={`detail-row-checkbox detail-row-checkbox--${status}${status !== "none" && video.coverageCounts.none > 0 ? " detail-row-checkbox--partial" : ""}${searchMatchIds.has(video.id) ? " detail-row-checkbox--search-match" : ""}`}
                          checked={isSelected}
                          disabled={!selectionInputEnabled}
                          onChange={(event) =>
                            onToggleVideo(video.id, {
                              sourceElement: event.currentTarget,
                            })
                          }
                        />
                      ) : null}
                      <span className="detail-content">
                        {video.id.startsWith("collection:")
                          ? `${video.title} (collection)`
                          : video.title}
                      </span>
                    </>
                  )

                  return isSelectMode ? (
                    <label
                      className={`collection-detail-row${searchMatchIds.has(video.id) ? " detail-row--search-match" : ""}${detailRowDisabled ? " is-disabled" : ""}`}
                      key={video.id}
                      aria-label={
                        isSelectMode && selectionLocked
                          ? "Creating enrichment jobs..."
                          : (disabledReason ?? undefined)
                      }
                      onMouseEnter={() =>
                        onHoverVideo({
                          video,
                          collectionTitle: collection.title,
                          status,
                        })
                      }
                      onMouseLeave={() => onHoverVideo(null)}
                    >
                      {rowContent}
                    </label>
                  ) : (
                    <div
                      className={`collection-detail-row${searchMatchIds.has(video.id) ? " detail-row--search-match" : ""}`}
                      key={video.id}
                      onMouseEnter={() =>
                        onHoverVideo({
                          video,
                          collectionTitle: collection.title,
                          status,
                        })
                      }
                      onMouseLeave={() => onHoverVideo(null)}
                    >
                      {rowContent}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div className={`collection-tiles${isExpanded ? " is-hidden" : ""}`}>
        {filteredVideos.map((video) => {
          const status = video.coverageStatus
          const statusLabel = reportConfig.statusLabels[status]
          const videoDetails = {
            video,
            collectionTitle: collection.title,
            status,
          } satisfies HoveredVideoDetails
          const isSelected = isSelectMode && selectedVideoIds.has(video.id)
          const isSelectable = isVideoQaSelectable(video.id)
          const isInteractive = isSelectMode
            ? isEnrichSelectionInputEnabled({
                isSelectMode,
                isSelectable,
                isSubmitting: selectionLocked,
              })
            : false
          const disabledReason = getVideoQaSelectionDisabledReason(video.id)
          const title = isSelectMode
            ? selectionLocked
              ? `${video.title} -- ${statusLabel} -- Creating enrichment jobs...`
              : isSelectable
                ? `${video.title} -- ${statusLabel}`
                : `${video.title} -- ${statusLabel} -- ${disabledReason ?? "Not selectable"}`
            : `${video.title} -- ${statusLabel}`

          return (
            <span
              key={video.id}
              role={isInteractive ? "checkbox" : undefined}
              aria-checked={isInteractive ? isSelected : undefined}
              tabIndex={isInteractive ? 0 : undefined}
              className={`tile ${video.id.startsWith("collection:") ? "tile--collection" : "tile--video"} tile--${status}${status !== "none" && video.coverageCounts.none > 0 ? " tile--partial" : ""}${searchMatchIds.has(video.id) ? " tile--search-match" : ""}${isSelectMode ? " tile--select" : " tile--coverage"}${isSelected ? " is-selected" : ""}${isSelectMode && !isSelectable ? " is-unselectable" : ""}${isSelectMode && selectionLocked ? " is-disabled" : ""}`}
              aria-label={title}
              onClick={
                isInteractive
                  ? (event) => {
                      onToggleVideo(video.id, {
                        sourceElement: event.currentTarget,
                      })
                    }
                  : undefined
              }
              onKeyDown={
                isInteractive
                  ? (e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault()
                        onToggleVideo(video.id, {
                          sourceElement: e.currentTarget,
                        })
                      }
                    }
                  : undefined
              }
              onMouseEnter={() => onHoverVideo(videoDetails)}
              onMouseLeave={() => onHoverVideo(null)}
              onFocus={() => onHoverVideo(videoDetails)}
              onBlur={() => onHoverVideo(null)}
            >
              <span className="tile-checkbox" aria-hidden="true">
                <span className="tile-checkbox-box" />
              </span>
            </span>
          )
        })}
        {filteredVideos.length === 0 && (
          <p className="collection-empty">No videos in this collection.</p>
        )}
      </div>
    </section>
  )
})

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CoverageReportClient({
  gatewayConfigured,
  initialErrorMessage,
  initialJobs,
  initialSelectedLanguageIds,
  initialLanguages,
}: CoverageReportClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentCoverageQuery = searchParams.toString()
  const shell = useOptionalManagerShellState()
  const [videoCollections, setVideoCollections] = useState<CmsCollection[]>([])
  const [videoCollectionsLoadFailed, setVideoCollectionsLoadFailed] =
    useState(false)
  const [isLoadingVideos, setIsLoadingVideos] = useState(true)
  const [storedReportType] = useSessionReportType("subtitles")
  const shellReportType = shell?.reportType
  const reportType: ReportType =
    shellReportType === "subtitles" ||
    shellReportType === "audio" ||
    shellReportType === "meta"
      ? shellReportType
      : storedReportType

  // Snapshot data for instant header bar rendering (pre-computed daily)
  type SnapshotData = {
    totalVideos: number
    videosWithAiMetadata: number
    videosWithHumanMetadata: number
    subtitlesHumanTotal: number
    subtitlesAiTotal: number
    audioHumanTotal: number
    audioAiTotal: number
    languageCoverage: Array<{
      languageCoreId: string
      subtitlesHuman: number
      subtitlesAi: number
      audioHuman: number
      audioAi: number
    }>
  }
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null)

  const collections = useMemo(() => {
    if (videoCollections.length > 0) {
      return cmsCollectionsToClientCollections(videoCollections, reportType)
    }
    return groupJobsIntoCollections(initialJobs ?? [])
  }, [videoCollections, initialJobs, reportType])
  const selectedLanguageIds = initialSelectedLanguageIds
  const languageOptions = initialLanguages
  const [languageCatalog, setLanguageCatalog] = useState<LanguageOption[]>([])
  const [languageNameMap, setLanguageNameMap] = useState<Map<string, string>>(
    new Map(),
  )
  const automaticCoverageSelectionQueryRef = useRef<string | null>(null)
  // Fetch language names once for display in the selection bar
  useEffect(() => {
    void (async () => {
      try {
        const response = await apiFetch("/api/languages")
        if (!response.ok) return
        const payload = (await response.json()) as {
          languages: LanguageOption[]
        }
        const map = new Map<string, string>()
        for (const lang of payload.languages ?? []) {
          map.set(lang.id, lang.englishLabel)
        }
        setLanguageCatalog(payload.languages ?? [])
        setLanguageNameMap(map)
      } catch {
        // ignore — will fall back to IDs
      }
    })()
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return

    const currentQuery = currentCoverageQuery
    const rememberedLanguageIds = readRememberedCoverageLanguageIds(
      window.sessionStorage,
    )
    if (
      languageCatalog.length === 0 &&
      currentQuery.length === 0 &&
      rememberedLanguageIds.length === 0
    ) {
      return
    }

    const resolution = resolveCoverageLanguageSelection({
      currentQuery,
      rememberedLanguageIds,
      languages: languageCatalog,
    })

    if (automaticCoverageSelectionQueryRef.current === currentQuery) {
      automaticCoverageSelectionQueryRef.current = null
    } else if (resolution.shouldRememberSelection) {
      writeRememberedCoverageLanguageIds(
        window.sessionStorage,
        resolution.languageIds,
      )
    }

    if (!resolution.shouldReplaceUrl) return

    const nextParams = normalizeCoverageLanguageSearchParams(
      currentQuery,
      resolution.languageIds,
    )
    const queryString = nextParams.toString()
    const nextUrl = queryString
      ? `/dashboard/coverage?${queryString}`
      : "/dashboard/coverage"

    if (`${window.location.pathname}${window.location.search}` === nextUrl) {
      return
    }

    automaticCoverageSelectionQueryRef.current = queryString

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- typed routes does not accept dynamic query strings here
    router.replace(nextUrl as any)
  }, [currentCoverageQuery, languageCatalog, router])
  const errorMessage = initialErrorMessage
  const [filter, setFilter] = useState<CoverageFilter>("all")
  const [hoveredVideo, setHoveredVideo] = useState<HoveredVideoDetails | null>(
    null,
  )
  const [expandedCollections, setExpandedCollections] = useState<string[]>([])

  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(
    new Set(),
  )
  const [flyingSelection, setFlyingSelection] =
    useState<FlyingSelection | null>(null)
  const [leavingStackVideos, setLeavingStackVideos] = useState<
    LeavingStackVideo[]
  >([])
  const [withheldStackVideoIds, setWithheldStackVideoIds] = useState<
    Set<string>
  >(new Set())
  const [enrichFeedback, setEnrichFeedback] = useState<EnrichFeedback | null>(
    null,
  )
  const [isEnrichSubmitting, setIsEnrichSubmitting] = useState(false)
  const enrichRequestSeqRef = useRef(0)
  const cancelledEnrichRequestSeqRef = useRef<number | null>(null)
  const selectedStackTargetRef = useRef<HTMLDivElement | null>(null)
  const leavingStackTimeoutsRef = useRef<number[]>([])
  const [
    languageSelectorFocusRequestCount,
    setLanguageSelectorFocusRequestCount,
  ] = useState(0)
  const [
    languageSelectorOpenRequestCount,
    setLanguageSelectorOpenRequestCount,
  ] = useState(0)
  const hydrated = useHydrated()
  const reportConfig = REPORT_CONFIG[reportType]
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const hasSelectedLanguages =
    hasSelectedLanguagesInSelection(selectedLanguageIds)
  const isSelectMode = reportType === "subtitles"
  const videoById = useMemo(() => {
    const byId = new Map<string, ClientVideo>()
    for (const collection of collections) {
      for (const video of collection.videos) {
        byId.set(video.id, video)
      }
    }
    return byId
  }, [collections])
  const selectedVideos = useMemo(
    () =>
      Array.from(selectedVideoIds)
        .map((videoId) => videoById.get(videoId))
        .filter((video): video is ClientVideo => Boolean(video)),
    [selectedVideoIds, videoById],
  )
  const displayedSelectedVideos = useMemo(
    () =>
      selectedVideos.filter((video) => !withheldStackVideoIds.has(video.id)),
    [selectedVideos, withheldStackVideoIds],
  )
  const selectableVideoIds = useMemo(
    () =>
      new Set(
        collections
          .flatMap((collection) => collection.videos)
          .filter((video) => isVideoQaSelectable(video.id))
          .map((video) => video.id),
      ),
    [collections],
  )
  const selectedVideoCount = selectedVideoIds.size
  const selectedLanguageCount = selectedLanguageIds.length
  const languageSelectionRequired = requiresLanguageSelectionForEnrich(
    selectedVideoCount,
    selectedLanguageCount,
  )
  const enrichActionReady = isEnrichActionReady(
    selectedVideoCount,
    selectedLanguageCount,
  )

  useEffect(() => {
    if (!languageSelectionRequired) {
      return
    }

    setLanguageSelectorFocusRequestCount((prev) => prev + 1)
  }, [languageSelectionRequired, selectedVideoCount])

  useEffect(() => {
    return () => {
      for (const timeoutId of leavingStackTimeoutsRef.current) {
        window.clearTimeout(timeoutId)
      }
      leavingStackTimeoutsRef.current = []
    }
  }, [])

  const queueLeavingStackVideo = useCallback(
    (video: ClientVideo, index: number) => {
      const leavingId = `${video.id}-${Date.now()}`
      setLeavingStackVideos((prev) => [
        ...prev.filter((item) => item.video.id !== video.id),
        { id: leavingId, index, video },
      ])

      const timeoutId = window.setTimeout(() => {
        setLeavingStackVideos((prev) =>
          prev.filter((item) => item.id !== leavingId),
        )
        leavingStackTimeoutsRef.current =
          leavingStackTimeoutsRef.current.filter((id) => id !== timeoutId)
      }, 220)
      leavingStackTimeoutsRef.current.push(timeoutId)
    },
    [],
  )

  const startFlyingSelection = useCallback(
    (
      video: ClientVideo,
      sourceElement?: HTMLElement | null,
      revealVideoIds: string[] = [video.id],
      visibleStackVideoCountAfterReveal = revealVideoIds.length,
    ) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const previewElement = document.querySelector<HTMLElement>(
            "[data-fly-preview-video-id]",
          )
          const sourceRect =
            previewElement?.dataset.flyPreviewVideoId === video.id
              ? previewElement.getBoundingClientRect()
              : sourceElement?.getBoundingClientRect()
          const stackTarget = selectedStackTargetRef.current
          const targetRect = stackTarget
            ? rectFromStackRightEnd(
                stackTarget,
                visibleStackVideoCountAfterReveal,
              )
            : null

          if (!sourceRect || !targetRect) {
            setWithheldStackVideoIds((prev) => {
              const next = new Set(prev)
              for (const id of revealVideoIds) {
                next.delete(id)
              }
              return next
            })
            return
          }

          const from = rectFromFlySource(sourceRect)

          setFlyingSelection({
            from,
            id: `${video.id}-${Date.now()}`,
            mid: midpointForFlyer(from, targetRect),
            revealVideoIds,
            to: targetRect,
            video,
          })
        })
      })
    },
    [],
  )

  const toggleVideoSelection = useCallback(
    (videoId: string, options: ToggleVideoSelectionOptions = {}) => {
      if (isEnrichSubmitting || !selectableVideoIds.has(videoId)) {
        return
      }

      const video = videoById.get(videoId)
      const wasSelected = selectedVideoIds.has(videoId)
      const revealStackVideoIds = options.revealStackVideoIds ?? [videoId]

      setEnrichFeedback(null)

      if (wasSelected && video && options.animate !== false) {
        queueLeavingStackVideo(
          video,
          Array.from(selectedVideoIds).indexOf(videoId),
        )
      }

      if (wasSelected) {
        setWithheldStackVideoIds((prev) => {
          if (!prev.has(videoId)) return prev
          const next = new Set(prev)
          next.delete(videoId)
          return next
        })
      } else if (video && options.animate !== false) {
        setWithheldStackVideoIds((prev) => {
          const next = new Set(prev)
          for (const id of revealStackVideoIds) {
            next.add(id)
          }
          return next
        })
      }

      setSelectedVideoIds((prev) => {
        const next = new Set(prev)
        if (next.has(videoId)) next.delete(videoId)
        else next.add(videoId)
        return next
      })

      if (!wasSelected && video && options.animate !== false) {
        startFlyingSelection(
          video,
          options.sourceElement,
          revealStackVideoIds,
          selectedVideoIds.size + revealStackVideoIds.length,
        )
      }
    },
    [
      isEnrichSubmitting,
      queueLeavingStackVideo,
      selectableVideoIds,
      selectedVideoIds,
      startFlyingSelection,
      videoById,
    ],
  )

  useEffect(() => {
    setSelectedVideoIds((prev) => {
      const next = new Set(
        Array.from(prev).filter((videoId) => selectableVideoIds.has(videoId)),
      )

      if (next.size === prev.size) {
        return prev
      }

      return next
    })
    setWithheldStackVideoIds((prev) => {
      const next = new Set(
        Array.from(prev).filter((videoId) => selectableVideoIds.has(videoId)),
      )

      if (next.size === prev.size) {
        return prev
      }

      return next
    })
  }, [selectableVideoIds])

  useEffect(() => {
    if (!isSelectMode) {
      setEnrichFeedback(null)
      setFlyingSelection(null)
      setLeavingStackVideos([])
      setWithheldStackVideoIds(new Set())
      setSelectedVideoIds(new Set())
    }
  }, [isSelectMode])

  const handleEnrichSelection = useCallback(async () => {
    if (!enrichActionReady || isEnrichSubmitting) {
      return
    }

    const requestSeq = enrichRequestSeqRef.current + 1
    enrichRequestSeqRef.current = requestSeq
    cancelledEnrichRequestSeqRef.current = null
    const requestSelectedVideoIds = new Set(selectedVideoIds)
    const shouldIgnoreRequest = () =>
      enrichRequestSeqRef.current !== requestSeq ||
      cancelledEnrichRequestSeqRef.current === requestSeq

    setEnrichFeedback(null)
    setIsEnrichSubmitting(true)

    try {
      const res = await apiFetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoIds: Array.from(requestSelectedVideoIds),
          targetLanguageIds: selectedLanguageIds,
        }),
      })
      const data = (await res.json()) as {
        created: number
        failed: number
        jobs?: Array<{ videoId: string; jobId: string }>
        errors?: Array<{ videoId: string; error: string }>
        error?: string
        details?: {
          formErrors?: string[]
          fieldErrors?: Record<string, string[] | undefined>
        }
        unresolvedTargetLanguageIds?: string[]
      }
      if (shouldIgnoreRequest()) return

      if (!res.ok) {
        setEnrichFeedback(buildEnrichRequestErrorFeedback(data))
        return
      }

      const outcome = resolveEnrichSelectionOutcome(
        requestSelectedVideoIds,
        data,
      )
      setSelectedVideoIds(outcome.nextSelectedVideoIds)

      if (outcome.redirectPath) {
        router.push(
          outcome.redirectPath as
            | "/dashboard/jobs"
            | `/dashboard/jobs/${string}`,
        )
        return
      }

      setEnrichFeedback(outcome.feedback)
    } catch {
      // SessionExpiredError handled by apiFetch
    } finally {
      if (enrichRequestSeqRef.current === requestSeq) {
        setIsEnrichSubmitting(false)
      }
    }
  }, [
    enrichActionReady,
    isEnrichSubmitting,
    router,
    selectedLanguageIds,
    selectedVideoIds,
  ])

  const handleCancelEnrichSelection = useCallback(() => {
    if (isEnrichSubmitting) {
      cancelledEnrichRequestSeqRef.current = enrichRequestSeqRef.current
    }

    setEnrichFeedback(null)
    setFlyingSelection(null)
    setLeavingStackVideos([])
    setWithheldStackVideoIds(new Set())
    setSelectedVideoIds(new Set())
  }, [isEnrichSubmitting])

  // Fetch video coverage data from proxy API when languages change
  useEffect(() => {
    if (!hasSelectedLanguages) {
      setVideoCollections([])
      setVideoCollectionsLoadFailed(false)
      setIsLoadingVideos(false)
      return
    }

    const controller = new AbortController()
    setIsLoadingVideos(true)
    setVideoCollectionsLoadFailed(false)

    void (async () => {
      try {
        const params = new URLSearchParams()
        if (selectedLanguageIds.length > 0) {
          params.set("languageIds", selectedLanguageIds.join(","))
        }
        const response = await apiFetch(`/api/videos?${params}`, {
          signal: controller.signal,
        })
        if (!response.ok) {
          setVideoCollectionsLoadFailed(true)
          return
        }
        const payload = (await response.json()) as {
          collections: CmsCollection[]
          standalone: CmsVideo[]
        }
        const allCollections = [...(payload?.collections ?? [])]
        if (payload?.standalone?.length > 0) {
          allCollections.push({
            id: "standalone",
            title: "Standalone Videos",
            imageUrl: null,
            label: "standalone",
            labelDisplay: "Standalone",
            coverage: {
              subtitles: { human: 0, ai: 0, none: 0 },
              audio: { human: 0, ai: 0, none: 0 },
              meta: { human: 0, ai: 0, none: 0 },
            },
            videos: payload.standalone,
          })
        }
        setVideoCollections(allCollections)
      } catch {
        if (!controller.signal.aborted) {
          setVideoCollectionsLoadFailed(true)
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingVideos(false)
      }
    })()

    return () => controller.abort()
  }, [hasSelectedLanguages, selectedLanguageIds])

  // Fetch latest coverage snapshot once on mount for instant header bar
  useEffect(() => {
    void (async () => {
      try {
        const response = await apiFetch("/api/coverage-snapshots?latest=true")
        if (!response.ok) return
        const payload = (await response.json()) as {
          snapshot: SnapshotData | null
        }
        if (payload?.snapshot) {
          setSnapshot(payload.snapshot)
        }
      } catch {
        // ignore — header will fall back to computed counts
      }
    })()
  }, [])

  const collectionTypeOptions = useMemo(() => {
    const types = new Map<string, string>()
    for (const c of collections) {
      if (c.label && !types.has(c.label)) {
        types.set(c.label, c.labelDisplay)
      }
    }
    return [...types.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }))
  }, [collections])

  // Derive header bar counts from snapshot data (instant, pre-computed)
  const snapshotCounts = useMemo(() => {
    if (!snapshot) return null

    // Snapshot subtitle/audio data is stored both:
    // - as exact library-wide totals for the default no-language state
    // - per language for exact single-language selections
    // Multi-language subsets still need to fall back to live computation to
    // avoid double counting the same video across language buckets.
    const entries =
      selectedLanguageIds.length > 0
        ? snapshot.languageCoverage.filter((e) =>
            selectedLanguageIds.includes(e.languageCoreId),
          )
        : snapshot.languageCoverage

    let human = 0
    let ai = 0

    if (reportType === "meta") {
      // Metadata is library-wide, not per-language
      human = snapshot.videosWithHumanMetadata
      ai = snapshot.videosWithAiMetadata
    } else {
      if (selectedLanguageIds.length === 0) {
        if (reportType === "subtitles") {
          human = snapshot.subtitlesHumanTotal
          ai = snapshot.subtitlesAiTotal
        } else {
          human = snapshot.audioHumanTotal
          ai = snapshot.audioAiTotal
        }
      } else {
        if (selectedLanguageIds.length !== 1) return null

        const humanKey =
          reportType === "subtitles" ? "subtitlesHuman" : "audioHuman"
        const aiKey = reportType === "subtitles" ? "subtitlesAi" : "audioAi"
        for (const entry of entries) {
          human += entry[humanKey]
          ai += entry[aiKey]
        }
      }
    }

    const none = Math.max(0, snapshot.totalVideos - human - ai)
    return { human, ai, none }
  }, [snapshot, reportType, selectedLanguageIds])

  useEffect(() => {
    if (typeof document === "undefined") return
    document.body.classList.add("coverage-standalone")
    return () => {
      document.body.classList.remove("coverage-standalone")
      delete document.documentElement.dataset.coverageLoading
    }
  }, [])

  const overallCounts = useMemo(() => {
    return collections.reduce(
      (acc, collection) => {
        for (const video of collection.videos) {
          acc[video.coverageStatus] += 1
        }
        return acc
      },
      { human: 0, ai: 0, none: 0 },
    )
  }, [collections])

  const effectiveFilter = filter

  const searchMatchIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return new Set<string>()
    const matched = new Set<string>()
    for (const collection of collections) {
      for (const video of collection.videos) {
        if (
          video.title.toLowerCase().includes(q) ||
          video.id.toLowerCase().includes(q)
        ) {
          matched.add(video.id)
        }
      }
    }
    return matched
  }, [collections, searchQuery])

  const visibleCollections = useMemo(() => {
    let result = collections
    if (typeFilter !== "all") {
      result = result.filter((c) => c.label === typeFilter)
    }
    if (effectiveFilter !== "all") {
      result = result
        .map((collection) => ({
          ...collection,
          videos: collection.videos.filter(
            (video) => video.coverageStatus === effectiveFilter,
          ),
        }))
        .filter((collection) => collection.videos.length > 0)
    }
    if (searchMatchIds.size > 0) {
      result = result.filter((collection) =>
        collection.videos.some((video) => searchMatchIds.has(video.id)),
      )
    }
    return result
  }, [collections, typeFilter, effectiveFilter, searchMatchIds])

  const toggleExpanded = useCallback((collectionId: string) => {
    setExpandedCollections((prev) =>
      prev.includes(collectionId)
        ? prev.filter((id) => id !== collectionId)
        : [...prev, collectionId],
    )
  }, [])

  const handleHoverVideo = useCallback(
    (details: HoveredVideoDetails | null) => {
      setHoveredVideo(details)
    },
    [],
  )

  const activePreviewVideo = hoveredVideo

  const totalCollections = visibleCollections.length
  const showCoverageControls =
    gatewayConfigured && !errorMessage && !videoCollectionsLoadFailed
  const showCollectionControls = showCoverageControls && hasSelectedLanguages
  const coverageBarCounts = isLoadingVideos
    ? (snapshotCounts ?? overallCounts)
    : overallCounts

  const presetLanguages = useMemo<LanguagePreset[]>(
    () => resolveLanguagePresets(languageCatalog),
    [languageCatalog],
  )

  const applySelectedLanguages = useCallback(
    (languageIds: string[]) => {
      if (typeof window !== "undefined") {
        if (languageIds.length > 0) {
          writeRememberedCoverageLanguageIds(window.sessionStorage, languageIds)
        } else {
          clearRememberedCoverageLanguageIds(window.sessionStorage)
        }
      }

      const nextParams = normalizeCoverageLanguageSearchParams(
        typeof window === "undefined" ? "" : window.location.search,
        languageIds,
      )

      const queryString = nextParams.toString()
      const nextUrl = queryString
        ? `/dashboard/coverage?${queryString}`
        : "/dashboard/coverage"

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- typed routes does not accept dynamic query strings here
      router.push(nextUrl as any)
    },
    [router],
  )

  return (
    <>
      <ManagerShellSidebarSlot>
        {hydrated && isSelectMode ? (
          <section className="design-system-sidebar-callout translation-sidebar-panel">
            <div className="translation-summary">
              <div className="translation-panel-heading">Job Order</div>
              <div className="translation-count">
                {selectedVideoIds.size} video
                {selectedVideoIds.size === 1 ? "" : "s"} selected
              </div>
              <div
                ref={selectedStackTargetRef}
                className={`selected-video-stack-target${
                  selectedVideos.length > 0 || leavingStackVideos.length > 0
                    ? " has-videos"
                    : ""
                }`}
              >
                <SelectedVideoStack
                  videos={displayedSelectedVideos}
                  leavingVideos={leavingStackVideos}
                />
              </div>
              <div className="translation-target">
                Languages:{" "}
                {selectedLanguageIds.length > 0
                  ? selectedLanguageIds
                      .map((id) => languageNameMap.get(id) ?? id)
                      .join(", ")
                  : "Select at least one"}
              </div>
            </div>

            <EnrichActionControls
              enrichActionReady={enrichActionReady}
              enrichFeedback={enrichFeedback}
              isEnrichSubmitting={isEnrichSubmitting}
              languageSelectionRequired={languageSelectionRequired}
              onCancel={handleCancelEnrichSelection}
              onEnrich={handleEnrichSelection}
            />
          </section>
        ) : null}
      </ManagerShellSidebarSlot>

      <header className="studio-page-intro studio-page-intro--coverage">
        <div className="studio-page-intro-copy">
          <span className="studio-page-eyebrow">Coverage report</span>
          <h1>{reportConfig.label}</h1>
          <p>{reportConfig.intro}</p>
        </div>
        {showCoverageControls ? (
          <div className="studio-page-intro-diagram">
            <CoverageNumberDiagram
              counts={coverageBarCounts}
              activeFilter={filter}
              onFilter={setFilter}
              interactive
              labels={reportConfig.segmentLabels}
              ariaLabel={reportConfig.ariaLabel}
            />
          </div>
        ) : null}
      </header>

      {showCollectionControls && (
        <section className="relative z-[60] mb-5">
          <div
            className="flex w-[calc(100vw-2.5rem)] max-w-full flex-row items-center gap-2 sm:w-full"
            id="coverage-collection-filters"
          >
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-[color:var(--ds-muted)]"
                aria-hidden="true"
              />
              <Input
                type="search"
                className="h-10 rounded-xl border-[color:color-mix(in_srgb,var(--ds-black)_14%,transparent)] bg-transparent pl-10 pr-10 text-sm font-medium text-[color:var(--ds-ink)] shadow-none ring-0 transition-colors duration-75 placeholder:text-[color:var(--ds-soft)] hover:bg-[color:color-mix(in_srgb,var(--ds-black)_6%,transparent)] active:bg-[color:color-mix(in_srgb,var(--ds-black)_10%,transparent)] focus-visible:border-[color:var(--ds-black)] focus-visible:bg-[color:color-mix(in_srgb,var(--ds-black)_3%,transparent)] focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)] [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
                placeholder="Search by name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1.5 top-1/2 size-7 -translate-y-1/2 rounded-lg text-[color:var(--ds-muted)] transition-colors duration-75 hover:bg-[color:color-mix(in_srgb,var(--ds-black)_6%,transparent)] hover:text-[color:var(--ds-ink)]"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                >
                  <X className="size-[18px]" aria-hidden="true" />
                </Button>
              )}
            </div>
            <CoverageFilterDropdown
              value={typeFilter}
              onChange={setTypeFilter}
              labels={{ human: "", ai: "", none: "" }}
              options={[
                { value: "all", label: "Media Type" },
                ...collectionTypeOptions,
              ]}
            />
          </div>
        </section>
      )}

      {showCoverageControls && (
        <section className="language-panel-section">
          <div className="language-panel-layout">
            <div className="language-panel-header-row">
              <LanguageGeoSelector
                value={selectedLanguageIds}
                options={languageOptions}
                attentionRequired={languageSelectionRequired}
                attentionRequestKey={languageSelectorFocusRequestCount}
                openRequestKey={languageSelectorOpenRequestCount}
                onApplyLanguages={applySelectedLanguages}
              />
            </div>
          </div>
        </section>
      )}

      {!gatewayConfigured ? (
        <div className="report-error">
          Configure the videos API endpoint to load coverage data.
        </div>
      ) : errorMessage ? (
        <div className="report-error">{errorMessage}</div>
      ) : !hasSelectedLanguages ? (
        <div className="collections">
          <LanguageSelectionEmptyState
            reportLabel={reportConfig.label}
            presets={presetLanguages}
            onSelectPreset={(languageId) =>
              applySelectedLanguages([languageId])
            }
            onBrowseAllLanguages={() =>
              setLanguageSelectorOpenRequestCount((prev) => prev + 1)
            }
          />
        </div>
      ) : videoCollectionsLoadFailed ? (
        <div className="collections">
          <div className="collection-empty collection-empty--no-data">
            <ServerOff
              size={40}
              strokeWidth={1.25}
              aria-hidden="true"
              className="collection-empty-icon"
            />
            Video data couldn&apos;t be loaded from the server. Check your
            connection and try refreshing.
          </div>
        </div>
      ) : isLoadingVideos ? (
        <div className="collections">
          {Array.from({ length: 3 }).map((_, i) => (
            <section key={i} className="collection-card skeleton-card">
              <div className="collection-header">
                <div className="collection-title-row">
                  <div className="collection-title-block">
                    <div className="collection-title-line">
                      <span className="skeleton skeleton--title" />
                      <span className="skeleton skeleton--label" />
                    </div>
                    <div className="collection-meta-row">
                      <span className="skeleton skeleton--meta" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="collection-tiles">
                {Array.from({ length: 20 }).map((_, j) => (
                  <span key={j} className="tile skeleton skeleton--tile" />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="collections">
          {visibleCollections.map((collection) => {
            const isExpanded = expandedCollections.includes(collection.id)

            return (
              <CollectionCard
                key={collection.id}
                collection={collection}
                reportConfig={reportConfig}
                filter={effectiveFilter}
                isExpanded={isExpanded}
                isSelectMode={isSelectMode}
                selectedVideoIds={selectedVideoIds}
                selectionLocked={isSelectMode && isEnrichSubmitting}
                searchMatchIds={searchMatchIds}
                onToggleExpanded={toggleExpanded}
                onHoverVideo={handleHoverVideo}
                onToggleVideo={toggleVideoSelection}
              />
            )
          })}
          {totalCollections === 0 && (
            <div
              className={
                collections.length === 0
                  ? "collection-empty collection-empty--no-data"
                  : "collection-empty collection-empty--filtered"
              }
            >
              {collections.length === 0 ? (
                "No videos are available yet."
              ) : (
                <>
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="collection-empty-icon"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                    <path d="M8 11h6" />
                  </svg>
                  <span className="collection-empty-title">
                    No results found
                  </span>
                  <span className="collection-empty-hint">
                    Try adjusting your search or filters to find what
                    you&apos;re looking for.
                  </span>
                </>
              )}
            </div>
          )}
          {totalCollections > 0 && (
            <div className="collection-load-meta">
              {totalCollections} collection
              {totalCollections === 1 ? "" : "s"}
            </div>
          )}
        </div>
      )}

      {/* Hover / pinned detail bar */}
      {hydrated && activePreviewVideo && (
        <div
          className={`translation-bar is-detail is-preview${
            activePreviewVideo.video.imageUrl ? " has-detail-bg" : ""
          }`}
          style={
            activePreviewVideo.video.imageUrl
              ? ({
                  "--detail-bg-image": `url("${activePreviewVideo.video.imageUrl}")`,
                } as React.CSSProperties)
              : undefined
          }
          role="status"
          aria-live="polite"
        >
          <div className="translation-view translation-view--detail">
            {activePreviewVideo ? (
              <div className="detail-media">
                {activePreviewVideo.video.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    className="detail-thumb"
                    src={activePreviewVideo.video.imageUrl}
                    alt={activePreviewVideo.video.title}
                    data-fly-preview-video-id={activePreviewVideo.video.id}
                  />
                ) : (
                  <div
                    className="detail-thumb detail-thumb--empty"
                    data-fly-preview-video-id={activePreviewVideo.video.id}
                    aria-hidden="true"
                  />
                )}
                <div className="detail-info">
                  <div className="translation-summary">
                    <div className="translation-count">
                      {activePreviewVideo.video.title}
                    </div>
                    <div className="translation-target">
                      {activePreviewVideo.collectionTitle}
                    </div>
                  </div>
                  <div className="translation-controls translation-controls--detail">
                    {(() => {
                      const c = activePreviewVideo.video.coverageCounts
                      const noneCount =
                        selectedLanguageIds.length > 0
                          ? c.none
                          : Math.max(0, languageOptions.length - c.human - c.ai)
                      const typeName = reportConfig.label.toLowerCase()
                      return (
                        <>
                          {c.human > 0 && (
                            <span className="detail-pill detail-pill--human">
                              {c.human} verified {typeName}
                            </span>
                          )}
                          {c.ai > 0 && (
                            <span className="detail-pill detail-pill--ai">
                              {c.ai} AI {typeName}
                            </span>
                          )}
                          {noneCount > 0 && (
                            <span className="detail-pill detail-pill--none">
                              {noneCount} no {typeName}
                            </span>
                          )}
                        </>
                      )
                    })()}
                  </div>
                </div>
              </div>
            ) : (
              <div className="translation-empty">
                Hover any item to see its details.
              </div>
            )}
          </div>
        </div>
      )}

      {flyingSelection
        ? createPortal(
            <span
              key={flyingSelection.id}
              className={`selected-video-flyer${
                flyingSelection.video.imageUrl ? " has-image" : ""
              }`}
              style={
                {
                  "--fly-from-height": `${flyingSelection.from.height}px`,
                  "--fly-from-left": `${flyingSelection.from.left}px`,
                  "--fly-from-top": `${flyingSelection.from.top}px`,
                  "--fly-from-width": `${flyingSelection.from.width}px`,
                  "--fly-mid-left": `${
                    flyingSelection.from.left + flyingSelection.mid.x
                  }px`,
                  "--fly-mid-top": `${
                    flyingSelection.from.top + flyingSelection.mid.y
                  }px`,
                  "--fly-mid-x": `${flyingSelection.mid.x}px`,
                  "--fly-mid-y": `${flyingSelection.mid.y}px`,
                  "--fly-scale-x": `${flyingSelection.to.width / flyingSelection.from.width}`,
                  "--fly-scale-y": `${flyingSelection.to.height / flyingSelection.from.height}`,
                  "--fly-translate-x": `${
                    flyingSelection.to.left - flyingSelection.from.left
                  }px`,
                  "--fly-translate-y": `${
                    flyingSelection.to.top - flyingSelection.from.top
                  }px`,
                  "--fly-to-height": `${flyingSelection.to.height}px`,
                  "--fly-to-left": `${flyingSelection.to.left}px`,
                  "--fly-to-top": `${flyingSelection.to.top}px`,
                  "--fly-to-width": `${flyingSelection.to.width}px`,
                  backgroundImage: flyingSelection.video.imageUrl
                    ? `url("${flyingSelection.video.imageUrl}")`
                    : undefined,
                } as React.CSSProperties
              }
              aria-hidden="true"
              onAnimationEnd={() => {
                setWithheldStackVideoIds((prev) => {
                  const next = new Set(prev)
                  for (const id of flyingSelection.revealVideoIds) {
                    next.delete(id)
                  }
                  return next
                })
                setFlyingSelection(null)
              }}
            >
              {flyingSelection.video.imageUrl
                ? null
                : getVideoInitial(flyingSelection.video.title)}
            </span>,
            document.body,
          )
        : null}
    </>
  )
}
