"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"

/**
 * How close a card gets before its clip is fetched, and how much of it has
 * to be on screen before it plays.
 *
 * Two separate observers rather than one: fetching has to start BEFORE the
 * card arrives or the first loop is a poster held for a beat, while playing
 * must not start until it is actually being looked at — otherwise five
 * clips run at once in a tall viewport and the section stutters.
 */
const FETCH_MARGIN = "600px 0px"
const PLAY_RATIO = 0.35

/**
 * A card's product shot: the still, with a muted looping screencast layered
 * over it once the reader gets near.
 *
 * The still is not a placeholder that gets swapped out — it stays mounted
 * underneath for the whole life of the card. It carries the alt text (the
 * clip is `aria-hidden` decoration), it is what shows under reduced motion
 * or with JS off, and it is what remains if the clip 404s or the codec is
 * refused, none of which fire a React error boundary.
 */
export function WhatsNewShot({
  shot,
  clip,
  featured,
}: {
  // Structural, not `WHATS_NEW_IMPROVEMENTS[number]["shot"]`: the content
  // array is `as const`, so borrowing its types would pin these props to a
  // union of five exact string literals and reject any other caller.
  shot: { src: string; alt: string }
  clip: { webm: string; mp4: string }
  featured: boolean
}) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // `wanted` gates the <source> tags, so nothing is requested for a card
  // the reader never reaches. `ready` gates the fade, so the clip is only
  // revealed once it can actually paint a frame.
  const [wanted, setWanted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    // Reduced motion is read inside the effect, not at module scope: it is
    // a client-only media query, and reading it during render would make
    // the server and first client pass disagree.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    if (typeof IntersectionObserver === "undefined") return

    const fetcher = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setWanted(true)
        fetcher.disconnect()
      },
      { rootMargin: FETCH_MARGIN },
    )
    fetcher.observe(frame)

    const player = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: PLAY_RATIO },
    )
    player.observe(frame)

    return () => {
      fetcher.disconnect()
      player.disconnect()
    }
  }, [])

  /**
   * Playback is derived from visibility, NOT driven from the observer
   * callback.
   *
   * Both observers cross at nearly the same moment, and the fetch one has
   * the wider margin, so the play callback routinely lands on the render
   * BEFORE the <video> exists. Calling `videoRef.current?.play()` from
   * inside the callback drops that one intersection on the floor — and
   * since the element never leaves the viewport afterwards, no second
   * entry ever arrives and the card sits on its poster for good.
   */
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (visible) {
      // Rejects routinely — an interrupting pause, or a policy that still
      // refuses. There is nothing to do about it but keep the poster, so
      // the rejection is swallowed rather than logged.
      void video.play().catch(() => {})
    } else if (!video.paused) {
      // Guarded because this effect also runs on the render that mounts
      // the clip, which is usually still off screen — an unguarded pause
      // there is a no-op on a never-started element, but it makes "was it
      // ever paused" unanswerable from the outside.
      video.pause()
    }
  }, [visible, wanted])

  return (
    <div
      ref={frameRef}
      data-testid="whats-new-shot-frame"
      className={`relative ${featured ? "aspect-[21/7]" : "aspect-[16/9]"}`}
    >
      {/* The colour around this box is the CELL's gradient showing through
          the cell padding — this element only clips the media and lifts it
          off that colour. */}
      <div className="relative h-full w-full overflow-hidden rounded-xl bg-stone-950 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.75)] ring-1 ring-black/30">
        <Image
          src={shot.src}
          alt={shot.alt}
          width={2880}
          height={1514}
          quality={94}
          sizes={
            featured
              ? "(min-width: 1024px) 76vw, 92vw"
              : "(min-width: 1024px) 38vw, 92vw"
          }
          className="absolute inset-0 h-full w-full object-cover object-top"
        />

        {wanted && (
          <video
            ref={videoRef}
            data-testid="whats-new-shot-clip"
            muted
            loop
            playsInline
            preload="none"
            aria-hidden
            tabIndex={-1}
            onCanPlay={() => setReady(true)}
            className={`absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-500 ${
              ready ? "opacity-100" : "opacity-0"
            }`}
          >
            {/* WebM first: it is the smaller of the pair everywhere it is
                taken, and a browser that cannot decode it falls through to
                the MP4 on its own. */}
            <source src={clip.webm} type="video/webm" />
            <source src={clip.mp4} type="video/mp4" />
          </video>
        )}
      </div>

      {/* The bottom fade that used to sit here is gone on purpose: it faded
          to stone-950 to hide the screenshot's hard crop line against the
          cell, and over a coloured cell that reads as a grey smear. The
          box's own rounded edge finishes the crop now. */}
    </div>
  )
}
