"use client"

import Link from "next/link"
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { LanguageGeoSelector } from "./LanguageGeoSelector"

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

type CoverageStatus = "human" | "ai" | "none"

type CoverageFilter = "all" | CoverageStatus

type ReportType = "subtitles" | "audio" | "meta"

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type ClientVideo = {
  id: string
  title: string
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

interface CoverageReportClientProps {
  gatewayConfigured: boolean
  initialErrorMessage: string | null
  initialJobs: JobRecord[]
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
const COLLECTIONS_PER_BATCH = 200

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
            title={`${segment.label} jobs: ${counts[segment.key]}`}
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

function StepSummary({ steps }: { steps: JobStepState[] }) {
  return (
    <div className="meta-summary" aria-label="Step completeness">
      <span className="meta-score">
        Steps {steps.filter((s) => s.status === "completed").length}/
        {steps.length}
      </span>
      {steps.map((step) => (
        <span
          key={step.name}
          className={`meta-pill${
            step.status === "completed"
              ? " is-complete"
              : step.status === "running"
                ? " is-running"
                : step.status === "failed"
                  ? " is-failed"
                  : " is-missing"
          }`}
        >
          {step.name}
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Collection card
// ---------------------------------------------------------------------------

type CollectionCardProps = {
  collection: ClientCollection
  reportType: ReportType
  reportConfig: (typeof REPORT_CONFIG)[ReportType]
  filter: CoverageFilter
  isExpanded: boolean
  onToggleExpanded: (collectionId: string) => void
  onHoverVideo: (details: HoveredVideoDetails | null) => void
}

function getReportStatusForVideo(
  video: ClientVideo,
  reportType: ReportType,
): CoverageStatus {
  if (reportType === "audio") {
    if (video.languages.length > 1) return "human"
    if (video.languages.length === 1) return "ai"
    return "none"
  }
  if (reportType === "meta") {
    const count = Object.keys(video.artifacts).length
    if (count >= FORGE_STEPS.length) return "human"
    if (count > 0) return "ai"
    return "none"
  }
  return video.coverageStatus
}

const CollectionCard = memo(function CollectionCard({
  collection,
  reportType,
  reportConfig,
  filter,
  isExpanded,
  onToggleExpanded,
  onHoverVideo,
}: CollectionCardProps) {
  const total = collection.videos.length

  const counts = useMemo(() => {
    return collection.videos.reduce(
      (acc, video) => {
        acc[getReportStatusForVideo(video, reportType)] += 1
        return acc
      },
      { human: 0, ai: 0, none: 0 },
    )
  }, [collection.videos, reportType])

  const filteredVideos = useMemo(() => {
    if (filter === "all") return collection.videos
    return collection.videos.filter(
      (video) => getReportStatusForVideo(video, reportType) === filter,
    )
  }, [collection.videos, filter, reportType])

  const sortedVideos = useMemo(() => {
    return [...filteredVideos].sort((a, b) => {
      const order: Record<CoverageStatus, number> = {
        human: 0,
        ai: 1,
        none: 2,
      }
      return (
        order[getReportStatusForVideo(a, reportType)] -
        order[getReportStatusForVideo(b, reportType)]
      )
    })
  }, [filteredVideos, reportType])

  return (
    <section
      className="collection-card"
      key={collection.id}
      tabIndex={0}
      role="button"
      aria-expanded={isExpanded}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onToggleExpanded(collection.id)
        }
      }}
      onClick={(event) => {
        const target = event.target as HTMLElement
        if (target.closest("a, button, input, select, textarea")) return
        if (target.closest(".tile")) return
        onToggleExpanded(collection.id)
      }}
    >
      <div className="collection-header">
        <div className="collection-title-row">
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
                {total} job{total === 1 ? "" : "s"}
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
        {filteredVideos.map((video) => {
          const status = getReportStatusForVideo(video, reportType)
          const statusLabel = reportConfig.statusLabels[status]
          const tileStatusLabel =
            reportType === "subtitles"
              ? `${statusLabel} (${video.stepCompleteness.completed}/${video.stepCompleteness.total})`
              : statusLabel

          return (
            <div className="collection-detail-row" key={video.id}>
              <span
                className={`tile tile--${status} detail-tile`}
                aria-hidden="true"
                title={`${video.title} -- ${tileStatusLabel}`}
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
              />
              <div className="detail-content">
                <span>{video.muxAssetId}</span>
                {reportType === "subtitles" && (
                  <StepSummary steps={video.steps} />
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className={`collection-tiles${isExpanded ? " is-hidden" : ""}`}>
        {sortedVideos.map((video) => {
          const status = getReportStatusForVideo(video, reportType)
          const statusLabel = reportConfig.statusLabels[status]

          return (
            <span
              key={video.id}
              className={`tile tile--video tile--${status} tile--explore`}
              title={`${video.muxAssetId} -- ${statusLabel}`}
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
          <p className="collection-empty">No jobs in this collection.</p>
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
  const collections = useMemo(
    () => groupJobsIntoCollections(initialJobs),
    [initialJobs],
  )
  const selectedLanguageIds = initialSelectedLanguageIds
  const languageOptions = initialLanguages
  const errorMessage = initialErrorMessage
  const [reportType, setReportType] = useSessionReportType("subtitles")
  const [filter, setFilter] = useState<CoverageFilter>("all")
  const [hoveredVideo, setHoveredVideo] = useState<HoveredVideoDetails | null>(
    null,
  )
  const [expandedCollections, setExpandedCollections] = useState<string[]>([])
  const [visibleCount, setVisibleCount] = useState(COLLECTIONS_PER_BATCH)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [queueJobsCount, setQueueJobsCount] = useState<number | null>(null)
  const loadMoreTimeoutRef = useRef<number | null>(null)

  const hydrated = useHydrated()
  const reportConfig = REPORT_CONFIG[reportType]
  const [interactionMode, setInteractionMode] = useSessionMode("explore")
  const isSelectMode = interactionMode === "select"
  const isSubtitleReport = reportType === "subtitles"

  useEffect(() => {
    if (typeof document === "undefined") return
    document.body.classList.add("coverage-standalone")
    return () => {
      document.body.classList.remove("coverage-standalone")
      delete document.documentElement.dataset.coverageLoading
    }
  }, [])

  useEffect(() => {
    return () => {
      if (loadMoreTimeoutRef.current) {
        window.clearTimeout(loadMoreTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadQueueJobsCount() {
      try {
        const response = await fetch("/api/jobs", { cache: "no-store" })
        if (!response.ok) {
          return
        }

        const payload = (await response.json()) as {
          jobs: JobRecord[]
          total: number
        }
        const currentCount = payload.total ?? 0

        if (!cancelled) {
          setQueueJobsCount(currentCount)
        }
      } catch {
        if (!cancelled) {
          setQueueJobsCount(null)
        }
      }
    }

    void loadQueueJobsCount()
    const intervalId = window.setInterval(loadQueueJobsCount, 30000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  const getReportStatus = useCallback(
    (video: ClientVideo): CoverageStatus => {
      return getReportStatusForVideo(video, reportType)
    },
    [reportType],
  )

  const overallCounts = useMemo(() => {
    return collections.reduce(
      (acc, collection) => {
        for (const video of collection.videos) {
          acc[getReportStatus(video)] += 1
        }
        return acc
      },
      { human: 0, ai: 0, none: 0 },
    )
  }, [collections, getReportStatus])

  const effectiveFilter = filter

  const visibleCollections = useMemo(() => {
    if (effectiveFilter === "all") return collections
    return collections
      .map((collection) => ({
        ...collection,
        videos: collection.videos.filter(
          (video) => getReportStatus(video) === effectiveFilter,
        ),
      }))
      .filter((collection) => collection.videos.length > 0)
  }, [collections, effectiveFilter, getReportStatus])

  const effectiveVisibleCount = useMemo(
    () => Math.min(visibleCount, Math.max(visibleCollections.length, 0)),
    [visibleCount, visibleCollections.length],
  )

  const pagedCollections = useMemo(
    () => visibleCollections.slice(0, effectiveVisibleCount),
    [visibleCollections, effectiveVisibleCount],
  )

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

  const handleRefreshNow = useCallback(() => {
    if (typeof window === "undefined") {
      return
    }

    const current = new URL(window.location.href)
    current.searchParams.set("refresh", "1")
    window.location.assign(
      `${current.pathname}?${current.searchParams.toString()}`,
    )
  }, [])

  const handleLoadMore = useCallback(() => {
    if (isLoadingMore) return
    setIsLoadingMore(true)
    loadMoreTimeoutRef.current = window.setTimeout(() => {
      setVisibleCount((prev) =>
        Math.min(prev + COLLECTIONS_PER_BATCH, visibleCollections.length),
      )
      setIsLoadingMore(false)
    }, 240)
  }, [isLoadingMore, visibleCollections.length])

  const totalCollections = visibleCollections.length
  const shownCollections = Math.min(visibleCount, totalCollections)
  const canLoadMore = shownCollections < totalCollections
  const progressPercent =
    totalCollections > 0
      ? Math.round((shownCollections / totalCollections) * 100)
      : 0

  const jobsHref = "/dashboard/jobs"

  return (
    <div className="report-shell">
      <header className="report-header">
        <div className="header-brand">
          <Link href="/dashboard/coverage" aria-label="Go to coverage report">
            <img
              src="/jesusfilm-sign.svg"
              alt="Jesus Film Project"
              className="header-logo"
            />
          </Link>
        </div>
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
        </div>
        <div className="header-diagram">
          <div className="header-diagram-menu header-nav-tabs">
            <Link
              href="/dashboard/coverage"
              className="header-nav-link is-active"
              aria-current="page"
            >
              <span className="header-nav-link-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" role="presentation" focusable="false">
                  <path d="M1.5 8c1.8-3 4-4.5 6.5-4.5S12.7 5 14.5 8c-1.8 3-4 4.5-6.5 4.5S3.3 11 1.5 8z" />
                  <circle cx="8" cy="8" r="2.1" />
                </svg>
              </span>
              <span>Report</span>
            </Link>
            <Link href={jobsHref} className="header-nav-link">
              <span className="header-nav-link-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" role="presentation" focusable="false">
                  <path d="M3 4h6M3 8h10M3 12h8" />
                </svg>
              </span>
              <span>Queue</span>
              {hydrated && queueJobsCount !== null && (
                <span
                  className="header-nav-link-badge"
                  aria-label={`${queueJobsCount} current jobs`}
                  title={`${queueJobsCount} current jobs`}
                >
                  {queueJobsCount}
                </span>
              )}
            </Link>
          </div>
        </div>
      </header>

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

      {gatewayConfigured && !errorMessage && (
        <section
          className="collection-progress-row"
          role="status"
          aria-live="polite"
        >
          <div className="collection-progress">
            <div className="collection-progress-text">
              Showing {shownCollections} of {totalCollections} collections
            </div>
            <div
              className="collection-progress-bar"
              role="progressbar"
              aria-valuenow={progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Collections loading progress"
            >
              <span style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
          <div className="collection-cache-meta">
            <span className="collection-cache-refresh">
              <button
                type="button"
                className="collection-cache-clear"
                onClick={handleRefreshNow}
                aria-label="Refresh now"
                title="Refresh now"
              >
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
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M16 16h5v5" />
                </svg>
                Refresh now
              </button>
            </span>
          </div>
        </section>
      )}

      <section className="mode-panel">
        {hydrated && isSubtitleReport && (
          <ModeToggle mode={interactionMode} onChange={setInteractionMode} />
        )}
        <p className="mode-hint">
          {hydrated && isSubtitleReport && isSelectMode
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

      {!gatewayConfigured ? (
        <div className="report-error">
          Configure the jobs API endpoint to load coverage data.
        </div>
      ) : errorMessage ? (
        <div className="report-error">{errorMessage}</div>
      ) : (
        <div className="collections">
          {pagedCollections.map((collection) => {
            const isExpanded = expandedCollections.includes(collection.id)

            return (
              <CollectionCard
                key={collection.id}
                collection={collection}
                reportType={reportType}
                reportConfig={reportConfig}
                filter={effectiveFilter}
                isExpanded={isExpanded}
                onToggleExpanded={toggleExpanded}
                onHoverVideo={handleHoverVideo}
              />
            )
          })}
          {totalCollections === 0 && (
            <div className="collection-empty">No jobs match this filter.</div>
          )}
          {totalCollections > 0 && (
            <div className="collection-load-more">
              <button
                type="button"
                className="load-more-button"
                onClick={handleLoadMore}
                disabled={!canLoadMore || isLoadingMore}
                aria-label="Load more collections"
                aria-busy={isLoadingMore}
              >
                {isLoadingMore && (
                  <span className="load-more-spinner" aria-hidden="true" />
                )}
                {canLoadMore
                  ? "Load More Collections"
                  : "All collections loaded"}
              </button>
              <div className="collection-load-meta">
                {shownCollections} of {totalCollections} loaded
              </div>
            </div>
          )}
        </div>
      )}

      {/* Translation bar — single bar with selection + detail views */}
      {hydrated && (
        <div
          className={`translation-bar${hoveredVideo ? " is-detail" : ""}${isSelectMode ? "" : " is-explore"}`}
          role="status"
          aria-live="polite"
        >
          {isSelectMode && (
            <div className="translation-view translation-view--selection">
              <div className="translation-summary">
                <div className="translation-count">0 videos selected</div>
                <div className="translation-target">
                  Target languages: Unknown
                </div>
              </div>
              <div className="translation-controls">
                <button type="button" className="translation-primary" disabled>
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
                  Translate Now
                </button>
                <button
                  type="button"
                  className="translation-secondary"
                  onClick={() => setInteractionMode("explore")}
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
                <div
                  className="detail-thumb detail-thumb--empty"
                  aria-hidden="true"
                />
                <div className="detail-info">
                  <div className="translation-summary">
                    <div className="translation-count">
                      {hoveredVideo.video.muxAssetId}
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
    </div>
  )
}
