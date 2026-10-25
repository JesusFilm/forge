import {
  composeMmrSlate,
  MMR_SLATE_POLICY_VERSION,
  type MmrSlateEditorial,
  type MmrSlateItemEvidence,
  type MmrSlateResult,
} from "../composition/mmr"

export const SHADOW_SLATE_POLICY_VERSION = "source-interest-theme-mmr-shadow-v1"
export type ShadowSlateEditorial = MmrSlateEditorial
export type ShadowSlateItemEvidence = MmrSlateItemEvidence
export type ShadowSlateResult = MmrSlateResult &
  Readonly<{ decision: "pending" }>

/** Legacy shadow evidence remains pending until a separate decision is recorded. */
export function composeShadowSlate(
  input: Parameters<typeof composeMmrSlate>[0],
): ShadowSlateResult {
  const policyVersion = (
    input.policyVersion ?? SHADOW_SLATE_POLICY_VERSION
  ).slice(0, 64)
  const result = composeMmrSlate({
    ...input,
    // Do not expand the legacy allowlist when the neutral runtime version changes.
    policyVersion:
      policyVersion === SHADOW_SLATE_POLICY_VERSION
        ? MMR_SLATE_POLICY_VERSION
        : "unsupported-shadow-policy",
  })
  return { ...result, policyVersion, decision: "pending" }
}
