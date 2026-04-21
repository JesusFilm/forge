import type {
  AutomationRefreshMode,
  AutomationTemplate,
} from "./automation-contract"

export type AutomationOutputOwner = "missing" | "ai" | "human"

export type AutomationCandidateVideo = {
  documentId: string
  coreId: string
  muxAssetId: string
  muxPlaybackId: string
  outputOwner: AutomationOutputOwner
}

export type AutomationEligibilityResult = {
  eligibleCount: number
  skippedDuplicateCount: number
  selected: AutomationCandidateVideo[]
}

export function buildAutomationKey(input: {
  template: AutomationTemplate
  videoDocumentId: string
  targetLanguageIds: string[]
}): string {
  const targetLanguageKey = Array.from(new Set(input.targetLanguageIds))
    .sort((left, right) => left.localeCompare(right))
    .join(",")
  return [
    input.template,
    input.videoDocumentId,
    targetLanguageKey || "source",
  ].join(":")
}

function isOwnerEligible(
  owner: AutomationOutputOwner,
  refreshMode: AutomationRefreshMode,
): boolean {
  if (owner === "human") return false
  if (owner === "missing") return true
  return refreshMode === "refresh_ai_generated"
}

export function selectEligibleAutomationVideos(
  candidates: AutomationCandidateVideo[],
  options: {
    template: AutomationTemplate
    refreshMode: AutomationRefreshMode
    targetLanguageIds: string[]
    maxVideosPerRun: number
    runningAutomationKeys: ReadonlySet<string>
  },
): AutomationEligibilityResult {
  if (
    options.template === "target_subtitles_missing" &&
    options.targetLanguageIds.length !== 1
  ) {
    return {
      eligibleCount: 0,
      skippedDuplicateCount: 0,
      selected: [],
    }
  }

  const selected: AutomationCandidateVideo[] = []
  let eligibleCount = 0
  let skippedDuplicateCount = 0

  for (const candidate of candidates) {
    if (!isOwnerEligible(candidate.outputOwner, options.refreshMode)) {
      continue
    }

    const key = buildAutomationKey({
      template: options.template,
      videoDocumentId: candidate.documentId,
      targetLanguageIds: options.targetLanguageIds,
    })
    if (options.runningAutomationKeys.has(key)) {
      skippedDuplicateCount += 1
      continue
    }

    eligibleCount += 1
    if (selected.length < options.maxVideosPerRun) {
      selected.push(candidate)
    }
  }

  return {
    eligibleCount,
    skippedDuplicateCount,
    selected,
  }
}
