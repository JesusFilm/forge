import { composeMmrSlate, MMR_SLATE_POLICY_VERSION } from "./mmr"
import { compositionInputAvailability, hasMissingInput } from "./policy"

export type CompositionInputDiagnostic = Readonly<{
  version: "composition-input-availability-v1"
  missingSource: boolean
  missingInterest: boolean
  missingTheme: boolean
  missingHistory: boolean
  candidateCount: number
  selectedCount: number
  themedSelectedCount: number
}>

/** Shared structural checks only. Callers must separately resolve and fence
 * their exact trial or owner-release authority; this function grants none.
 */
export function composeStructurallyValidMmrSlate(input: {
  slate: Parameters<typeof composeMmrSlate>[0]
  historyAvailable: boolean
  composerVersion: string
  graphGenerationId?: string | null
  graphGeneratorVersion: string
}) {
  const refuse = (
    reason: string,
    compositionInputDiagnostic?: CompositionInputDiagnostic,
  ) => ({
    status: "fallback" as const,
    reason,
    ...(compositionInputDiagnostic ? { compositionInputDiagnostic } : {}),
  })
  if (input.slate.editorial)
    return refuse("editorial_adapter_outside_supported_subset")
  if (
    input.composerVersion !== MMR_SLATE_POLICY_VERSION ||
    (input.slate.policyVersion &&
      input.slate.policyVersion !== MMR_SLATE_POLICY_VERSION)
  )
    return refuse("composition_version_mismatch")
  if (
    input.slate.ordered
      .slice(0, 64)
      .some((candidate) =>
        candidate.nominations.some(
          (nomination) =>
            nomination.source.generator === "directional-cowatch" &&
            (!input.graphGenerationId ||
              nomination.source.generatorVersion !==
                input.graphGeneratorVersion ||
              nomination.source.evidence.generation !==
                input.graphGenerationId),
        ),
      )
  )
    return refuse("composition_candidate_graph_mismatch")
  const result = composeMmrSlate(input.slate)
  const availability = compositionInputAvailability(
    result,
    input.historyAvailable,
  )
  if (hasMissingInput(availability))
    return refuse("composition_required_input_unavailable", {
      version: "composition-input-availability-v1",
      ...availability,
      candidateCount: Math.min(64, input.slate.ordered.length),
      selectedCount: result.composed.length,
      themedSelectedCount: result.coverage.itemsWithThemes,
    })
  return { status: "composed" as const, result }
}
