"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import videojs from "video.js"
import type Player from "video.js/dist/types/player"
import "video.js/dist/video-js.css"
import type { FragmentOf } from "@forge/graphql"
import { videoHeroFragment } from "./videoHeroFragment"

export { videoHeroFragment }

type VideoHeroProps = {
  data: FragmentOf<typeof videoHeroFragment>
}

const VIDEO_JS_OPTIONS = {
  autoplay: true,
  controls: false,
  loop: true,
  muted: true,
  fluid: false,
  fill: true,
  responsive: false,
  playsInline: true,
}

function VideoHeroPlayer({
  src,
  onMutedChange,
  onPlayerReady,
}: {
  src: string
  onMutedChange: (muted: boolean) => void
  onPlayerReady: (player: Player) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<Player | null>(null)

  const pauseOnScrollAway = useCallback(() => {
    const scrollY = window.scrollY
    if (playerRef.current) {
      if (scrollY > 100) {
        playerRef.current.pause()
      } else if (scrollY === 0) {
        void playerRef.current.play()
      }
    }
  }, [])

  useEffect(() => {
    window.addEventListener("scroll", pauseOnScrollAway)
    return () => window.removeEventListener("scroll", pauseOnScrollAway)
  }, [pauseOnScrollAway])

  useEffect(() => {
    if (!videoRef.current || !src) return

    const player = videojs(videoRef.current, VIDEO_JS_OPTIONS)
    playerRef.current = player
    onPlayerReady(player)

    player.on("volumechange", () => {
      onMutedChange(player.muted() ?? true)
    })

    void player.src({ type: "application/x-mpegURL", src })

    return () => {
      if (playerRef.current) {
        playerRef.current.dispose()
        playerRef.current = null
      }
    }
  }, [src, onMutedChange, onPlayerReady])

  if (!src) return null

  return (
    <div
      className="fixed top-0 right-0 left-0 z-0 mx-auto h-[85%] max-w-[1919px] bg-stone-950 md:h-[85%]"
      data-testid="VideoHeroPlayer"
    >
      <video
        ref={videoRef}
        className="video-js vjs-big-play-centered"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
        playsInline
      />
    </div>
  )
}

function MuteButton({
  isMuted,
  onClick,
}: {
  isMuted: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isMuted ? "Unmute" : "Mute"}
      className="flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-black/30 text-white transition hover:bg-black/50"
      data-testid="VideoHeroMuteButton"
    >
      {isMuted ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-6 w-6"
          aria-hidden
        >
          <path d="M3.63 3.63a.996.996 0 0 0 0 1.41L7.29 8.7 7 9h2v6H7l.29.29-3.66 3.66a.996.996 0 1 0 1.41 1.41L8.7 15.29 13 19.7v1.41l-4.3-4.3-4.3 4.3-1.41-1.41 3.66-3.66L3.63 5.04a.996.996 0 0 0 0-1.41zM19 12c0 .82-.24 1.58-.65 2.22L20.5 16c.73-1.28 1.17-2.73 1.17-4.22 0-1.49-.44-2.94-1.17-4.22l-2.15 2.15A5.96 5.96 0 0 1 19 12zm-4-6.7v2.47l2.17 2.17L17 12c0-1.1-.23-2.14-.63-3.1L15 4.3zM16.5 12c0 .57-.1 1.13-.28 1.65l1.47 1.47A5.96 5.96 0 0 0 19 12c0-2.28-1.18-4.28-2.97-5.4L14.78 8.2c.18.52.28 1.08.28 1.65zm-3.5-4.3v4.8l2.4 2.4.1-.1V7.7l-2.5 2.5z" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-6 w-6"
          aria-hidden
        >
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
        </svg>
      )}
    </button>
  )
}

export function VideoHero({ data }: VideoHeroProps) {
  const { id, heading, subheading, ctaLabel, ctaLink, streamingUrl } = data

  const [player, setPlayer] = useState<Player | null>(null)
  const [isMuted, setIsMuted] = useState(true)
  const [hasUnmutedOnce, setHasUnmutedOnce] = useState(false)

  const src = streamingUrl ?? null

  const handlePlayerReady = useCallback((p: Player) => {
    setPlayer(p)
  }, [])

  const handleMutedChange = useCallback((muted: boolean) => {
    setIsMuted(muted)
  }, [])

  const handleToggleMute = useCallback(() => {
    if (player) {
      const nextMuted = !isMuted
      player.muted(nextMuted)
      setIsMuted(nextMuted)
      if (!nextMuted && !hasUnmutedOnce) {
        player.currentTime(0)
        void player.play()
        setHasUnmutedOnce(true)
      }
    }
  }, [player, isMuted, hasUnmutedOnce])

  return (
    <section
      id={id ?? undefined}
      className="relative flex h-[90vh] w-full items-end bg-stone-900 font-sans md:h-[70vh]"
      data-testid="VideoHero"
    >
      <VideoHeroPlayer
        src={src ?? ""}
        onMutedChange={handleMutedChange}
        onPlayerReady={handlePlayerReady}
      />

      <div className="relative mx-auto flex w-full max-w-[1920px] flex-col pb-4 sm:flex-row">
        <div
          className="pointer-events-none absolute top-0 right-0 left-0 h-full w-full md:hidden"
          style={{
            backdropFilter: "brightness(.6) blur(40px)",
            mask: "linear-gradient(0deg, rgba(2,0,36,1) 46%, rgba(2,0,36,1) 53%, rgba(0,0,0,0) 100%)",
          }}
        />
        <div className="flex min-h-[500px] w-full items-end pb-4">
          <div className="relative z-[2] flex w-full flex-col pb-4 sm:pb-0">
            <div className="flex w-full items-center justify-between gap-4">
              {heading && (
                <h2 className="flex-grow text-3xl font-bold text-white opacity-90 mix-blend-screen md:text-[3.75rem]">
                  {heading}
                </h2>
              )}
              <MuteButton isMuted={isMuted} onClick={handleToggleMute} />
            </div>
            {subheading && (
              <p
                className="z-[2] mt-1 tracking-widest text-white uppercase opacity-50 mix-blend-screen"
                data-testid="VideoHeroSubheading"
              >
                {subheading}
              </p>
            )}
            {ctaLabel && ctaLink && (
              <a
                href={ctaLink}
                className="mt-4 inline-block w-fit rounded bg-white/20 px-6 py-3 font-medium text-white transition hover:bg-white/30"
                data-testid="VideoHeroCta"
              >
                {ctaLabel}
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
