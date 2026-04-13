import type { AutomationRefreshMode, AutomationTemplate } from "./types"

export type AutomationOutputOwner = "missing" | "ai" | "human"

export type AutomationEligibilityCandidate = {
  videoDocumentId: string
  outputOwner: AutomationOutputOwner
}

export function templateRequiresTargetLanguages(
  template: AutomationTemplate,
): boolean {
  return template === "target_subtitles_missing"
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

export function filterEligibleCandidates<
  TCandidate extends AutomationEligibilityCandidate,
>(
  candidates: TCandidate[],
  options: {
    refreshMode: AutomationRefreshMode
    maxVideosPerRun: number
    runningAutomationKeys: ReadonlySet<string>
    buildKey: (candidate: TCandidate) => string
  },
): TCandidate[] {
  const selected: TCandidate[] = []

  for (const candidate of candidates) {
    if (!isOwnerEligible(candidate.outputOwner, options.refreshMode)) {
      continue
    }

    if (options.runningAutomationKeys.has(options.buildKey(candidate))) {
      continue
    }

    selected.push(candidate)
    if (selected.length >= options.maxVideosPerRun) {
      break
    }
  }

  return selected
}
