import { FORGE_WORKFLOW_STEPS } from "@/lib/workflow-steps"
import type {
  JobArtifactManifest,
  JobRecord,
  JobStatus,
  JobStepState,
  WorkflowStepName,
} from "@/types/job"

export type CoverageStatus = "human" | "ai" | "none"

export type CoverageFilter = "all" | CoverageStatus

export type ReportType = "subtitles" | "audio" | "meta"

export type CoverageCounts = { human: number; ai: number; none: number }

export type ClientVideo = {
  id: string
  title: string
  imageUrl: string | null
  muxAssetId: string
  muxPlaybackId: string
  status: JobStatus
  languages: string[]
  steps: JobStepState[]
  errors: Array<{ step: WorkflowStepName; message: string; at: string }>
  artifacts: JobArtifactManifest
  coverageStatus: CoverageStatus
  coverageCounts: CoverageCounts
  stepCompleteness: { completed: number; total: number }
}

export type ClientCollection = {
  id: string
  title: string
  label: string
  labelDisplay: string
  videos: ClientVideo[]
}

export type CmsVideo = {
  id: string
  title: string
  imageUrl: string | null
  label: string
  coverage: {
    subtitles: CoverageCounts
    audio: CoverageCounts
    meta: CoverageCounts
  }
}

export type CmsCollection = {
  id: string
  title: string
  imageUrl: string | null
  label: string
  labelDisplay: string
  coverage: {
    subtitles: CoverageCounts
    audio: CoverageCounts
    meta: CoverageCounts
  }
  videos: CmsVideo[]
}

export function countsToStatus(counts: CoverageCounts): CoverageStatus {
  if (counts.human > 0) return "human"
  if (counts.ai > 0) return "ai"
  return "none"
}

export function computeCoverageStatus(job: JobRecord): CoverageStatus {
  const completedCount = job.steps.filter(
    (step) => step.status === "completed",
  ).length

  if (completedCount === FORGE_WORKFLOW_STEPS.length) return "human"
  if (completedCount > 0) return "ai"
  return "none"
}

export function jobToClientVideo(job: JobRecord): ClientVideo {
  const completedCount = job.steps.filter(
    (step) => step.status === "completed",
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
    coverageCounts: { human: 0, ai: 0, none: 0 },
    stepCompleteness: {
      completed: completedCount,
      total: FORGE_WORKFLOW_STEPS.length,
    },
  }
}

export function groupJobsIntoCollections(
  jobs: JobRecord[],
): ClientCollection[] {
  const statusGroups: Record<string, JobRecord[]> = {}
  for (const job of jobs) {
    const group = job.status
    statusGroups[group] ??= []
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

export function cmsVideoToClientVideo(
  video: CmsVideo,
  reportType: ReportType,
): ClientVideo {
  const counts = video.coverage[reportType]
  const coverageStatus = countsToStatus(counts)

  return {
    id: video.id,
    title: video.title,
    imageUrl: video.imageUrl,
    muxAssetId: video.id,
    muxPlaybackId: "",
    status: "completed",
    languages: [],
    steps: FORGE_WORKFLOW_STEPS.map((name) => ({
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
    coverageCounts: counts,
    stepCompleteness: {
      completed:
        coverageStatus === "human"
          ? FORGE_WORKFLOW_STEPS.length
          : coverageStatus === "ai"
            ? 1
            : 0,
      total: FORGE_WORKFLOW_STEPS.length,
    },
  }
}

export function collectionToClientVideo(
  collection: CmsCollection,
  reportType: ReportType,
): ClientVideo {
  const counts = collection.coverage[reportType]
  const coverageStatus = countsToStatus(counts)

  return {
    id: `collection:${collection.id}`,
    title: collection.title,
    imageUrl: collection.imageUrl,
    muxAssetId: collection.id,
    muxPlaybackId: "",
    status: "completed",
    languages: [],
    steps: FORGE_WORKFLOW_STEPS.map((name) => ({
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
    coverageCounts: counts,
    stepCompleteness: {
      completed:
        coverageStatus === "human"
          ? FORGE_WORKFLOW_STEPS.length
          : coverageStatus === "ai"
            ? 1
            : 0,
      total: FORGE_WORKFLOW_STEPS.length,
    },
  }
}

export function cmsCollectionsToClientCollections(
  collections: CmsCollection[],
  reportType: ReportType,
): ClientCollection[] {
  return collections.map((collection) => ({
    id: collection.id,
    title: collection.title,
    label: collection.label,
    labelDisplay: collection.labelDisplay,
    videos: [
      ...(collection.id === "standalone"
        ? []
        : [collectionToClientVideo(collection, reportType)]),
      ...collection.videos.map((video) =>
        cmsVideoToClientVideo(video, reportType),
      ),
    ],
  }))
}
