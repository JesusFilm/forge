import type { DatadogTriageServiceProfile } from "../../config/env"

import type { TriageAnalysis } from "./analyze"
import type { TriageCandidate } from "./detect"
import { buildTriageTicketDraft } from "./ticket-draft"
import type { TriageActionDraft } from "./schema"

/**
 * Pure threshold gating over the model's structured output (U5, R6). The model
 * proposes; this decides. Every threshold lives in configuration so an operator
 * can retune without a deploy, and every rejection names exactly one gate.
 */

export type TriageSuppressionReason =
  | "not_worth_investigating"
  | "below_confidence"
  | "below_actionability"
  | "below_recurrence"

export type TriageActionDecision =
  | { outcome: "file"; draft: TriageActionDraft }
  | { outcome: "suppress"; reason: TriageSuppressionReason }

export type TriagePolicyConfig = {
  confidenceThreshold: number
  actionabilityThreshold: number
  minOccurrences: number
}

/**
 * Occurrences the recurrence gate should judge, or undefined when the gate
 * does not apply. A monitor alert episode IS the recurrence — the monitor's own
 * threshold already decided that — so counting it again would double-gate it.
 */
export function recurrenceCount(
  candidate: TriageCandidate,
): number | undefined {
  if (candidate.evidence.kind === "monitor") return undefined
  return candidate.evidence.windowCount
}

export function decideTriageAction(input: {
  candidate: TriageCandidate
  analysis: TriageAnalysis
  config: TriagePolicyConfig
  serviceProfile: DatadogTriageServiceProfile
  site: string
  labelId?: string
}): TriageActionDecision {
  if (!input.analysis.worthInvestigating) {
    return { outcome: "suppress", reason: "not_worth_investigating" }
  }
  if (input.analysis.confidence < input.config.confidenceThreshold) {
    return { outcome: "suppress", reason: "below_confidence" }
  }
  if (input.analysis.actionability < input.config.actionabilityThreshold) {
    return { outcome: "suppress", reason: "below_actionability" }
  }
  const occurrences = recurrenceCount(input.candidate)
  if (occurrences !== undefined && occurrences < input.config.minOccurrences) {
    return { outcome: "suppress", reason: "below_recurrence" }
  }
  return {
    outcome: "file",
    draft: buildTriageTicketDraft({
      candidate: input.candidate,
      analysis: input.analysis,
      serviceProfile: input.serviceProfile,
      site: input.site,
      labelId: input.labelId,
    }),
  }
}
