import { createEnrichmentJobs } from "@/app/api/enrich/route"
import { getCmsGateway, readMockCmsState } from "@/cms/gateway"
import { cmsGet } from "@/services/cmsClient"
import {
  isCreatableAutomationTemplate,
  type AutomationDryRunReport,
  type AutomationRunMode,
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
  dryRunReport?: AutomationDryRunReport
}

type CmsAutomationCandidate = {
  documentId: string
  coreId: string
  outputOwner: AutomationOutputOwner
}

type AutomationSelection = {
  eligibleCount: number
  skippedDuplicateCount: number
  selected: AutomationCandidateVideo[]
}

function isAutomationCandidate(
  value: unknown,
): value is CmsAutomationCandidate {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false
  }
  const candidate = value as {
    documentId?: unknown
    coreId?: unknown
    outputOwner?: unknown
  }
  return (
    typeof candidate.documentId === "string" &&
    candidate.documentId.length > 0 &&
    typeof candidate.coreId === "string" &&
    candidate.coreId.length > 0 &&
    (candidate.outputOwner === "missing" ||
      candidate.outputOwner === "ai" ||
      candidate.outputOwner === "human")
  )
}

function readCount(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

function deriveMockOutputOwner(
  automation: EnrichmentAutomation,
  candidate: {
    aiMetadata: boolean | null
    coverage: {
      subtitles: { human: number; ai: number }
    }
  },
): AutomationOutputOwner {
  if (automation.template === "metadata_missing") {
    if (candidate.aiMetadata == null) return "missing"
    return candidate.aiMetadata ? "ai" : "human"
  }

  if (candidate.coverage.subtitles.human > 0) return "human"
  if (candidate.coverage.subtitles.ai > 0) return "ai"
  return "missing"
}

async function fetchAutomationSelection(
  automation: EnrichmentAutomation,
): Promise<AutomationSelection> {
  const mockState = await readMockCmsState(getCmsGateway())
  if (mockState) {
    const candidates: AutomationCandidateVideo[] =
      mockState.readModels.videoCoverage.map((video) => ({
        documentId: video.documentId,
        coreId: video.coreId ?? video.documentId,
        muxAssetId: "",
        muxPlaybackId: "",
        outputOwner: deriveMockOutputOwner(automation, video),
      }))

    return selectEligibleAutomationVideos(candidates, {
      template: automation.template,
      refreshMode: automation.refreshMode,
      targetLanguageIds: automation.targetLanguageIds,
      maxVideosPerRun: automation.maxVideosPerRun,
      runningAutomationKeys: new Set(),
    })
  }

  const params = new URLSearchParams()
  params.set("template", automation.template)
  params.set("refreshMode", automation.refreshMode)
  if (
    automation.template === "target_subtitles_missing" &&
    automation.targetLanguageIds.length > 0
  ) {
    params.set("targetLanguageIds", automation.targetLanguageIds.join(","))
  }
  params.set("limit", String(automation.maxVideosPerRun))

  const response = await cmsGet<{
    candidates?: unknown
    eligibleCount?: unknown
    skippedDuplicateCount?: unknown
  }>(
    `/video-coverage/automation-candidates${
      params.size > 0 ? `?${params}` : ""
    }`,
  )

  const selected = Array.isArray(response.candidates)
    ? response.candidates.filter(isAutomationCandidate).map((video) => ({
        documentId: video.documentId,
        coreId: video.coreId,
        muxAssetId: "",
        muxPlaybackId: "",
        outputOwner: video.outputOwner,
      }))
    : []

  return {
    eligibleCount: readCount(response.eligibleCount),
    skippedDuplicateCount: readCount(response.skippedDuplicateCount),
    selected,
  }
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

const DRY_RUN_SUPPRESSED_OPERATIONS = [
  "createEnrichmentJobs",
  "runVideoEnrichment",
  "ensureGeneratedSubtitlesForAsset",
  "syncTranslatedSubtitlesToMux",
  "applySubtitleOverride",
  "syncEmbeddingArtifact",
] as const

function summarizeDryRun(wouldEnqueueCount: number): string {
  if (wouldEnqueueCount === 0) {
    return "Dry run found no videos to enqueue."
  }
  return `Dry run would enqueue ${wouldEnqueueCount} video${
    wouldEnqueueCount === 1 ? "" : "s"
  }.`
}

function buildDryRunReport(input: {
  runDocumentId: string
  automation: EnrichmentAutomation
  selection: AutomationSelection
  generatedAt: string
  summary: string
}): AutomationDryRunReport {
  return {
    kind: "metadata",
    data: {
      runMode: "dry_run",
      automationDocumentId: input.automation.documentId,
      automationRunDocumentId: input.runDocumentId,
      template: input.automation.template,
      refreshMode: input.automation.refreshMode,
      targetLanguageIds: input.automation.targetLanguageIds,
      maxVideosPerRun: input.automation.maxVideosPerRun,
      eligibleCount: input.selection.eligibleCount,
      skippedDuplicateCount: input.selection.skippedDuplicateCount,
      wouldEnqueueCount: input.selection.selected.length,
      selectedCandidates: input.selection.selected.map((video) => ({
        videoDocumentId: video.documentId,
        coreId: video.coreId,
        outputOwner: video.outputOwner,
        automationKey: buildAutomationKey({
          template: input.automation.template,
          videoDocumentId: video.documentId,
          targetLanguageIds: input.automation.targetLanguageIds,
        }),
      })),
      suppressedOperations: [...DRY_RUN_SUPPRESSED_OPERATIONS],
      summary: input.summary,
      generatedAt: input.generatedAt,
    },
  }
}

export async function enqueueAutomationRun(input: {
  runDocumentId: string
  automation: EnrichmentAutomation
  runMode?: AutomationRunMode
}): Promise<AutomationRunResult> {
  const runMode = input.runMode ?? input.automation.runMode ?? "live"

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

  const selection = await fetchAutomationSelection(input.automation)

  if (runMode === "dry_run") {
    const summary = summarizeDryRun(selection.selected.length)
    const result: AutomationRunResult = {
      status: selection.selected.length === 0 ? "no_op" : "success",
      eligibleCount: selection.eligibleCount,
      enqueuedCount: 0,
      skippedDuplicateCount: selection.skippedDuplicateCount,
      errorCount: 0,
      jobDocumentIds: [],
      errors: [],
      summary,
    }
    return {
      ...result,
      dryRunReport: buildDryRunReport({
        runDocumentId: input.runDocumentId,
        automation: input.automation,
        selection,
        generatedAt: new Date().toISOString(),
        summary,
      }),
    }
  }

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
