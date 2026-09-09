import "server-only"
import { createEvidenceObserver } from "./recommendation-evidence-observability-contract"
export type { RecommendationEvidenceObservation } from "./recommendation-evidence-observability-contract"

export const observeRecommendationEvidence = createEvidenceObserver({
  service: "web",
  log: (message) => console.info(message),
})
