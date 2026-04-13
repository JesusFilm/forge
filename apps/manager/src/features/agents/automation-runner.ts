import { gql } from "@apollo/client"
import getClient from "@/cms/client"
import { createEnrichmentJobs } from "@/app/api/enrich/route"
import { cmsGet } from "@/services/cmsClient"
import {
  isCreatableAutomationTemplate,
  type EnrichmentAutomation,
} from "./automation-contract"
import {
  buildAutomationKey,
  selectEligibleAutomationVideos,
  type AutomationCandidateVideo,
  type AutomationOutputOwner,
} from "./eligibility"

export type AutomationRunResult = {
  status: "success" | "partial" | "failed" | "no_op"
  eligibleCount: number
  enqueuedCount: number
  skippedDuplicateCount: number
  errorCount: number
  jobDocumentIds: string[]
  errors: string[]
  summary: string
}

type CmsVideoCoverage = {
  documentId: string
  coreId: string | null
  title: string | null
  label: string | null
  aiMetadata: boolean | null
  coverage: {
    subtitles: { human: number; ai: number }
    audio: { human: number; ai: number }
  }
}

type RunningJobNode = {
  artifacts?: unknown
}

const RUNNING_AUTOMATION_JOB_PAGE_SIZE = 200

const LIST_RUNNING_AUTOMATION_JOBS = gql`
  query ListRunningAutomationJobs(
    $filters: EnrichmentJobFiltersInput
    $pagination: PaginationArg
  ) {
    enrichmentJobs(filters: $filters, pagination: $pagination) {
      documentId
      status
      artifacts
    }
  }
`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function readAutomationKeyFromArtifacts(artifacts: unknown): string | null {
  if (!isRecord(artifacts)) return null
  const automation = artifacts.automation
  if (!isRecord(automation) || automation.kind !== "metadata") return null
  const data = automation.data
  if (!isRecord(data) || typeof data.automationKey !== "string") return null
  return data.automationKey
}

async function listRunningAutomationKeys(): Promise<Set<string>> {
  const client = getClient()
  const keys = new Set<string>()
  let page = 1

  for (;;) {
    const result = await client.query<{
      enrichmentJobs?: Array<RunningJobNode | null>
    }>({
      query: LIST_RUNNING_AUTOMATION_JOBS,
      variables: {
        filters: { status: { in: ["pending", "running"] } },
        pagination: {
          page,
          pageSize: RUNNING_AUTOMATION_JOB_PAGE_SIZE,
        },
      },
      fetchPolicy: "no-cache",
    })

    const jobs = result.data?.enrichmentJobs ?? []
    for (const job of jobs) {
      const key = readAutomationKeyFromArtifacts(job?.artifacts)
      if (key) keys.add(key)
    }

    if (jobs.length < RUNNING_AUTOMATION_JOB_PAGE_SIZE) {
      return keys
    }
    page += 1
  }
}

function sourceSubtitleOwner(counts: {
  human: number
  ai: number
}): AutomationOutputOwner {
  if (counts.human > 0) return "human"
  if (counts.ai > 0) return "ai"
  return "missing"
}

function targetSubtitleOwner(counts: {
  human: number
  ai: number
}): AutomationOutputOwner {
  // Target subtitle automations are guarded to exactly one language before coverage is fetched.
  return sourceSubtitleOwner(counts)
}

function metadataOwner(aiMetadata: boolean | null): AutomationOutputOwner {
  if (aiMetadata === false) return "human"
  if (aiMetadata === true) return "ai"
  return "missing"
}

function automationOutputOwner(
  video: CmsVideoCoverage,
  automation: EnrichmentAutomation,
): AutomationOutputOwner {
  switch (automation.template) {
    case "source_subtitles_missing":
      return sourceSubtitleOwner(video.coverage.subtitles)
    case "target_subtitles_missing":
      return targetSubtitleOwner(video.coverage.subtitles)
    case "metadata_missing":
      return metadataOwner(video.aiMetadata)
    case "transcript_embeddings_missing":
    case "scene_embeddings_missing":
      return "missing"
  }
}

