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
import { ServerOff } from "lucide-react"

import { LanguageGeoSelector } from "./LanguageGeoSelector"
import { apiFetch } from "@/lib/api-fetch"

function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: hydrate after mount to avoid SSR mismatch
  useEffect(() => setHydrated(true), [])
  return hydrated
}
import type {
  JobRecord,
  JobStatus,
  WorkflowStepName,
  JobStepState,
} from "@/types/job"

// ---------------------------------------------------------------------------
// Forge workflow steps (the only 5 steps in this project)
// ---------------------------------------------------------------------------

const FORGE_STEPS: WorkflowStepName[] = [
  "transcription",
  "translation",
  "chapters",
  "metadata",
  "embeddings",
]

// ---------------------------------------------------------------------------
// Coverage status types — adapted from VideoForge's 3-tier model
// ---------------------------------------------------------------------------

export type CoverageStatus = "human" | "ai" | "none"

type CoverageFilter = "all" | CoverageStatus

type ReportType = "subtitles" | "audio" | "meta"

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type ClientVideo = {
  id: string
  title: string
  imageUrl: string | null
  muxAssetId: string
  muxPlaybackId: string
  status: JobStatus
  languages: string[]
  steps: JobStepState[]
  errors: Array<{ step: WorkflowStepName; message: string; at: string }>
  artifacts: Record<string, string>
  coverageStatus: CoverageStatus
  stepCompleteness: { completed: number; total: number }
}

type ClientCollection = {
  id: string
  title: string
  label: string
  labelDisplay: string
  videos: ClientVideo[]
}

type LanguageOption = {
  id: string
  englishLabel: string
  nativeLabel: string
}

// ---------------------------------------------------------------------------
// CMS-sourced types (used by the server page component)
// ---------------------------------------------------------------------------

export type CmsVideo = {
  id: string
  title: string
  imageUrl: string | null
  label: string
  coverage: {
    subtitles: CoverageStatus
    audio: CoverageStatus
    meta: CoverageStatus
  }
  variantLanguageIds: string[]
  subtitleLanguageIds: string[]
}

