"use client"

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  Check,
  ChevronDown,
  ChevronUp,
  FilterX,
  Play,
  Search,
  ServerOff,
  X,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  PageDescription,
  PageEyebrow,
  PageIntro,
  PageTitle,
} from "@/components/ui/page-intro"
import {
  SegmentedControl,
  SegmentedControlButton,
} from "@/components/ui/segmented-control"
import { cn } from "@/lib/utils"

import { LanguageSelectionEmptyState } from "./coverage-empty-state"
import { EnrichActionControls } from "./enrich-action-controls"
import { LanguageGeoSelector } from "./LanguageGeoSelector"
import {
  hasSelectedLanguages as hasSelectedLanguagesInSelection,
  normalizeCoverageLanguageSearchParams,
  resolveLanguagePresets,
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

type Mode = "explore" | "select"

type HoveredVideoDetails = {
  video: ClientVideo
  collectionTitle: string
  status: CoverageStatus
}

const COLLECTION_LABEL_CLASSNAMES: Record<string, string> = {
  collection:
    "border-[color:rgba(17,24,39,0.08)] bg-[color:rgba(17,24,39,0.04)] text-foreground",
  standalone:
    "border-[color:rgba(17,24,39,0.08)] bg-[color:rgba(17,24,39,0.04)] text-foreground",
  featureFilm:
    "border-[color:rgba(239,51,64,0.16)] bg-[color:rgba(239,51,64,0.08)] text-[color:var(--ds-brand-red)]",
  series:
    "border-[color:rgba(30,64,175,0.14)] bg-[color:rgba(59,130,246,0.08)] text-[color:#1d4ed8]",
  episode:
    "border-[color:rgba(21,128,61,0.16)] bg-[color:rgba(34,197,94,0.08)] text-[color:#15803d]",
  trailer:
    "border-[color:rgba(180,83,9,0.18)] bg-[color:rgba(245,158,11,0.12)] text-[color:#b45309]",
  behindTheScenes:
    "border-[color:rgba(109,40,217,0.16)] bg-[color:rgba(139,92,246,0.10)] text-[color:#6d28d9]",
}

const DETAIL_GROUP_HEADING_CLASSNAMES: Record<CoverageStatus, string> = {
  human: "text-[#15803d]",
  ai: "text-[#7440ef]",
  none: "text-[var(--ds-brand-red)]",
}

const TILE_STATUS_CLASSNAMES: Record<CoverageStatus, string> = {
  human:
    "border-[color:rgba(34,163,74,0.24)] bg-[color:rgba(34,163,74,0.12)] text-[#15803d]",
  ai: "border-[color:rgba(116,64,239,0.24)] bg-[color:rgba(116,64,239,0.12)] text-[#7440ef]",
  none: "border-[color:rgba(239,51,64,0.26)] bg-[color:rgba(239,51,64,0.12)] text-[var(--ds-brand-red)]",
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_MODE_KEY = "forge-coverage-mode"
const SESSION_REPORT_KEY = "forge-coverage-report"

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
    hintExplore: string
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
    hintExplore: "Explore subtitle coverage across video collections.",
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
    hintExplore: "Explore audio coverage across video collections.",
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
    hintExplore: "Explore metadata coverage across video collections.",
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

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useSessionMode(initial: Mode): [Mode, (value: Mode) => void] {
  const [mode, setMode] = useState<Mode>(initial)

  /* eslint-disable react-hooks/set-state-in-effect -- intentional: hydrate from sessionStorage after mount to avoid SSR mismatch */
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(SESSION_MODE_KEY)
      if (stored === "explore" || stored === "select") {
        setMode(stored)
      }
    } catch {
      // ignore storage errors
    }
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  const updateMode = useCallback((value: Mode) => {
    setMode(value)
    try {
      window.sessionStorage.setItem(SESSION_MODE_KEY, value)
    } catch {
      // ignore storage errors
    }
  }, [])

  return [mode, updateMode]
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

function ModeToggle({
  mode,
  onChange,
  translateDisabled,
}: {
  mode: Mode
  onChange: (mode: Mode) => void
  translateDisabled?: boolean
}) {
  return (
    <div role="group" aria-label="Interaction mode">
      <SegmentedControl className="w-full max-w-[23rem]">
        <SegmentedControlButton
          active={mode === "explore"}
          className="min-h-12 flex-1 px-6"
          onClick={() => onChange("explore")}
          aria-pressed={mode === "explore"}
        >
          <svg
            className="size-5 shrink-0"
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Explore
        </SegmentedControlButton>
        <span
          className={cn(
            "flex flex-1",
            translateDisabled && "cursor-not-allowed",
          )}
          data-tooltip={translateDisabled ? "Coming soon" : undefined}
        >
          <SegmentedControlButton
            active={mode === "select" && !translateDisabled}
            className="min-h-12 w-full flex-1 px-6"
            onClick={() => !translateDisabled && onChange("select")}
            aria-pressed={!translateDisabled && mode === "select"}
            disabled={translateDisabled}
          >
            <svg
              className="size-5 shrink-0"
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            Translate
          </SegmentedControlButton>
        </span>
      </SegmentedControl>
    </div>
  )
}

function CoverageBar({
  counts,
  activeFilter,
  onFilter,
  mode,
  labels,
  ariaLabel,
}: {
  counts: { human: number; ai: number; none: number }
  activeFilter: CoverageFilter
  onFilter: (filter: CoverageFilter) => void
  mode: Mode
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

  const isExplore = mode === "explore"

  const handleSegmentClick = (status: CoverageStatus) => {
    onFilter(status)
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] font-medium tracking-[0.02em] text-muted-foreground">
        Click a segment to filter.
      </p>
      <div
        className={cn(
          "flex h-7 w-full overflow-hidden rounded-full bg-secondary",
          isExplore && "ring-1 ring-border/70",
        )}
        aria-label={ariaLabel}
      >
        {segments.map((segment) => (
          <button
            key={segment.key}
            type="button"
            className={cn(
              "h-full min-w-[4px] cursor-pointer transition-[filter,box-shadow,transform] duration-150 first:rounded-l-full last:rounded-r-full",
              segment.key === "human" && "bg-[#22a34a]",
              segment.key === "ai" && "bg-[#7440ef]",
              segment.key === "none" && "bg-[var(--ds-brand-red)]",
              activeFilter === segment.key &&
                "shadow-[inset_0_0_0_2px_rgba(255,255,255,0.9)]",
              !isExplore && "cursor-default",
            )}
            style={{ width: `${segment.percent}%` }}
            title={`${segment.label} videos: ${counts[segment.key]}`}
            aria-pressed={activeFilter === segment.key}
            onClick={() => handleSegmentClick(segment.key)}
            disabled={!isExplore}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        {segments.map((segment) => (
          <button
            key={segment.key}
            type="button"
            className={cn(
              "inline-flex cursor-pointer items-center gap-3 rounded-full border border-transparent px-0 py-0 text-[16px] font-medium tracking-[-0.02em] transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-100",
              segment.key === "human" && "text-[#16803b]",
              segment.key === "ai" && "text-[#7440ef]",
              segment.key === "none" && "text-[var(--ds-brand-red)]",
              activeFilter === segment.key && "font-semibold text-foreground",
            )}
            onClick={() => handleSegmentClick(segment.key)}
            disabled={!isExplore}
          >
            <span
              className={cn(
                "size-4 rounded-full",
                segment.key === "human" && "bg-[#22a34a]",
                segment.key === "ai" && "bg-[#7440ef]",
                segment.key === "none" && "bg-[var(--ds-brand-red)]",
              )}
              aria-hidden="true"
            />
            <span>
              {segment.label} {segment.percent}%
            </span>
          </button>
        ))}
      </div>
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
  options?: Array<{ value: string; label: string }>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const shellRef = useRef<HTMLSpanElement | null>(null)

  const options: Array<{ value: string; label: string }> = customOptions ?? [
    { value: "all", label: "Origin" },
    { value: "human", label: labels?.human ?? "Verified" },
    { value: "ai", label: labels?.ai ?? "AI" },
    { value: "none", label: labels?.none ?? "None" },
  ]

  const currentLabel = options.find((o) => o.value === value)?.label ?? "Origin"

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
    <span className="relative inline-flex" ref={shellRef}>
      <button
        type="button"
        className="inline-flex min-h-12 min-w-[10rem] cursor-pointer items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 text-left text-[15px] font-medium tracking-[-0.01em] text-foreground shadow-[0_1px_2px_rgba(8,8,8,0.05)] transition-colors hover:bg-accent focus-visible:border-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-black/10"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span>{currentLabel}</span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            isOpen && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      {isOpen && (
        <div
          className="absolute left-0 top-[calc(100%+0.5rem)] z-20 min-w-full overflow-hidden rounded-[20px] border border-border bg-card p-2 shadow-[0_18px_40px_rgba(8,8,8,0.12)]"
          role="listbox"
          aria-label="Coverage filter"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={cn(
                "flex w-full cursor-pointer items-center rounded-2xl px-4 py-3 text-left text-[15px] font-medium tracking-[-0.01em] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:bg-secondary focus-visible:text-foreground focus-visible:outline-none",
                option.value === value && "bg-secondary text-foreground",
              )}
              onClick={() => {
                onChange(option.value)
                setIsOpen(false)
              }}
              role="option"
              aria-selected={option.value === value}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </span>
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
  selectedExploreVideoId: string | null
  selectedVideoIds: Set<string>
  searchMatchIds: Set<string>
  onToggleExpanded: (collectionId: string) => void
  onHoverVideo: (details: HoveredVideoDetails | null) => void
  onToggleVideo: (videoId: string) => void
  onSelectExploreVideo: (details: HoveredVideoDetails) => void
}

const CollectionCard = memo(function CollectionCard({
  collection,
  reportConfig,
  filter,
  isExpanded,
  isSelectMode,
  selectionLocked,
  selectedExploreVideoId,
  selectedVideoIds,
  searchMatchIds,
  onToggleExpanded,
  onHoverVideo,
  onToggleVideo,
  onSelectExploreVideo,
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

  const sortedVideos = useMemo(() => {
    return [...filteredVideos].sort((a, b) => {
      const order: Record<CoverageStatus, number> = {
        human: 0,
        ai: 1,
        none: 2,
      }
      return order[a.coverageStatus] - order[b.coverageStatus]
    })
  }, [filteredVideos])

  const selectableNoneVideos = useMemo(
    () => getSelectableNoneVideos(collection.videos),
    [collection.videos],
  )
  const allNoneSelected =
    selectableNoneVideos.length > 0 &&
    selectableNoneVideos.every((video) => selectedVideoIds.has(video.id))
  const selectionInputEnabled = isEnrichSelectionInputEnabled({
    isSelectMode,
    isSelectable: selectableNoneVideos.length > 0,
    isSubmitting: selectionLocked,
  })
  const showSelectAll = isSelectMode && selectableNoneVideos.length > 0

  return (
    <Card key={collection.id} className="overflow-hidden rounded-[30px]">
      <CardHeader className="gap-6 p-7 sm:p-8">
        <div
          className="flex cursor-pointer flex-col gap-6"
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
          <div className="flex items-start gap-4">
            {showSelectAll ? (
              <button
                type="button"
                role="checkbox"
                aria-checked={allNoneSelected}
                aria-label={`Select all ${selectableNoneVideos.length} uncovered videos eligible for QA enrichment`}
                aria-disabled={!selectionInputEnabled}
                className={cn(
                  "mt-1 inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-2xl border border-border bg-secondary text-muted-foreground transition-colors",
                  allNoneSelected &&
                    "border-[color:rgba(239,51,64,0.26)] bg-[color:rgba(239,51,64,0.12)] text-[var(--ds-brand-red)]",
                  !selectionInputEnabled && "cursor-not-allowed opacity-50",
                )}
                onClick={(event) => {
                  event.stopPropagation()
                  if (!selectionInputEnabled) return

                  if (allNoneSelected) {
                    for (const video of selectableNoneVideos) {
                      onToggleVideo(video.id)
                    }
                  } else {
                    for (const video of selectableNoneVideos) {
                      if (!selectedVideoIds.has(video.id))
                        onToggleVideo(video.id)
                    }
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault()
                    event.stopPropagation()
                    if (!selectionInputEnabled) return

                    if (allNoneSelected) {
                      for (const video of selectableNoneVideos) {
                        onToggleVideo(video.id)
                      }
                    } else {
                      for (const video of selectableNoneVideos) {
                        if (!selectedVideoIds.has(video.id))
                          onToggleVideo(video.id)
                      }
                    }
                  }
                }}
              >
                <Check className="size-4" aria-hidden="true" />
              </button>
            ) : null}

            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-[32px] font-semibold tracking-[-0.03em] text-foreground">
                  {collection.title}
                </h2>
                <Badge
                  className={cn(
                    "px-3 py-1.5 text-[12px] font-medium tracking-[0.04em]",
                    COLLECTION_LABEL_CLASSNAMES[collection.label] ??
                      COLLECTION_LABEL_CLASSNAMES.collection,
                  )}
                  aria-label={`Group type: ${collection.labelDisplay}`}
                >
                  {collection.labelDisplay}
                </Badge>
              </div>
              <p className="text-[18px] leading-[1.4] text-muted-foreground">
                {total} video{total === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          <div className="w-full">
            <CoverageBar
              counts={counts}
              activeFilter="all"
              onFilter={() => {}}
              mode="explore"
              labels={reportConfig.segmentLabels}
              ariaLabel={reportConfig.ariaLabel}
            />
          </div>
        </div>

        <div className="border-t border-border/70 pt-5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-0 py-0 text-[15px] font-medium text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation()
              onToggleExpanded(collection.id)
            }}
            aria-expanded={isExpanded}
          >
            {isExpanded ? (
              <>
                <ChevronUp className="size-4" aria-hidden="true" />
                Hide details
              </>
            ) : (
              <>
                <ChevronDown className="size-4" aria-hidden="true" />
                Show details
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      {isExpanded ? (
        <CardContent className="space-y-7 pt-0">
          {(["human", "ai", "none"] as const).map((groupStatus) => {
            const groupVideos = filteredVideos
              .filter((video) => video.coverageStatus === groupStatus)
              .sort((a, b) => {
                const aIsCollection = a.id.startsWith("collection:")
                const bIsCollection = b.id.startsWith("collection:")
                if (aIsCollection !== bIsCollection)
                  return aIsCollection ? -1 : 1
                return a.title.localeCompare(b.title)
              })

            if (groupVideos.length === 0) return null

            return (
              <section key={groupStatus} className="space-y-3">
                <h3
                  className={cn(
                    "flex flex-wrap items-center gap-3 text-[18px] font-semibold tracking-[-0.02em]",
                    DETAIL_GROUP_HEADING_CLASSNAMES[groupStatus],
                  )}
                >
                  <span>{reportConfig.statusLabels[groupStatus]}</span>
                  <Badge variant="outline" className="px-2.5 py-1 text-[11px]">
                    {groupVideos.length}
                  </Badge>
                </h3>

                <div className="space-y-2">
                  {groupVideos.map((video) => {
                    const status = groupStatus
                    const isSelected = selectedVideoIds.has(video.id)
                    const isSelectable = isVideoQaSelectable(video.id)
                    const detailSelectionEnabled =
                      isEnrichSelectionInputEnabled({
                        isSelectMode,
                        isSelectable,
                        isSubmitting: selectionLocked,
                      })
                    const detailRowDisabled =
                      !isSelectable || (isSelectMode && selectionLocked)
                    const disabledReason = getVideoQaSelectionDisabledReason(
                      video.id,
                    )

                    return (
                      <label
                        key={video.id}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-[0_1px_2px_rgba(8,8,8,0.04)] transition-colors hover:bg-secondary/60",
                          searchMatchIds.has(video.id) &&
                            "border-foreground/20 bg-secondary",
                          detailRowDisabled &&
                            "cursor-not-allowed opacity-60 hover:bg-card",
                        )}
                        title={
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
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!detailSelectionEnabled}
                          onChange={() => onToggleVideo(video.id)}
                          className={cn(
                            "mt-1 size-4 shrink-0 rounded border-border accent-black",
                            status === "none" &&
                              "accent-[color:var(--ds-brand-red)]",
                          )}
                        />
                        <span className="min-w-0 flex-1 text-[15px] leading-[1.45] text-foreground">
                          {video.id.startsWith("collection:")
                            ? `${video.title} (collection)`
                            : video.title}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </CardContent>
      ) : (
        <CardContent className="pt-0">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(24px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(28px,1fr))]">
            {sortedVideos.map((video) => {
              const status = video.coverageStatus
              const statusLabel = reportConfig.statusLabels[status]
              const videoDetails = {
                video,
                collectionTitle: collection.title,
                status,
              } satisfies HoveredVideoDetails
              const isExploreSelected = selectedExploreVideoId === video.id
              const isSelected = isSelectMode
                ? selectedVideoIds.has(video.id)
                : isExploreSelected
              const isSelectable = isVideoQaSelectable(video.id)
              const isInteractive = isSelectMode
                ? isEnrichSelectionInputEnabled({
                    isSelectMode,
                    isSelectable,
                    isSubmitting: selectionLocked,
                  })
                : true
              const disabledReason = getVideoQaSelectionDisabledReason(video.id)
              const title = isSelectMode
                ? selectionLocked
                  ? `${video.title} -- ${statusLabel} -- Creating enrichment jobs...`
                  : isSelectable
                    ? `${video.title} -- ${statusLabel}`
                    : `${video.title} -- ${statusLabel} -- ${disabledReason ?? "Not selectable"}`
                : `${video.title} -- ${statusLabel}`

              return (
                <button
                  key={video.id}
                  type="button"
                  role={
                    isInteractive
                      ? isSelectMode
                        ? "checkbox"
                        : "radio"
                      : undefined
                  }
                  aria-checked={isInteractive ? isSelected : undefined}
                  tabIndex={isInteractive ? 0 : -1}
                  className={cn(
                    "relative flex aspect-square min-h-6 min-w-6 cursor-pointer items-center justify-center rounded-[10px] border transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-black/10",
                    TILE_STATUS_CLASSNAMES[status],
                    video.id.startsWith("collection:") && "rounded-[12px]",
                    searchMatchIds.has(video.id) && "ring-2 ring-black/12",
                    isSelected &&
                      "scale-[1.03] shadow-[0_0_0_2px_rgba(255,255,255,0.92),0_0_0_4px_rgba(8,8,8,0.14)]",
                    isSelectMode &&
                      !isSelectable &&
                      "cursor-not-allowed opacity-50",
                    isSelectMode &&
                      selectionLocked &&
                      "cursor-not-allowed opacity-50",
                  )}
                  title={title}
                  onClick={
                    isInteractive
                      ? () => {
                          if (isSelectMode) {
                            onToggleVideo(video.id)
                            return
                          }
                          onSelectExploreVideo(videoDetails)
                        }
                      : undefined
                  }
                  onKeyDown={
                    isInteractive
                      ? (event) => {
                          if (event.key === " " || event.key === "Enter") {
                            event.preventDefault()
                            if (isSelectMode) {
                              onToggleVideo(video.id)
                              return
                            }
                            onSelectExploreVideo(videoDetails)
                          }
                        }
                      : undefined
                  }
                  onMouseEnter={() => onHoverVideo(videoDetails)}
                  onMouseLeave={() => onHoverVideo(null)}
                  onFocus={() => onHoverVideo(videoDetails)}
                  onBlur={() => onHoverVideo(null)}
                  disabled={!isInteractive}
                >
                  {isSelected ? (
                    isSelectMode ? (
                      <Check className="size-3.5" aria-hidden="true" />
                    ) : (
                      <Play
                        className="size-3.5 fill-current"
                        aria-hidden="true"
                      />
                    )
                  ) : null}
                </button>
              )
            })}
          </div>

          {filteredVideos.length === 0 ? (
            <p className="py-10 text-center text-[16px] text-muted-foreground">
              No videos in this collection.
            </p>
          ) : null}
        </CardContent>
      )}
    </Card>
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
  const shell = useOptionalManagerShellState()
  const [videoCollections, setVideoCollections] = useState<CmsCollection[]>([])
  const [videoCollectionsLoadFailed, setVideoCollectionsLoadFailed] =
    useState(false)
  const [isLoadingVideos, setIsLoadingVideos] = useState(true)
  const [storedReportType] = useSessionReportType("subtitles")
  const reportType = shell?.reportType ?? storedReportType

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
  const errorMessage = initialErrorMessage
  const [filter, setFilter] = useState<CoverageFilter>("all")
  const [hoveredVideo, setHoveredVideo] = useState<HoveredVideoDetails | null>(
    null,
  )
  const [selectedExploreVideoId, setSelectedExploreVideoId] = useState<
    string | null
  >(null)
  const [expandedCollections, setExpandedCollections] = useState<string[]>([])

  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(
    new Set(),
  )
  const [enrichFeedback, setEnrichFeedback] = useState<EnrichFeedback | null>(
    null,
  )
  const [isEnrichSubmitting, setIsEnrichSubmitting] = useState(false)
  const enrichRequestSeqRef = useRef(0)
  const cancelledEnrichRequestSeqRef = useRef<number | null>(null)
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
  const [storedInteractionMode, setStoredInteractionMode] =
    useSessionMode("explore")
  const interactionMode = shell?.mode ?? storedInteractionMode
  const setInteractionMode = shell?.setMode ?? setStoredInteractionMode
  const hasSelectedLanguages =
    hasSelectedLanguagesInSelection(selectedLanguageIds)
  const isSelectMode = interactionMode === "select"
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

  const toggleVideoSelection = useCallback(
    (videoId: string) => {
      if (isEnrichSubmitting || !selectableVideoIds.has(videoId)) {
        return
      }

      setEnrichFeedback(null)
      setSelectedVideoIds((prev) => {
        const next = new Set(prev)
        if (next.has(videoId)) next.delete(videoId)
        else next.add(videoId)
        return next
      })
    },
    [isEnrichSubmitting, selectableVideoIds],
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
  }, [selectableVideoIds])

  // Clear selection when switching away from select mode
  const handleModeChange = useCallback(
    (mode: Mode) => {
      setEnrichFeedback(null)
      if (mode === "explore") setSelectedVideoIds(new Set())
      setInteractionMode(mode)
    },
    [setInteractionMode],
  )

  const interactionModeRef = useRef<Mode>(interactionMode)

  useEffect(() => {
    if (
      interactionModeRef.current !== interactionMode &&
      interactionMode === "explore"
    ) {
      setEnrichFeedback(null)
      setSelectedVideoIds(new Set())
    }

    interactionModeRef.current = interactionMode
  }, [interactionMode])

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
      }
      if (shouldIgnoreRequest()) return

      if (!res.ok) {
        setEnrichFeedback({
          tone: "error",
          message: data.error ?? "Failed to create enrichment jobs.",
        })
        return
      }

      const outcome = resolveEnrichSelectionOutcome(
        requestSelectedVideoIds,
        data,
      )
      setSelectedVideoIds(outcome.nextSelectedVideoIds)

      if (outcome.redirectPath) {
        handleModeChange("explore")
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
    handleModeChange,
    isEnrichSubmitting,
    router,
    selectedLanguageIds,
    selectedVideoIds,
  ])

  const handleCancelEnrichSelection = useCallback(() => {
    if (isEnrichSubmitting) {
      cancelledEnrichRequestSeqRef.current = enrichRequestSeqRef.current
    }

    handleModeChange("explore")
  }, [handleModeChange, isEnrichSubmitting])

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

  const exploreVideoDetailsById = useMemo(() => {
    const byId = new Map<string, HoveredVideoDetails>()
    for (const collection of collections) {
      for (const video of collection.videos) {
        byId.set(video.id, {
          video,
          collectionTitle: collection.title,
          status: video.coverageStatus,
        })
      }
    }
    return byId
  }, [collections])

  const selectedExploreVideo = useMemo(() => {
    if (!selectedExploreVideoId) return null
    return exploreVideoDetailsById.get(selectedExploreVideoId) ?? null
  }, [exploreVideoDetailsById, selectedExploreVideoId])

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
    return () => {
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

  const handleSelectExploreVideo = useCallback(
    (details: HoveredVideoDetails) => {
      setSelectedExploreVideoId(details.video.id)
      setHoveredVideo(details)
    },
    [],
  )

  useEffect(() => {
    if (!selectedExploreVideoId) return
    if (exploreVideoDetailsById.has(selectedExploreVideoId)) return
    setSelectedExploreVideoId(null)
  }, [exploreVideoDetailsById, selectedExploreVideoId])

  const activePreviewVideo = isSelectMode
    ? hoveredVideo
    : (selectedExploreVideo ?? hoveredVideo)

  const totalCollections = visibleCollections.length
  const showCoverageControls =
    gatewayConfigured && !errorMessage && !videoCollectionsLoadFailed
  const showCollectionControls = showCoverageControls && hasSelectedLanguages

  const presetLanguages = useMemo<LanguagePreset[]>(
    () => resolveLanguagePresets(languageCatalog),
    [languageCatalog],
  )

  const applySelectedLanguages = useCallback(
    (languageIds: string[]) => {
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
          <section className="flex flex-col gap-5 rounded-[28px] border border-border bg-card p-5 shadow-[0_16px_40px_rgba(8,8,8,0.08)]">
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Job Order
              </div>
              <div className="text-[22px] font-semibold tracking-[-0.03em] text-foreground">
                {selectedVideoIds.size} video
                {selectedVideoIds.size === 1 ? "" : "s"} selected
              </div>
              <div className="text-[16px] leading-[1.45] text-muted-foreground">
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

      <PageIntro className="border-b-0 pb-0">
        <PageEyebrow>Coverage report</PageEyebrow>
        <PageTitle className="text-[clamp(3.25rem,8vw,5.25rem)]">
          {reportConfig.label}
        </PageTitle>
        <PageDescription className="max-w-4xl">
          {reportConfig.intro}
        </PageDescription>
      </PageIntro>

      {showCoverageControls && (
        <section className="pt-10">
          <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
            <div className="min-w-0">
              <CoverageBar
                counts={
                  isLoadingVideos
                    ? (snapshotCounts ?? overallCounts)
                    : overallCounts
                }
                activeFilter={filter}
                onFilter={setFilter}
                mode={interactionMode}
                labels={reportConfig.segmentLabels}
                ariaLabel={reportConfig.ariaLabel}
              />
            </div>
            <div className="min-w-0">
              <LanguageGeoSelector
                value={selectedLanguageIds}
                options={languageOptions}
                attentionRequired={languageSelectionRequired}
                attentionRequestKey={languageSelectorFocusRequestCount}
                openRequestKey={languageSelectorOpenRequestCount}
              />
            </div>
          </div>
        </section>
      )}

      {showCollectionControls && (
        <section className="mt-10 space-y-4">
          {hydrated && (
            <ModeToggle
              mode={interactionMode}
              onChange={handleModeChange}
              translateDisabled={reportType !== "subtitles"}
            />
          )}
          <p className="text-[16px] leading-[1.5] text-muted-foreground">
            {hydrated && isSelectMode && reportType === "subtitles"
              ? "Select videos for translation."
              : reportConfig.hintExplore}
          </p>
        </section>
      )}

      {showCollectionControls && (
        <section className="mt-8 space-y-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                className="pl-13 pr-13"
                placeholder="Search by name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1.5 top-1.5 size-11 rounded-[18px]"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-4 sm:flex-row">
              <CoverageFilterDropdown
                value={typeFilter}
                onChange={setTypeFilter}
                labels={{ human: "", ai: "", none: "" }}
                options={[
                  { value: "all", label: "Media Type" },
                  ...collectionTypeOptions,
                ]}
              />
              <CoverageFilterDropdown
                value={filter}
                onChange={(v) => setFilter(v as CoverageFilter)}
                labels={reportConfig.segmentLabels}
              />
            </div>
          </div>

          {collections.length > 0 && (
            <div
              className="flex flex-col gap-3 text-[16px] leading-[1.45] text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
              role="status"
              aria-live="polite"
            >
              <span>
                Showing {totalCollections}
                {totalCollections !== collections.length
                  ? ` of ${collections.length}`
                  : ""}{" "}
                collection
                {collections.length === 1 ? "" : "s"}
              </span>
              {(filter !== "all" ||
                typeFilter !== "all" ||
                searchQuery.trim()) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto w-fit px-0 py-0 text-[15px] text-muted-foreground hover:bg-transparent hover:text-foreground"
                  onClick={() => {
                    setFilter("all")
                    setTypeFilter("all")
                    setSearchQuery("")
                  }}
                >
                  <FilterX className="size-4" aria-hidden="true" />
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      {!gatewayConfigured ? (
        <div className="mt-10 rounded-[24px] border border-[color:rgba(239,51,64,0.18)] bg-[color:rgba(239,51,64,0.08)] px-6 py-5 text-[16px] leading-[1.5] text-[var(--ds-brand-red)]">
          Configure the videos API endpoint to load coverage data.
        </div>
      ) : errorMessage ? (
        <div className="mt-10 rounded-[24px] border border-[color:rgba(239,51,64,0.18)] bg-[color:rgba(239,51,64,0.08)] px-6 py-5 text-[16px] leading-[1.5] text-[var(--ds-brand-red)]">
          {errorMessage}
        </div>
      ) : !hasSelectedLanguages ? (
        <div className="mt-10">
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
        <div className="mt-10">
          <div className="flex flex-col items-center justify-center gap-4 rounded-[28px] border border-border bg-card px-8 py-16 text-center shadow-[0_12px_32px_rgba(8,8,8,0.05)]">
            <ServerOff
              size={40}
              strokeWidth={1.25}
              aria-hidden="true"
              className="text-muted-foreground"
            />
            <p className="max-w-xl text-[18px] leading-[1.5] text-muted-foreground">
              Video data couldn&apos;t be loaded from the server. Check your
              connection and try refreshing.
            </p>
          </div>
        </div>
      ) : isLoadingVideos ? (
        <div className="mt-10 space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card
              key={i}
              className="rounded-[30px] p-8 shadow-[0_12px_32px_rgba(8,8,8,0.05)]"
            >
              <div className="animate-pulse space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="h-10 w-56 rounded-2xl bg-secondary" />
                    <span className="h-7 w-24 rounded-full bg-secondary" />
                  </div>
                  <span className="block h-5 w-32 rounded-full bg-secondary" />
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(24px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(28px,1fr))]">
                  {Array.from({ length: 20 }).map((_, j) => (
                    <span
                      key={j}
                      className="block aspect-square rounded-[10px] bg-secondary"
                    />
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="mt-10 space-y-6 pb-36">
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
                selectedExploreVideoId={selectedExploreVideoId}
                selectedVideoIds={selectedVideoIds}
                selectionLocked={isSelectMode && isEnrichSubmitting}
                searchMatchIds={searchMatchIds}
                onToggleExpanded={toggleExpanded}
                onHoverVideo={handleHoverVideo}
                onToggleVideo={toggleVideoSelection}
                onSelectExploreVideo={handleSelectExploreVideo}
              />
            )
          })}
          {totalCollections === 0 && (
            <div
              className={cn(
                "flex flex-col items-center justify-center gap-4 rounded-[28px] border border-border bg-card px-8 py-16 text-center shadow-[0_12px_32px_rgba(8,8,8,0.05)]",
                collections.length !== 0 && "py-20",
              )}
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
                    className="text-muted-foreground"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                    <path d="M8 11h6" />
                  </svg>
                  <span className="text-[24px] font-semibold tracking-[-0.02em] text-foreground">
                    No results found
                  </span>
                  <span className="max-w-lg text-[18px] leading-[1.5] text-muted-foreground">
                    Try adjusting your search or filters to find what
                    you&apos;re looking for.
                  </span>
                </>
              )}
            </div>
          )}
          {totalCollections > 0 && (
            <div className="text-center text-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              {totalCollections} collection
              {totalCollections === 1 ? "" : "s"}
            </div>
          )}
        </div>
      )}

      {/* Hover / pinned detail bar */}
      {hydrated && activePreviewVideo && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 shadow-[0_-16px_40px_rgba(8,8,8,0.12)] backdrop-blur-xl supports-[backdrop-filter]:bg-card/88"
          role="status"
          aria-live="polite"
        >
          <div className="mx-auto flex w-full max-w-[1600px] items-center px-5 py-4 sm:px-8">
            {activePreviewVideo ? (
              <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5">
                {activePreviewVideo.video.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    className="h-20 w-28 shrink-0 rounded-[18px] object-cover sm:h-24 sm:w-36"
                    src={activePreviewVideo.video.imageUrl}
                    alt={activePreviewVideo.video.title}
                  />
                ) : (
                  <div
                    className="h-20 w-28 shrink-0 rounded-[18px] bg-secondary sm:h-24 sm:w-36"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="space-y-1">
                    <div className="truncate text-[26px] font-semibold tracking-[-0.03em] text-foreground sm:text-[30px]">
                      {activePreviewVideo.video.title}
                    </div>
                    <div className="truncate text-[18px] leading-[1.4] text-muted-foreground">
                      {activePreviewVideo.collectionTitle}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
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
                            <Badge className="border-[color:rgba(34,163,74,0.24)] bg-[color:rgba(34,163,74,0.12)] px-3 py-1.5 text-[13px] font-medium text-[#15803d]">
                              {c.human} verified {typeName}
                            </Badge>
                          )}
                          {c.ai > 0 && (
                            <Badge className="border-[color:rgba(116,64,239,0.24)] bg-[color:rgba(116,64,239,0.12)] px-3 py-1.5 text-[13px] font-medium text-[#7440ef]">
                              {c.ai} AI {typeName}
                            </Badge>
                          )}
                          {noneCount > 0 && (
                            <Badge className="border-[color:rgba(239,51,64,0.24)] bg-[color:rgba(239,51,64,0.12)] px-3 py-1.5 text-[13px] font-medium text-[var(--ds-brand-red)]">
                              {noneCount} no {typeName}
                            </Badge>
                          )}
                        </>
                      )
                    })()}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-[16px] text-muted-foreground">
                Hover any item to see its details.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
