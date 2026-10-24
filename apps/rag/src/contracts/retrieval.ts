/**
 * Retrieval seam: the query + policy in, ranked cited results out.
 * Types only. See docs/architecture.md §2.
 *
 * The published caller-facing shapes are owned by `@forge/rag-contracts`.
 * Engine-internal rows and filters remain app-local and never cross the seam.
 */
import type { RetrievalPolicy, RankedResult } from "@forge/rag-contracts"

/** Filter the search store applies during candidate selection. */
export interface SearchFilter {
  allowedSourceKeys?: string[]
  sourceKey?: string
  domain?: string
  urlPrefix?: string
  language?: string
  category?: string
  embeddingModel?: string
}

/** A raw scored row from the search store, pre dedup + citation assembly. */
export interface ScoredRow {
  chunkId: string
  documentId: string // the parent document — keys full-document reassembly (issue #79)
  score: number
  text: string
  ord: number
  tags: string[]
  sourceKey: string
  sourceName: string
  title: string | null
  canonicalUrl: string
  contentHash: string // used by the 3-key dedup
}

/** The Retrieval context's public surface. Transport-agnostic. */
export interface Retriever {
  search(query: string, policy?: RetrievalPolicy): Promise<RankedResult[]>
}
