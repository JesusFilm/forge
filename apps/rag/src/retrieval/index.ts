/**
 * Retrieval context barrel — query + policy → ranked, cited results. Consumed by
 * the runners (scripts/query.ts, scripts/eval.ts) which wire the ports. Imports
 * only contracts. See docs/architecture.md §3.
 */
export {
  createRetriever,
  candidateTopK,
  policyToFilter,
  type RetrieveDeps,
} from "./retrieve.js"
