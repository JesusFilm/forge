"use client"

import { useCallback, useRef, useState, useSyncExternalStore } from "react"
import { useSearchParams } from "next/navigation"
import { MuxPlayer, type MuxPlayerRef } from "@forge/video-player"
import type { MuxCSSProperties } from "@mux/mux-player-react"

import { env } from "@/env"
import type { WatchHeroPlayerBlock } from "@/lib/content"
import { getViewerId } from "@/lib/viewer-id"
import { HeroPlayerControls } from "./HeroPlayerControls"
import { MutedSpeakerIcon, UnmutedSpeakerIcon } from "./chrome-icons"

type PillState = "play-with-sound" | "tap-to-unmute"

function subscribeViewerId(_onStoreChange: () => void): () => void {
  return () => {}
}

// "" matches SSR HTML; useSyncExternalStore swaps in the real UUID on the
// client. Mux Data treats "" as "no viewer attribution".
function getViewerIdServerSnapshot(): string {
  return ""
}

// Mux Player's chrome stays hidden at all times — we render our own
// React-based chrome via <HeroPlayerControls />.
// CSS Custom Properties: https://github.com/muxinc/elements/blob/main/packages/mux-player/REFERENCE.md
const CHROME_HIDE_STYLE: MuxCSSProperties = {
  "--controls": "none",
  "--top-controls": "none",
  "--center-controls": "none",
  "--bottom-controls": "none",
}

export function HeroPlayer({
  block,
  onPlayerReady,
}: {
  block: WatchHeroPlayerBlock
  onPlayerReady?: (player: MuxPlayerRef | null) => void
}) {
  const { video, variant } = block
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<MuxPlayerRef | null>(null)
  const [player, setPlayer] = useState<MuxPlayerRef | null>(null)
  const setPlayerRef = useCallback(
    (next: MuxPlayerRef | null) => {
      playerRef.current = next
      setPlayer(next)
      onPlayerReady?.(next)
    },
    [onPlayerReady],
  )

  const [chromeRevealed, setChromeRevealed] = useState(false)
  const [pillState, setPillState] = useState<PillState>("play-with-sound")
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)

  const viewerUserId = useSyncExternalStore(
    subscribeViewerId,
    getViewerId,
    getViewerIdServerSnapshot,
  )

  const searchParams = useSearchParams()
  const tParam = searchParams?.get("t")
  const handleLoadedMetadata = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    if (tParam == null) return
    const parsed = Number.parseFloat(tParam)
    if (!Number.isFinite(parsed) || parsed < 0) return
    const duration = Number.isFinite(player.duration) ? player.duration : 0
    const safeDuration = duration > 1 ? duration - 1 : duration
    player.currentTime =
      safeDuration > 0 ? Math.min(parsed, safeDuration) : parsed
  }, [tParam])

  // iOS user-activation gate: NO `await` between click and play(), or
  // play() will be rejected as not-from-user-gesture.
  const handleUnmuteClick = useCallback(() => {
    const player = playerRef.current
    if (!player) return

    if (pillState === "tap-to-unmute") {
      // Autoplay was blocked — this gesture both unmutes AND starts playback
      // since the user is now committed. Without play() the user just
      // unmuted a still-paused video.
      player.muted = false
      const tapResult = player.play()
      if (tapResult && typeof tapResult.then === "function") {
        tapResult.catch((err: unknown) => {
          console.warn("[HeroPlayer] tap-to-unmute play() rejected", err)
        })
      }
      setChromeRevealed(true)
      return
    }

    player.muted = false
    player.currentTime = 0
    const result = player.play()
    if (result && typeof result.then === "function") {
      result
        .then(() => {
          setChromeRevealed(true)
          setAutoplayBlocked(false)
        })
        .catch(() => {
          setPillState("tap-to-unmute")
        })
    } else {
      setChromeRevealed(true)
    }
  }, [pillState])

  const handlePlayerError = useCallback((event: CustomEvent) => {
    const code = (event?.detail as { code?: string } | undefined)?.code
    if (code === "autoplay-blocked") {
      setAutoplayBlocked(true)
    }
  }, [])

  const playbackId = variant.muxVideo?.playbackId ?? undefined
  const hlsSrc = variant.hls ?? undefined

  const loop = !chromeRevealed
  const muted = !chromeRevealed

  return (
    <div
      ref={wrapperRef}
      data-block-type="HeroPlayer"
      data-testid="hero-player-wrapper"
      data-chrome-revealed={chromeRevealed ? "true" : "false"}
      data-autoplay-blocked={autoplayBlocked ? "true" : "false"}
      className="relative w-full overflow-hidden bg-black"
    >
      <MuxPlayer
        ref={setPlayerRef}
        playbackId={playbackId}
        src={playbackId ? undefined : hlsSrc}
        autoPlay="muted"
        muted={muted}
        loop={loop}
        envKey={env.NEXT_PUBLIC_MUX_DATA_ENV_KEY}
        disableCookies={true}
        metadata={{
          player_name: "forge-web-watch",
          video_title: video.title ?? undefined,
          video_id: video.documentId,
          viewer_user_id: viewerUserId,
        }}
        style={CHROME_HIDE_STYLE}
        onLoadedMetadata={handleLoadedMetadata}
        onError={handlePlayerError}
        className="block h-full w-full"
      />

      {chromeRevealed ? (
        <HeroPlayerControls
          player={player}
          playerRef={playerRef}
          wrapperRef={wrapperRef}
        />
      ) : (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/40 to-transparent"
          />
          <div
            data-testid="hero-player-overlay"
            className="absolute right-6 bottom-6 left-10 flex flex-col items-start gap-4 md:right-auto md:left-16 xl:left-24"
          >
            {video.label ? (
              <span
                data-testid="hero-player-overlay-label"
                className="text-sm font-semibold tracking-wider text-amber-400 uppercase md:text-base"
              >
                {video.label}
              </span>
            ) : null}
            {video.title ? (
              <h1
                data-testid="hero-player-overlay-title"
                className="text-4xl font-bold text-white drop-shadow-lg whitespace-nowrap md:text-6xl xl:text-7xl"
              >
                {video.title}
              </h1>
            ) : null}
            <button
              type="button"
              data-testid="hero-player-unmute-pill"
              data-state={pillState}
              onClick={handleUnmuteClick}
              className={
                pillState === "tap-to-unmute"
                  ? "inline-flex items-center gap-3 rounded-full bg-amber-500 px-7 py-2.5 text-base font-semibold text-stone-950 shadow-lg ring-2 ring-amber-300/60 transition hover:bg-amber-400 md:px-8 md:py-3 md:text-lg"
                  : "inline-flex items-center gap-3 rounded-full bg-red-600 px-7 py-2.5 text-base font-semibold text-white shadow-lg transition hover:bg-red-500 md:px-8 md:py-3 md:text-lg"
              }
            >
              {pillState === "tap-to-unmute" ? (
                <MutedSpeakerIcon />
              ) : (
                <UnmutedSpeakerIcon />
              )}
              <span>
                {pillState === "tap-to-unmute"
                  ? "Tap to Unmute"
                  : "Play with Sound"}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
