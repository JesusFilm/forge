import { createEvidenceObserver } from "./evidence-observability-contract"
export type { RecommendationEvidenceObservation } from "./evidence-observability-contract"

export const observeRecommendationEvidence = createEvidenceObserver({
  service: "admin",
  log: (message) => console.info(message),
})
