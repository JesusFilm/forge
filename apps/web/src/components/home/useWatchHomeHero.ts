"use client"

import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react"

import type { MuxPlayerRef } from "@forge/video-player"

import { isWatchHeroObscured } from "@/lib/watch-hero-scroll-cover"
import {
  fitWatchHomeHeroHeight,
  WATCH_HOME_HERO_ASPECT_RATIO,
  WATCH_HOME_HERO_MOBILE_VIEWPORT_RATIO,
  WATCH_HOME_HERO_RESERVE_BELOW_MOBILE_PX,
  WATCH_HOME_HERO_RESERVE_BELOW_PX,
} from "@/lib/watch-home-hero-fit"

const WATCH_HOME_HERO_DESKTOP_QUERY = "(min-width: 768px)"
const CATEGORY_RAIL_SELECTOR = '[data-testid="watch-home-category-rail"]'
const BODY_ZONE_SELECTOR = '[data-testid="watch-home-body-zone"]'

/**
 * Keeps the muted intro short enough for the categories rail below it to be
 * fully visible. The rail's height is measured rather than assumed: it is 488px
 * on a narrow phone against 413-425px on desktop, and localized copy moves it
 * again, so a fixed CSS reserve is wrong somewhere. The reserve constants are
 * still what the class produces before hydration and when no rail is present,
 * so this only ever refines a height that is already close.
 *
 * What must fit is the whole span from the top of the body zone down to the
 * rail's bottom edge, not the rail's own height: an editor can author another
 * block between the two, and reserving only the rail's height would shrink the
 * intro for nothing while still pushing the rail past the fold.
 *
 * Returns null when disabled — an unmuted intro, or an unpinned one, takes its
 * full height, the way a watch page's hero drops its overlap once chrome is
 * revealed.
 */
export function useWatchHomeHeroFittedHeight(enabled: boolean): number | null {
  const [fittedHeight, setFittedHeight] = useState<number | null>(null)

  useEffect(() => {
    // No setState here for the disabled case: the stale value is simply not
    // returned below, and re-enabling re-runs this effect and re-measures.
    if (!enabled) return

    let rafHandle = 0
    let observed: Element | null = null
    let retryHandle = 0

    const measure = () => {
      rafHandle = 0
      const viewportHeight = window.innerHeight
      const isDesktop = window.matchMedia(WATCH_HOME_HERO_DESKTOP_QUERY).matches
      const aspectHeight = isDesktop
        ? Math.min(
            viewportHeight,
            window.innerWidth * WATCH_HOME_HERO_ASPECT_RATIO,
          )
        : viewportHeight * WATCH_HOME_HERO_MOBILE_VIEWPORT_RATIO
      const rail = document.querySelector(
        CATEGORY_RAIL_SELECTOR,
      ) as HTMLElement | null
      const bodyZone = document.querySelector(
        BODY_ZONE_SELECTOR,
      ) as HTMLElement | null
      const reservedBelow =
        rail && bodyZone
          ? Math.max(
              0,
              rail.getBoundingClientRect().bottom -
                bodyZone.getBoundingClientRect().top,
            )
          : isDesktop
            ? WATCH_HOME_HERO_RESERVE_BELOW_PX
            : WATCH_HOME_HERO_RESERVE_BELOW_MOBILE_PX
      setFittedHeight(
        fitWatchHomeHeroHeight({ viewportHeight, aspectHeight, reservedBelow }),
      )
      // The rail can mount after this first pass, and its height changes with
      // width; observe whichever element is there now. Until it appears, keep
      // re-checking on animation frames — nothing else would re-trigger the
      // measurement before the next window resize.
      if (rail && rail !== observed) {
        observer?.disconnect()
        observed = rail
        observer?.observe(rail)
        if (bodyZone) observer?.observe(bodyZone)
      }
      if (!rail && retryHandle === 0) {
        retryHandle = window.requestAnimationFrame(() => {
          retryHandle = 0
          schedule()
        })
      }
    }

    const schedule = () => {
      if (rafHandle !== 0) return
      rafHandle = window.requestAnimationFrame(measure)
    }

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule)

    // Scheduled rather than called: a synchronous setState in an effect body
    // cascades a render (and the lint rule that guards against it).
    schedule()
    window.addEventListener("resize", schedule, { passive: true })
    return () => {
      window.removeEventListener("resize", schedule)
      observer?.disconnect()
      if (rafHandle !== 0) window.cancelAnimationFrame(rafHandle)
      if (retryHandle !== 0) window.cancelAnimationFrame(retryHandle)
    }
  }, [enabled])

  return enabled ? fittedHeight : null
}

