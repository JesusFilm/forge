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
  const [seedMediaId, setSeedMediaId] = useState("seed-fixture")
  const [audioLanguageSlug, setAudioLanguageSlug] = useState("english")
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
      {surface === "seeded" && (
        <>
          <button
            type="button"
            data-testid="switch-seed"
            onClick={() => setSeedMediaId("seed-fixture-next")}
          >
            Next source
          </button>
          <button
            type="button"
            data-testid="switch-audio"
            onClick={() => setAudioLanguageSlug("spanish")}
          >
            Spanish audio
          </button>
        </>
      )}
      <RecommendationConsentShell />
      {surface === "seeded" ? (
        <WatchSemanticRecommendations
          seedMediaId={seedMediaId}
          locale="en"
          audioLanguageSlug={audioLanguageSlug}
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
