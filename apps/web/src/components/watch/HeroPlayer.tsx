"use client"

import { useCallback, useRef, useState, useSyncExternalStore } from "react"
import { useSearchParams } from "next/navigation"
import { MuxPlayer, type MuxPlayerRef } from "@forge/video-player"
import type { MuxCSSProperties } from "@mux/mux-player-react"

import { env } from "@/env"
import type { WatchHeroPlayerBlock } from "@/lib/content"
import { getViewerId } from "@/lib/viewer-id"

type PillState = "play-with-sound" | "tap-to-unmute"

function subscribeViewerId(_onStoreChange: () => void): () => void {
  return () => {}
}

// "" matches SSR HTML; useSyncExternalStore swaps in the real UUID on the
// client. Mux Data treats "" as "no viewer attribution".
function getViewerIdServerSnapshot(): string {
  return ""
}

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
  const playerRef = useRef<MuxPlayerRef | null>(null)
  const setPlayerRef = useCallback(
    (player: MuxPlayerRef | null) => {
      playerRef.current = player
      onPlayerReady?.(player)
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
      player.muted = false
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

  const playerStyle = chromeRevealed ? undefined : CHROME_HIDE_STYLE
  const loop = !chromeRevealed
  const muted = !chromeRevealed

  return (
    <div
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
        style={playerStyle}
        onLoadedMetadata={handleLoadedMetadata}
        onError={handlePlayerError}
        className="block h-full w-full"
      />

      {!chromeRevealed && (
        <button
          type="button"
          data-testid="hero-player-unmute-pill"
          data-state={pillState}
          onClick={handleUnmuteClick}
          className={
            pillState === "tap-to-unmute"
              ? "absolute bottom-6 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-500 px-5 py-3 text-sm font-semibold text-stone-950 shadow-lg ring-2 ring-amber-300/60 transition hover:bg-amber-400"
              : "absolute bottom-6 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/95 px-5 py-3 text-sm font-semibold text-stone-900 shadow-lg transition hover:bg-white"
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
      )}
    </div>
  )
}

function UnmutedSpeakerIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  )
}

function MutedSpeakerIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  )
}