export type CmsCollection = {
  id: string
  title: string
  label: string
  labelDisplay: string
  videos: CmsVideo[]
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

function computeCoverageStatus(job: JobRecord): CoverageStatus {
  const completedCount = job.steps.filter(
    (s) => s.status === "completed",
  ).length
  if (completedCount === FORGE_STEPS.length) return "human"
  if (completedCount > 0) return "ai"
  return "none"
}

function jobToClientVideo(job: JobRecord): ClientVideo {
  const completedCount = job.steps.filter(
    (s) => s.status === "completed",
  ).length
  return {
    id: job.id,
    title: `${job.muxAssetId.slice(0, 8)}...`,
    imageUrl: null,
    muxAssetId: job.muxAssetId,
    muxPlaybackId: job.muxPlaybackId,
    status: job.status,
    languages: job.languages,
    steps: job.steps,
    errors: job.errors,
    artifacts: job.artifacts,
    coverageStatus: computeCoverageStatus(job),
    stepCompleteness: {
      completed: completedCount,
      total: FORGE_STEPS.length,
    },
  }
}

function groupJobsIntoCollections(jobs: JobRecord[]): ClientCollection[] {
  // Group by job status for a meaningful collection breakdown
  const statusGroups: Record<string, JobRecord[]> = {}
  for (const job of jobs) {
    const group = job.status
    if (!statusGroups[group]) {
      statusGroups[group] = []
    }
    statusGroups[group].push(job)
  }

  const statusLabels: Record<string, string> = {
    completed: "Completed Jobs",
    running: "Running Jobs",
    pending: "Pending Jobs",
    failed: "Failed Jobs",
  }

  return Object.entries(statusGroups).map(([status, groupJobs]) => ({
    id: status,
    title: statusLabels[status] ?? status,
    label: status,
    labelDisplay: statusLabels[status] ?? status,
    videos: groupJobs.map(jobToClientVideo),
  }))
}

function cmsVideoToClientVideo(
  video: CmsVideo,
  reportType: ReportType,
): ClientVideo {
  const coverageStatus = video.coverage[reportType]
  return {
    id: video.id,
    title: video.title,
    imageUrl: video.imageUrl,
    muxAssetId: video.id,
    muxPlaybackId: "",
    status: "completed",
    languages: [
      ...new Set([...video.variantLanguageIds, ...video.subtitleLanguageIds]),
    ],
    steps: FORGE_STEPS.map((name) => ({
      name,
      status:
        coverageStatus === "human"
          ? ("completed" as const)
          : ("pending" as const),
      retries: 0,
    })),
    errors: [],
    artifacts: {},
    coverageStatus,
    stepCompleteness: {
      completed:
        coverageStatus === "human"
          ? FORGE_STEPS.length
          : coverageStatus === "ai"
            ? 1
            : 0,
      total: FORGE_STEPS.length,
    },
  }
}

function cmsCollectionsToClientCollections(
  collections: CmsCollection[],
  reportType: ReportType,
): ClientCollection[] {
  return collections.map((collection) => ({
    id: collection.id,
    title: collection.title,
    label: collection.label,
    labelDisplay: collection.labelDisplay,
    videos: collection.videos.map((v) => cmsVideoToClientVideo(v, reportType)),
  }))
}

function formatPercent(count: number, total: number): number {
  if (total === 0) return 0
  return Math.round((count / total) * 100)
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
}: {
  mode: Mode
  onChange: (mode: Mode) => void
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
        <button
          type="button"
          className={`mode-toggle-button${mode === "select" ? " is-active" : ""}`}
          onClick={() => onChange("select")}
          aria-pressed={mode === "select"}
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

function ReportTypeSelector({
  value,
  onChange,
}: {
  value: ReportType
  onChange: (value: ReportType) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const shellRef = useRef<HTMLSpanElement | null>(null)
  const report = REPORT_CONFIG[value]
  const options = useMemo(() => Object.keys(REPORT_CONFIG) as ReportType[], [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (!shellRef.current) return
      if (!shellRef.current.contains(event.target as Node)) {
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
    <span className="control-select-shell" ref={shellRef}>
      <button
        type="button"
        className="control-value"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="control-select-text">{report.label}</span>
        <span className="control-chevron" aria-hidden="true" />
      </button>
      {isOpen && (
        <div
          className="control-dropdown"
          role="listbox"
          aria-label="Report type"
        >
          {options.map((option) => {
            const optionConfig = REPORT_CONFIG[option]
            return (
              <button
                key={option}
                type="button"
                className={`control-option${
                  option === value ? " is-selected" : ""
                }`}
                onClick={() => {
                  onChange(option)
                  setIsOpen(false)
                }}
                role="option"
                aria-selected={option === value}
              >
                <span className="control-option-english">
                  {optionConfig.label}
                </span>
                <span className="control-option-native">
                  {optionConfig.description}
                </span>
              </button>
            )
          })}
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
  selectedVideoIds: Set<string>
  onToggleExpanded: (collectionId: string) => void
  onHoverVideo: (details: HoveredVideoDetails | null) => void
  onToggleVideo: (videoId: string) => void
}

const CollectionCard = memo(function CollectionCard({
  collection,
  reportConfig,
  filter,
  isExpanded,
  isSelectMode,
  selectedVideoIds,
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
              const noneVideos = collection.videos.filter(
                (v) => v.coverageStatus === "none",
              )
              const allNoneSelected =
                noneVideos.length > 0 &&
                noneVideos.every((v) => selectedVideoIds.has(v.id))

              return noneVideos.length > 0 ? (
                <span
                  role="checkbox"
                  aria-checked={allNoneSelected}
                  aria-label={`Select all ${noneVideos.length} uncovered videos`}
                  tabIndex={0}
                  className={`tile tile--none tile--select collection-select-all${allNoneSelected ? " is-selected" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation()
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
            .sort((a, b) => a.title.localeCompare(b.title))
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

                  return (
                    <label
                      className="collection-detail-row"
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
                      <input
                        type="checkbox"
                        className={`detail-row-checkbox detail-row-checkbox--${status}`}
                        checked={isSelected}
                        disabled={!isSelectMode}
                        onChange={() => onToggleVideo(video.id)}
                      />
                      <span className="detail-content">{video.title}</span>
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

          const isSelected = selectedVideoIds.has(video.id)

          return (
            <span
              key={video.id}
              role={isSelectMode ? "checkbox" : undefined}
              aria-checked={isSelectMode ? isSelected : undefined}
              tabIndex={isSelectMode ? 0 : undefined}
              className={`tile tile--video tile--${status}${isSelectMode ? " tile--select" : " tile--explore"}${isSelected ? " is-selected" : ""}`}
              title={`${video.title} -- ${statusLabel}`}
              onClick={isSelectMode ? () => onToggleVideo(video.id) : undefined}
              onKeyDown={
                isSelectMode
                  ? (e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault()
                        onToggleVideo(video.id)
                      }
                    }
                  : undefined
              }
              onMouseEnter={() =>
                onHoverVideo({
                  video,
                  collectionTitle: collection.title,
                  status,
                })
              }
              onMouseLeave={() => onHoverVideo(null)}
              onFocus={() =>
                onHoverVideo({
                  video,
                  collectionTitle: collection.title,
                  status,
                })
              }
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
  const [videoCollections, setVideoCollections] = useState<CmsCollection[]>([])
  const [videoCollectionsLoadFailed, setVideoCollectionsLoadFailed] =
    useState(false)
  const [isLoadingVideos, setIsLoadingVideos] = useState(true)
  const [reportType, setReportType] = useSessionReportType("subtitles")

  const collections = useMemo(() => {
    if (videoCollections.length > 0) {
      return cmsCollectionsToClientCollections(videoCollections, reportType)
    }
    return groupJobsIntoCollections(initialJobs ?? [])
  }, [videoCollections, initialJobs, reportType])
  const selectedLanguageIds = initialSelectedLanguageIds
  const languageOptions = initialLanguages
  const errorMessage = initialErrorMessage
  const [filter, setFilter] = useState<CoverageFilter>("all")
  const [hoveredVideo, setHoveredVideo] = useState<HoveredVideoDetails | null>(
    null,
  )
  const [expandedCollections, setExpandedCollections] = useState<string[]>([])

  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(
    new Set(),
  )
  const hydrated = useHydrated()
  const reportConfig = REPORT_CONFIG[reportType]
  const [interactionMode, setInteractionMode] = useSessionMode("explore")
  const isSelectMode = interactionMode === "select"

  const toggleVideoSelection = useCallback((videoId: string) => {
    setSelectedVideoIds((prev) => {
      const next = new Set(prev)
      if (next.has(videoId)) next.delete(videoId)
      else next.add(videoId)
      return next
    })
  }, [])

  // Clear selection when switching away from select mode
  const handleModeChange = useCallback(
    (mode: Mode) => {
      if (mode === "explore") setSelectedVideoIds(new Set())
      setInteractionMode(mode)
    },
    [setInteractionMode],
  )

  // Fetch video coverage data from proxy API when languages change
  useEffect(() => {
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
        }
        if (payload?.collections) {
          setVideoCollections(payload.collections)
        }
      } catch {
        if (!controller.signal.aborted) {
          setVideoCollectionsLoadFailed(true)
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingVideos(false)
      }
    })()

    return () => controller.abort()
  }, [selectedLanguageIds])

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

  const visibleCollections = useMemo(() => {
    if (effectiveFilter === "all") return collections
    return collections
      .map((collection) => ({
        ...collection,
        videos: collection.videos.filter(
          (video) => video.coverageStatus === effectiveFilter,
        ),
      }))
      .filter((collection) => collection.videos.length > 0)
  }, [collections, effectiveFilter])

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

  const totalCollections = visibleCollections.length
  const showCoverageControls =
    gatewayConfigured && !errorMessage && !videoCollectionsLoadFailed

  const headerSlot = hydrated
    ? document.getElementById("report-header-slot")
    : null

  return (
    <>
      {headerSlot &&
        createPortal(
          <div className="header-content">
            <div className="header-selectors">
              <span className="control-label control-label--title">
                Coverage Report
              </span>
              <div className="header-selectors-row">
                <div className="report-control report-control--text">
                  <ReportTypeSelector
                    value={reportType}
                    onChange={setReportType}
                  />
                </div>
              </div>
            </div>
          </div>,
          headerSlot,
        )}

      {showCoverageControls && (
        <section className="language-panel-section">
          <div className="language-panel-layout">
            <div className="language-panel-diagram">
              <CoverageBar
                counts={overallCounts}
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
            />
          </div>
        </section>
      )}

      {gatewayConfigured && !errorMessage && totalCollections > 0 && (
        <section
          className="collection-progress-row"
          role="status"
          aria-live="polite"
        >
          <div className="collection-progress">
            <div className="collection-progress-text">
              Showing {totalCollections} collection
              {totalCollections === 1 ? "" : "s"}
            </div>
          </div>
        </section>
      )}

      {showCoverageControls && (
        <section className="mode-panel">
          {hydrated && reportType === "subtitles" && (
            <ModeToggle mode={interactionMode} onChange={handleModeChange} />
          )}
          <p className="mode-hint">
            {hydrated && reportType === "subtitles" && isSelectMode
              ? "Select videos for translation."
              : reportConfig.hintExplore}
          </p>
          {filter !== "all" && (
            <div className="filter-pill" role="status">
              Filtering: {reportConfig.statusLabels[filter]}
              <button type="button" onClick={() => setFilter("all")}>
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
                  <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
                  <path d="m15 15 6 6M21 15l-6 6" />
                </svg>
                Clear filter
              </button>
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
                  : "collection-empty"
              }
            >
              {collections.length === 0
                ? "No videos are available yet."
                : "No videos match this filter."}
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

      {/* Translation bar — single bar with selection + detail views */}
      {hydrated && (isSelectMode || hoveredVideo) && (
        <div
          className={`translation-bar${hoveredVideo ? " is-detail" : ""}${isSelectMode ? "" : " is-explore"}`}
          role="status"
          aria-live="polite"
        >
          {isSelectMode && (
            <div className="translation-view translation-view--selection">
              <div className="translation-summary">
                <div className="translation-count">
                  {selectedVideoIds.size} video
                  {selectedVideoIds.size === 1 ? "" : "s"} selected
                </div>
                <div className="translation-target">
                  Languages: {selectedLanguageIds.join(", ") || "None"}
                </div>
              </div>
              <div className="translation-controls">
                <button
                  type="button"
                  className="translation-primary"
                  disabled={selectedVideoIds.size === 0}
                  onClick={async () => {
                    try {
                      const res = await apiFetch("/api/enrich", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          videoIds: Array.from(selectedVideoIds),
                          languages: selectedLanguageIds,
                        }),
                      })
                      if (res.ok) {
                        const data = (await res.json()) as {
                          created: number
                        }
                        handleModeChange("explore")
                        alert(
                          `${data.created} enrichment job${data.created === 1 ? "" : "s"} created.`,
                        )
                      }
                    } catch {
                      // SessionExpiredError handled by apiFetch
                    }
                  }}
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
                    <path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6" />
                  </svg>
                  Enrich Now
                </button>
                <button
                  type="button"
                  className="translation-secondary"
                  onClick={() => handleModeChange("explore")}
                  aria-label="Cancel and clear selection"
                  title="Cancel and clear selection"
                >
                  <svg
                    className="icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="m15 9-6 6M9 9l6 6" />
                  </svg>
                </button>
              </div>
            </div>
          )}
          <div className="translation-view translation-view--detail">
            {hoveredVideo ? (
              <div className="detail-media">
                {hoveredVideo.video.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    className="detail-thumb"
                    src={hoveredVideo.video.imageUrl}
                    alt={hoveredVideo.video.title}
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
                      {hoveredVideo.video.title}
                    </div>
                    <div className="translation-target">
                      {hoveredVideo.collectionTitle}
                    </div>
                  </div>
                  <div className="translation-controls translation-controls--detail">
                    <span
                      className={`detail-status detail-status--${hoveredVideo.status}`}
                    >
                      {reportConfig.statusLabels[hoveredVideo.status]}
                    </span>
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
