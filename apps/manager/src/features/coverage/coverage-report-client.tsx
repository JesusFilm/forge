"use client"

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { FilterX, Search, ServerOff } from "lucide-react"
import { useRouter } from "next/navigation"

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
    <div className="mode-toggle" role="group" aria-label="Interaction mode">
      <div className="mode-toggle-buttons">
        <button
          type="button"
          className={`mode-toggle-button${mode === "explore" ? " is-active" : ""}`}
          onClick={() => onChange("explore")}
          aria-pressed={mode === "explore"}
        >
          <svg
            className="icon"
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
        </button>
        <span
          className={
            translateDisabled ? "mode-toggle-disabled-wrap" : undefined
          }
          data-tooltip={translateDisabled ? "Coming soon" : undefined}
        >
          <button
            type="button"
            className={`mode-toggle-button${mode === "select" && !translateDisabled ? " is-active" : ""}${translateDisabled ? " is-disabled" : ""}`}
            onClick={() => !translateDisabled && onChange("select")}
            aria-pressed={!translateDisabled && mode === "select"}
            disabled={translateDisabled}
          >
            <svg
              className="icon"
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
          </button>
        </span>
      </div>
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
    <div className={`coverage-bar${isExplore ? " is-interactive" : ""}`}>
      <p className="coverage-hint">Click a segment to filter.</p>
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
            disabled={!isExplore}
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
            disabled={!isExplore}
          >
            {segment.label} {segment.percent}%
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
    <span className="filter-dropdown-shell" ref={shellRef}>
      <button
        type="button"
        className="filter-dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="filter-dropdown-sizer" aria-hidden="true">
          {options.map((o) => (
            <span key={o.value} className="filter-dropdown-sizer-item">
              {o.label}
            </span>
          ))}
        </span>
        <span className="filter-dropdown-label">{currentLabel}</span>
        <span className="control-chevron" aria-hidden="true" />
      </button>
      {isOpen && (
        <div
          className="filter-dropdown-menu"
          role="listbox"
          aria-label="Coverage filter"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`filter-dropdown-option${option.value === value ? " is-selected" : ""}`}
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

                    if (allNoneSelected) {
                      for (const v of noneVideos) onToggleVideo(v.id)
                    } else {
                      for (const v of noneVideos) {
                        if (!selectedVideoIds.has(v.id)) onToggleVideo(v.id)
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault()
                      e.stopPropagation()
                      if (!selectionInputEnabled) return

                      if (allNoneSelected) {
                        for (const v of noneVideos) onToggleVideo(v.id)
                      } else {
                        for (const v of noneVideos) {
                          if (!selectedVideoIds.has(v.id)) onToggleVideo(v.id)
                        }
                      }
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
            mode="explore"
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
          const groupVideos = filteredVideos
            .filter((v) => v.coverageStatus === groupStatus)
            .sort((a, b) => {
              const aIsCollection = a.id.startsWith("collection:")
              const bIsCollection = b.id.startsWith("collection:")
              if (aIsCollection !== bIsCollection) return aIsCollection ? -1 : 1
              return a.title.localeCompare(b.title)
            })
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
                  const isSelected = selectedVideoIds.has(video.id)
                  const isSelectable = isVideoQaSelectable(video.id)
                  const selectionInputEnabled = isEnrichSelectionInputEnabled({
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
                      className={`collection-detail-row${searchMatchIds.has(video.id) ? " detail-row--search-match" : ""}${detailRowDisabled ? " is-disabled" : ""}`}
                      key={video.id}
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
                        className={`detail-row-checkbox detail-row-checkbox--${status}${status !== "none" && video.coverageCounts.none > 0 ? " detail-row-checkbox--partial" : ""}${searchMatchIds.has(video.id) ? " detail-row-checkbox--search-match" : ""}`}
                        checked={isSelected}
                        disabled={!selectionInputEnabled}
                        onChange={() => onToggleVideo(video.id)}
                      />
                      <span className="detail-content">
                        {video.id.startsWith("collection:")
                          ? `${video.title} (collection)`
                          : video.title}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div className={`collection-tiles${isExpanded ? " is-hidden" : ""}`}>
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
            <span
              key={video.id}
              role={
                isInteractive
                  ? isSelectMode
                    ? "checkbox"
                    : "radio"
                  : undefined
              }
              aria-checked={isInteractive ? isSelected : undefined}
              tabIndex={isInteractive ? 0 : undefined}
              className={`tile ${video.id.startsWith("collection:") ? "tile--collection" : "tile--video"} tile--${status}${status !== "none" && video.coverageCounts.none > 0 ? " tile--partial" : ""}${searchMatchIds.has(video.id) ? " tile--search-match" : ""}${isSelectMode ? " tile--select" : " tile--explore"}${isSelected ? " is-selected" : ""}${isSelectMode && !isSelectable ? " is-unselectable" : ""}${isSelectMode && selectionLocked ? " is-disabled" : ""}`}
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
                  ? (e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault()
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
          <section className="design-system-sidebar-callout translation-sidebar-panel">
            <div className="translation-summary">
              <div className="translation-panel-heading">Job Order</div>
              <div className="translation-count">
                {selectedVideoIds.size} video
                {selectedVideoIds.size === 1 ? "" : "s"} selected
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
        <span className="studio-page-eyebrow">Coverage report</span>
        <h1>{reportConfig.label}</h1>
        <p>{reportConfig.intro}</p>
      </header>

      {showCoverageControls && (
        <section className="language-panel-section">
          <div className="language-panel-layout">
            <div className="language-panel-diagram">
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
            <LanguageGeoSelector
              value={selectedLanguageIds}
              options={languageOptions}
              attentionRequired={languageSelectionRequired}
              attentionRequestKey={languageSelectorFocusRequestCount}
              openRequestKey={languageSelectorOpenRequestCount}
            />
          </div>
        </section>
      )}

      {showCollectionControls && (
        <section className="mode-panel">
          {hydrated && (
            <ModeToggle
              mode={interactionMode}
              onChange={handleModeChange}
              translateDisabled={reportType !== "subtitles"}
            />
          )}
          <p className="mode-hint">
            {hydrated && isSelectMode && reportType === "subtitles"
              ? "Select videos for translation."
              : reportConfig.hintExplore}
          </p>
        </section>
      )}

      {showCollectionControls && (
        <section className="search-filter-card">
          <div className="search-filter-row">
            <div className="collection-search-shell">
              <Search className="collection-search-icon" aria-hidden="true" />
              <input
                type="search"
                className="collection-search"
                placeholder="Search by name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery.length > 0 && (
                <button
                  type="button"
                  className="collection-search-clear"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m15 9-6 6" />
                    <path d="m9 9 6 6" />
                  </svg>
                </button>
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
            <CoverageFilterDropdown
              value={filter}
              onChange={(v) => setFilter(v as CoverageFilter)}
              labels={reportConfig.segmentLabels}
            />
          </div>
          {collections.length > 0 && (
            <div
              className="search-filter-status"
              role="status"
              aria-live="polite"
            >
              Showing {totalCollections}
              {totalCollections !== collections.length
                ? ` of ${collections.length}`
                : ""}{" "}
              collection
              {collections.length === 1 ? "" : "s"}
              {(filter !== "all" ||
                typeFilter !== "all" ||
                searchQuery.trim()) && (
                <button
                  type="button"
                  className="clear-filters-button"
                  onClick={() => {
                    setFilter("all")
                    setTypeFilter("all")
                    setSearchQuery("")
                  }}
                >
                  <FilterX className="icon" aria-hidden="true" />
                  Clear filters
                </button>
              )}
            </div>
          )}
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
          className="translation-bar is-detail is-explore"
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
                  />
                ) : (
                  <div
                    className="detail-thumb detail-thumb--empty"
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
    </>
  )
}
