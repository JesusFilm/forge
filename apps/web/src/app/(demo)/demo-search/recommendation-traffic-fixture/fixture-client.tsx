"use client"

import { useEffect, useRef, useState } from "react"
import { RecommendationConsentShell } from "@/components/recommendations/RecommendationConsentShell"
import { WatchSemanticRecommendations } from "@/components/recommendations/WatchSemanticRecommendations"
import { WatchForYouRecommendations } from "@/components/recommendations/WatchForYouRecommendations"
import { RecommendationPlaybackRecorder } from "@/components/recommendations/RecommendationPlaybackRecorder"

/** Synthetic content/player shell; recommendation and claim behavior are real components. */
export function RecommendationTrafficFixture({
  surface,
}: {
  surface: "seeded" | "for-you"
}) {
  const fixture = useRef<HTMLElement>(null)
  const [destination, setDestination] = useState<string | null>(null)
  useEffect(() => {
    if (fixture.current) fixture.current.dataset.hydrated = "true"
  }, [])
  return (
    <main
      ref={fixture}
      data-testid="traffic-fixture"
      data-hydrated="false"
      style={{ paddingTop: 200 }}
    >
      <h1 data-testid="player-shell">Player shell ready</h1>
      <RecommendationConsentShell />
      {surface === "seeded" ? (
        <WatchSemanticRecommendations
          seedMediaId="seed-fixture"
          locale="en"
          audioLanguageSlug="english"
          navigate={setDestination}
        />
      ) : (
        <WatchForYouRecommendations
          locale="en"
          audioLanguageSlug="english"
          navigate={setDestination}
        />
      )}
      {destination && (
        <section data-testid="destination" data-href={destination}>
          Target player shell
          <RecommendationPlaybackRecorder
            player={null}
            initiation={null}
            mediaId="target-0"
          />
        </section>
      )}
    </main>
  )
}
