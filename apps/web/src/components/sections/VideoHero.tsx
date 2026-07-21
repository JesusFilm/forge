"use client"

import { useCallback, useEffect, useState } from "react"
import MuxVideo from "@forge/video-player/mux-video"
import { useWatchModalMediaRef } from "@/components/watch/WatchModalActivityProvider"
import { useTranslations } from "next-intl"
import type { FragmentOf } from "@/lib/legacy-fragment-types"
import type { RouteVideo } from "@/lib/content"
import {
  CONTENT_WIDTH_ALIGN_CLASSES,
  CONTENT_WIDTH_CLASSES,
} from "@/lib/content-width"
import { videoHeroFragment } from "@/lib/fragments/video-hero"

export { videoHeroFragment }

type VideoHeroProps = {
  data: FragmentOf<typeof videoHeroFragment>
  routeVideo?: RouteVideo | null
}

function MuxBackedVideoHeroPlayer({
  src,
  isMuted,
  onMutedChange,
  video,
  videoRef,
  setVideoRef,
}: {
  src: string
  isMuted: boolean
  onMutedChange: (muted: boolean) => void
  video: HTMLVideoElement | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  setVideoRef: (next: HTMLVideoElement | null | undefined) => void
}) {
  const pauseOnScrollAway = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const scrollY = window.scrollY
    if (scrollY > 100) {
      video.pause()
    } else if (scrollY < 50) {
      void video.play()
    }
  }, [videoRef])

  useEffect(() => {
    window.addEventListener("scroll", pauseOnScrollAway)
    return () => window.removeEventListener("scroll", pauseOnScrollAway)
  }, [pauseOnScrollAway])

  // Mirror `volumechange` from the underlying media element to the parent
  // mute-state (matches the videojs path's `player.on('volumechange', …)`).
  useEffect(() => {
    if (!video) return
    const handler = () => onMutedChange(video.muted)
    video.addEventListener("volumechange", handler)
    return () => video.removeEventListener("volumechange", handler)
  }, [onMutedChange, video])

  if (!src) return null

  return (
    <div
      className={`fixed top-0 right-0 left-0 z-0 h-[85%] bg-stone-950 md:h-[85%] ${CONTENT_WIDTH_ALIGN_CLASSES}`}
      data-testid="VideoHeroPlayer"
    >
      <MuxVideo
        ref={setVideoRef}
        src={src}
        autoPlay
        loop
        muted={isMuted}
        playsInline
        // Hero is excluded from full Mux Data v1 (cost control). Default
        // applied in MuxVideo wrapper; restated here for clarity at the call
        // site.
        disableTracking
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
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
  const t = useTranslations("HeroPlayerControls")

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isMuted ? t("unmute") : t("mute")}
      className="flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-black/30 text-white transition hover:bg-black/50"
      data-testid="VideoHeroMuteButton"
    >
      {isMuted ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6"
          aria-hidden
        >
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
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

function MuxBackedVideoHero({
  id,
  src,
  resolvedHeading,
  resolvedSubheading,
  ctaLabel,
  ctaLink,
}: {
  id: string | null | undefined
  src: string | null
  resolvedHeading: string | null
  resolvedSubheading: string | null
  ctaLabel: string | null | undefined
  ctaLink: string | null | undefined
}) {
  const {
    media: video,
    mediaRef: videoRef,
    setMediaRef: setVideoRef,
  } = useWatchModalMediaRef<HTMLVideoElement>(src)
  const [isMuted, setIsMuted] = useState(true)
  const [hasUnmutedOnce, setHasUnmutedOnce] = useState(false)
  const handleMutedChange = useCallback((muted: boolean) => {
    setIsMuted(muted)
  }, [])

  const handleToggleMute = useCallback(() => {
    // U1 finding: MuxVideo ref resolves to HTMLVideoElement | undefined.
    // Null-guard before assignment / method call.
    const video = videoRef.current
    if (!video) return
    const nextMuted = !isMuted
    video.muted = nextMuted
    setIsMuted(nextMuted)
    if (!nextMuted && !hasUnmutedOnce) {
      video.currentTime = 0
      void video.play()
      setHasUnmutedOnce(true)
    }
  }, [hasUnmutedOnce, isMuted, videoRef])

  return (
    <section
      id={id ?? undefined}
      className="relative flex h-screen w-full items-end bg-stone-900 font-sans md:h-[70vh]"
      data-testid="VideoHero"
    >
      <MuxBackedVideoHeroPlayer
        src={src ?? ""}
        isMuted={isMuted}
        onMutedChange={handleMutedChange}
        video={video}
        videoRef={videoRef}
        setVideoRef={setVideoRef}
      />

      <VideoHeroOverlay
        resolvedHeading={resolvedHeading}
        resolvedSubheading={resolvedSubheading}
        ctaLabel={ctaLabel}
        ctaLink={ctaLink}
        isMuted={isMuted}
        onToggleMute={handleToggleMute}
      />
    </section>
  )
}

function VideoHeroOverlay({
  resolvedHeading,
  resolvedSubheading,
  ctaLabel,
  ctaLink,
  isMuted,
  onToggleMute,
}: {
  resolvedHeading: string | null
  resolvedSubheading: string | null
  ctaLabel: string | null | undefined
  ctaLink: string | null | undefined
  isMuted: boolean
  onToggleMute: () => void
}) {
  return (
    <div
      className={`relative flex flex-col pb-4 sm:flex-row ${CONTENT_WIDTH_CLASSES}`}
    >
      <div
        className="pointer-events-none absolute top-0 right-0 left-0 h-full w-full md:hidden"
        style={{
          backdropFilter: "brightness(.6) blur(40px)",
          mask: "linear-gradient(0deg, rgba(2,0,36,1) 46%, rgba(2,0,36,1) 53%, rgba(0,0,0,0) 100%)",
        }}
      />
      <div className="flex min-h-[500px] w-full items-end pb-4">
        <div className="relative z-2 flex w-full flex-col pb-4 sm:pb-0">
          <div className="flex w-full items-center justify-between gap-4">
            {resolvedHeading && (
              <h2 className="grow text-3xl font-bold text-white opacity-90 mix-blend-screen md:text-[3.75rem]">
                {resolvedHeading}
              </h2>
            )}
            <MuteButton isMuted={isMuted} onClick={onToggleMute} />
          </div>
          {resolvedSubheading && (
            <p
              className="z-2 mt-1 tracking-widest text-white uppercase opacity-50 mix-blend-screen"
              data-testid="VideoHeroSubheading"
            >
              {resolvedSubheading}
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
  )
}

export function VideoHero({ data, routeVideo }: VideoHeroProps) {
  const {
    id,
    heading,
    subheading,
    ctaLabel,
    ctaLink,
    streamingUrl,
    useRouteVideo,
  } = data

  const src =
    useRouteVideo === true
      ? (routeVideo?.streamingUrl ?? null)
      : (streamingUrl ?? null)
  const resolvedHeading =
    heading ?? (useRouteVideo === true ? (routeVideo?.title ?? null) : null)
  const resolvedSubheading =
    subheading ??
    (useRouteVideo === true
      ? (routeVideo?.snippet ?? routeVideo?.description ?? null)
      : null)

  return (
    <MuxBackedVideoHero
      id={id}
      src={src}
      resolvedHeading={resolvedHeading}
      resolvedSubheading={resolvedSubheading}
      ctaLabel={ctaLabel}
      ctaLink={ctaLink}
    />
  )
}