/**
 * Pauses the pinned intro once the body has slid over most of it, and resumes
 * on the way back up — the same rule (and threshold) `HeroPlayer` applies to a
 * watch page's hero. `IntersectionObserver` cannot do this: a sticky element
 * reports "in viewport" the whole time it is painted over.
 *
 * `heroRef` must be the SIZED frame, never the media layer: while muted the
 * media reaches below the frame on purpose, and measuring that taller box would
 * put the 60% crossover somewhere other than where the viewer sees it.
 */
export function useWatchHomeHeroScrollPause({
  enabled,
  fittedHeight,
  heroRef,
  player,
  videoRef,
}: {
  /** False for an unpinned intro: nothing covers it, so nothing should pause. */
  enabled: boolean
  /** Re-evaluates when the fitted height commits and moves the body. */
  fittedHeight: number | null
  heroRef: RefObject<HTMLDivElement | null>
  player: MuxPlayerRef | null
  videoRef: MutableRefObject<HTMLVideoElement | null>
}) {
  // Hook-lifetime, not effect-local: this effect re-runs whenever the slide or
  // the fitted height changes, and a scroll-pause must survive that or the
  // video never resumes on the way back up.
  const pausedByScrollRef = useRef(false)

  useEffect(() => {
    if (!enabled) return

    // Setup restores what cleanup leaves behind. The ref above outlives a
    // StrictMode remount, and a stale `true` would auto-resume a video the
    // user never had running — so re-arm it only from a state this effect can
    // still observe: a video that is not currently paused cannot be one we
    // paused.
    const video = videoRef.current
    if (video && !video.paused) pausedByScrollRef.current = false
    let rafHandle = 0
    let previouslyCovered: boolean | null = null
    let listeningTo: HTMLVideoElement | null = null

    const evaluate = () => {
      rafHandle = 0
      const hero = heroRef.current
      const video = videoRef.current
      if (!hero || !video) return

      // The carousel swaps in a fresh <video> on every slide, and starts it a
      // beat later. Follow whichever element is current so its own `play` can
      // re-open this check — otherwise a slide that arrives while covered
      // starts playing behind the body and nothing ever looks again.
      if (video !== listeningTo) {
        listeningTo?.removeEventListener("play", schedule)
        video.addEventListener("play", schedule)
        listeningTo = video
      }

      const heroRect = hero.getBoundingClientRect()
      const bodyZone = document.querySelector(
        BODY_ZONE_SELECTOR,
      ) as HTMLElement | null
      const bodyTop = bodyZone
        ? bodyZone.getBoundingClientRect().top
        : heroRect.bottom
      const covered = isWatchHeroObscured({
        heroHeight: heroRect.height,
        viewportHeight: window.innerHeight,
        bodyTopFromHeroTop: bodyTop - heroRect.top,
      })

      if (covered) {
        // Re-check on every pass, not only on the uncovered -> covered edge: a
        // newly attached slide can start playing while `covered` never changed.
        if (video.paused) {
          previouslyCovered = covered
          return
        }
        pausedByScrollRef.current = true
        video.pause()
        previouslyCovered = covered
        return
      }

      if (covered === previouslyCovered) return
      previouslyCovered = covered
      if (!pausedByScrollRef.current) return
      pausedByScrollRef.current = false
      if (!video.paused) return
      const played = video.play()
      // Autoplay can still be refused on resume; the mute/next controls remain
      // the explicit path back.
      if (played && typeof played.then === "function") {
        played.catch(() => undefined)
      }
    }

    const schedule = () => {
      if (rafHandle !== 0) return
      rafHandle = window.requestAnimationFrame(evaluate)
    }

    // Runs on `player` and `fittedHeight` too: each slide mounts a fresh
    // <video>, and a committed height moves the body across the boundary with
    // no scroll event of its own.
    evaluate()
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule, { passive: true })
    return () => {
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      listeningTo?.removeEventListener("play", schedule)
      if (rafHandle !== 0) window.cancelAnimationFrame(rafHandle)
    }
  }, [enabled, fittedHeight, heroRef, player, videoRef])
}
