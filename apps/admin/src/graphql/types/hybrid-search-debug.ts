/**
 * Pothos types for the optional `debug` payload on `HybridSearchResult`.
 *
 * Surfaced only when the caller passed `debug: true` AND the request
 * origin is on the debug allowlist. Stripped silently otherwise.
 *
 * @classification public-shape
 */

import { builder } from "@/graphql/builder"
import type { SearchResultDebug } from "@/services/hybrid-search.service"

const SearchRetrieverRankRef = builder.objectRef<
  SearchResultDebug["retrieverRanks"][number]
>("HybridSearchRetrieverRank")

SearchRetrieverRankRef.implement({
  description:
    "One contributing retriever's rank for a single fused result. The `label` is an UNSTABLE internal name (e.g. 'semantic-video', 'keyword-weighted-video', 'trigram-video', 'exact-title-video') — it MAY be renamed without a breaking-change marker. Operators inspecting the payload during triage are the intended audience; do NOT branch on these strings in production code.",
  fields: (t) => ({
    label: t.exposeString("label", { nullable: false }),
    rank: t.exposeInt("rank", { nullable: false }),
  }),
})

export const SearchResultDebugRef = builder.objectRef<SearchResultDebug>(
  "HybridSearchResultDebug",
)

SearchResultDebugRef.implement({
  description:
    "Per-result internal scoring detail. Origin-gated at the boundary; absent when the caller didn't request `debug` or the origin isn't on the allowlist. Carries no embedding vectors, no PII, and no credentials — only the per-retriever ranks that produced this hit, the fused RRF score, and whether the keyword-first dilution cap down-weighted the row.",
  fields: (t) => ({
    retrieverRanks: t.field({
      type: [SearchRetrieverRankRef],
      nullable: false,
      description:
        "Per-list contributions that produced this fused result, in dispatch order (semantic-video, keyword-* / lexical retrievers, semantic-experience, keyword-experience). Each entry's `rank` is 1-based.",
      resolve: (r) => r.retrieverRanks,
    }),
    fusedScore: t.exposeFloat("fusedScore", {
      nullable: false,
      description:
        "Reciprocal Rank Fusion score BEFORE the keyword-first dilution cap. The visible `score` field on `HybridSearchResult` reflects the post-cap value; comparing the two reveals exactly how much the cap down-weighted this row (0.5× when `dilutionCapApplied` is true, identical otherwise).",
    }),
    dilutionCapApplied: t.exposeBoolean("dilutionCapApplied", {
      nullable: false,
      description:
        "Whether the keyword-first semantic-dilution cap halved this row's score. The cap only runs in `mode=\"keyword-first\"` when an exact-title hit covered every query token. In hybrid mode the cap never runs — the field reads `false` because 'cap was not applicable on this code path', NOT because 'cap considered this row and chose not to'. Use `mode` alongside this flag to interpret it correctly.",
    }),
  }),
})