async function fetchAutomationCandidates(
  automation: EnrichmentAutomation,
): Promise<AutomationCandidateVideo[]> {
  const params = new URLSearchParams()
  if (
    automation.template === "target_subtitles_missing" &&
    automation.targetLanguageIds.length > 0
  ) {
    params.set("languageIds", automation.targetLanguageIds.join(","))
  }

  const response = await cmsGet<{ videos: CmsVideoCoverage[] }>(
    `/video-coverage${params.size > 0 ? `?${params}` : ""}`,
  )

  return response.videos
    .filter(
      (video) =>
        video.coreId != null &&
        video.label !== "collection" &&
        video.label !== "series",
    )
    .map((video) => ({
      documentId: video.documentId,
      coreId: video.coreId ?? video.documentId,
      muxAssetId: "",
      muxPlaybackId: "",
      outputOwner: automationOutputOwner(video, automation),
    }))
}

function summarizeResult(result: AutomationRunResult): string {
  if (result.status === "no_op") {
    return "No eligible videos."
  }
  if (result.status === "success") {
    return `Enqueued ${result.enqueuedCount} video${
      result.enqueuedCount === 1 ? "" : "s"
    }.`
  }
  if (result.status === "partial") {
    return `Enqueued ${result.enqueuedCount} video${
      result.enqueuedCount === 1 ? "" : "s"
    } with ${result.errorCount} error${result.errorCount === 1 ? "" : "s"}.`
  }
  return "Automation enqueue failed."
}

export async function enqueueAutomationRun(input: {
  runDocumentId: string
  automation: EnrichmentAutomation
}): Promise<AutomationRunResult> {
  if (!isCreatableAutomationTemplate(input.automation.template)) {
    return {
      status: "no_op",
      eligibleCount: 0,
      enqueuedCount: 0,
      skippedDuplicateCount: 0,
      errorCount: 0,
      jobDocumentIds: [],
      errors: [],
      summary:
        "Automation template is not available until coverage-backed eligibility is enabled.",
    }
  }

  if (
    input.automation.template === "target_subtitles_missing" &&
    input.automation.targetLanguageIds.length !== 1
  ) {
    return {
      status: "no_op",
      eligibleCount: 0,
      enqueuedCount: 0,
      skippedDuplicateCount: 0,
      errorCount: 0,
      jobDocumentIds: [],
      errors: [],
      summary: "Target subtitle automations require one target language.",
    }
  }

  const [candidates, runningAutomationKeys] = await Promise.all([
    fetchAutomationCandidates(input.automation),
    listRunningAutomationKeys(),
  ])

  const selection = selectEligibleAutomationVideos(candidates, {
    template: input.automation.template,
    refreshMode: input.automation.refreshMode,
    targetLanguageIds: input.automation.targetLanguageIds,
    maxVideosPerRun: input.automation.maxVideosPerRun,
    runningAutomationKeys,
  })

  if (selection.selected.length === 0) {
    const result: AutomationRunResult = {
      status: "no_op",
      eligibleCount: selection.eligibleCount,
      enqueuedCount: 0,
      skippedDuplicateCount: selection.skippedDuplicateCount,
      errorCount: 0,
      jobDocumentIds: [],
      errors: [],
      summary: "No eligible videos.",
    }
    return result
  }

  const created = await createEnrichmentJobs({
    videoIds: selection.selected.map((video) => video.coreId),
    targetLanguageIds: input.automation.targetLanguageIds,
    automation: {
      automationDocumentId: input.automation.documentId,
      automationRunDocumentId: input.runDocumentId,
      template: input.automation.template,
      refreshMode: input.automation.refreshMode,
      targetLanguageIds: input.automation.targetLanguageIds,
    },
  })

  const status =
    created.created === 0
      ? "failed"
      : created.failed > 0
        ? "partial"
        : "success"
  const result: AutomationRunResult = {
    status,
    eligibleCount: selection.eligibleCount,
    enqueuedCount: created.created,
    skippedDuplicateCount: selection.skippedDuplicateCount,
    errorCount: created.failed,
    jobDocumentIds: created.jobs.map((job) => job.jobId),
    errors: (created.errors ?? []).map(
      (error) => `${error.videoId}: ${error.error}`,
    ),
    summary: "",
  }
  return { ...result, summary: summarizeResult(result) }
}

export function buildAutomationRunKeyForVideo(input: {
  automation: EnrichmentAutomation
  videoDocumentId: string
}): string {
  return buildAutomationKey({
    template: input.automation.template,
    videoDocumentId: input.videoDocumentId,
    targetLanguageIds: input.automation.targetLanguageIds,
  })
}
