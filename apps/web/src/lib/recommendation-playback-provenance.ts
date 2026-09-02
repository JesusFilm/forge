"use client"

import {
  RECOMMENDATION_PLAYBACK_PROVENANCE_KEY,
  type RecommendationPlaybackSource,
} from "./recommendation-contracts"

type NonRecommendationSource = Exclude<
  RecommendationPlaybackSource,
  "recommendation" | "direct"
>

export type RecommendationPlaybackProvenance = {
  source: NonRecommendationSource
  sourceRef?: string
}

const SOURCES = new Set<NonRecommendationSource>([
  "search",
  "share",
  "acquisition",
  "editorial",
])

export function markRecommendationPlaybackProvenance(
  provenance: RecommendationPlaybackProvenance,
): void {
  if (!SOURCES.has(provenance.source)) return
  const sourceRef = provenance.sourceRef?.trim()
  if (sourceRef && sourceRef.length > 191) return
  try {
    sessionStorage.setItem(
      RECOMMENDATION_PLAYBACK_PROVENANCE_KEY,
      JSON.stringify({
        source: provenance.source,
        ...(sourceRef ? { sourceRef } : {}),
      }),
    )
  } catch {
    // Provenance is optional diagnostics. Navigation and playback never wait
    // for storage, and the destination falls back to direct.
  }
}

export function consumeRecommendationPlaybackProvenance(): RecommendationPlaybackProvenance | null {
  try {
    const raw = sessionStorage.getItem(RECOMMENDATION_PLAYBACK_PROVENANCE_KEY)
    sessionStorage.removeItem(RECOMMENDATION_PLAYBACK_PROVENANCE_KEY)
    if (!raw) {
      const url = new URL(window.location.href)
      const inbound = url.searchParams.get("playback_source")
      if (inbound != null) {
        url.searchParams.delete("playback_source")
        window.history.replaceState(
          window.history.state,
          "",
          `${url.pathname}${url.search}${url.hash}`,
        )
      }
      return inbound === "share" || inbound === "acquisition"
        ? { source: inbound }
        : null
    }
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!SOURCES.has(value.source as NonRecommendationSource)) return null
    if (
      value.sourceRef != null &&
      (typeof value.sourceRef !== "string" ||
        value.sourceRef.length < 1 ||
        value.sourceRef.length > 191)
    ) {
      return null
    }
    return {
      source: value.source as NonRecommendationSource,
      ...(typeof value.sourceRef === "string"
        ? { sourceRef: value.sourceRef }
        : {}),
    }
  } catch {
    return null
  }
}
