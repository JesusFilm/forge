import { createHash } from "node:crypto"
import { RecommendationInputError } from "./errors"
import {
  validateHolds,
  type ConversionHolds,
} from "./legacy-candidate-trace-conversion.service"

// Digest of JSON.stringify([...original64QualityRunIds].sort()), frozen from
// the September 28 private audit artifact. IDs remain outside source and logs.
const ORIGINAL_QUALITY_RUN_IDS_SHA256 =
  "a62525defe7d242765c86c10e162d0ede9f724ac27b6882c5f6f48ccf94e8b07"
const ORIGINAL_QUALITY_SELECTOR_SHA256 =
  "c983ec02830d1b2df637c04e47fd75bdd66c26bd4e0caba0c38ff851561589a1"

export function assertOriginalQualityHolds(holds: ConversionHolds): void {
  validateHolds(holds)
  const idsDigest = createHash("sha256")
    .update(JSON.stringify([...holds.qualityRunIds].sort()))
    .digest("hex")
  if (
    holds.qualitySelectorSha256 !== ORIGINAL_QUALITY_SELECTOR_SHA256 ||
    idsDigest !== ORIGINAL_QUALITY_RUN_IDS_SHA256
  )
    throw new RecommendationInputError(
      "Original frozen quality holdout set is required",
    )
}
