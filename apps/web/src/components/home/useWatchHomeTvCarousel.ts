"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
  addWatchHomeTvPlayedId,
  addWatchHomeVerticalVideoId,
  boundedRandomIndex,
  buildWatchHomeVideoQueue,
  markWatchHomeVideoPlayed,
  isWatchHomeHeroPlayableAspect,
  pickRandomWatchHomeHeroVideo,
  readWatchHomeTvPlayedIds,
  readWatchHomeVerticalVideoIds,
  resetWatchHomeTvPlayedIds,
  saveWatchHomeCurrentVideoSession,
  type WatchHomeCarouselSequenceData,
  type WatchHomeTvCarouselSlide,
  type WatchHomeTvCarouselVideoSlide,
} from "@/lib/watch-home-carousel-sequence"

export {
  WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
  addWatchHomeTvPlayedId,
  readWatchHomeTvPlayedIds,
  resetWatchHomeTvPlayedIds,
}
export type { WatchHomeCarouselSequenceData, WatchHomeTvCarouselSlide }

export const WATCH_HOME_TV_IMAGE_SLIDE_ADVANCE_SECONDS = 7
const IMAGE_SLIDE_ADVANCE_MS = WATCH_HOME_TV_IMAGE_SLIDE_ADVANCE_SECONDS * 1000
const VIDEO_POSTER_HOLD_MS = 1500

/**
 * How far past a video's own length the backstop timer sits. Made of the
 * 1500 ms poster hold the advance clock already includes, plus roughly 3.5 s
 * of allowance for rebuffering that never fired `waiting`. The real `ended`
 * event is the advance trigger; this only has to lose the race to it.
 */
export const WATCH_HOME_TV_ENDED_BACKSTOP_GRACE_SECONDS = 5

/**
 * The turn length for a slide whose duration cannot be read from either the
 * media element or the catalog record. Far enough above the retired 30-second
 * preview cap that an unmeasurable slide is not silently re-capped, and far
 * enough below a feature film that a stream nobody can measure cannot hold
 * the hero for a film's length.
 */
export const WATCH_HOME_TV_UNKNOWN_DURATION_SECONDS = 120
/**
 * How long the hero waits on a stream before giving the turn to the next
 * slide. The advance clock runs only while there is something to watch (see
 * `isBuffering`), so without this ceiling a video whose bytes never arrive
 * would hold the hero behind a loading indicator forever.
 */
export const WATCH_HOME_TV_MEDIA_WAIT_TIMEOUT_MS = 12_000
export const WATCH_HOME_TV_TIMELINE_FUTURE_COUNT = 3

function subscribeToHydrationStore() {
  return () => undefined
}

function getClientHydrationSnapshot() {
  return true
}

function getServerHydrationSnapshot() {
  return false
}

export function nextWatchHomeTvCarouselIndex(
  currentIndex: number,
  slideCount: number,
) {
  if (slideCount <= 0) return 0
  return (currentIndex + 1) % slideCount
}

function usableSeconds(value: number | null | undefined): number | null {
  if (typeof value !== "number") return null
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

/**
 * How long this slide's turn lasts, and what the progress ring animates over.
 *
 * The media element's own `duration` wins when it is readable, because it is
 * the only value that matches what is actually playing; the catalog record is
 * the pre-metadata estimate behind it. Every candidate is screened for a
 * finite positive value: a `NaN` before metadata, the `Infinity` of an
 * unbounded manifest, or a `null` record would otherwise reach a `setTimeout`
 * delay (where both coerce to 0) and the ring's CSS custom property (where
 * `NaNs` silently invalidates the animation).
 */
export function watchHomeTvSlideDurationSeconds(
  slide: Pick<WatchHomeTvCarouselSlide, "src" | "durationSeconds">,
  measuredSeconds: number | null | undefined,
): number {
  if (!slide.src) return WATCH_HOME_TV_IMAGE_SLIDE_ADVANCE_SECONDS
  return (
    usableSeconds(measuredSeconds) ??
    usableSeconds(slide.durationSeconds) ??
    WATCH_HOME_TV_UNKNOWN_DURATION_SECONDS
  )
}

/**
 * When the backstop timer fires. A video slide gets the grace on top so the
 * media's own `ended` event wins in normal playback; an image slide takes no
 * grace, because for it the timer IS the mechanism rather than a backstop.
 */
export function watchHomeTvAdvanceBackstopSeconds(
  slide: Pick<WatchHomeTvCarouselSlide, "src" | "durationSeconds">,
  measuredSeconds: number | null | undefined,
): number {
  const durationSeconds = watchHomeTvSlideDurationSeconds(
    slide,
    measuredSeconds,
  )
  if (!slide.src) return durationSeconds
  return durationSeconds + WATCH_HOME_TV_ENDED_BACKSTOP_GRACE_SECONDS
}

/**
 * `<mux-video>` is a custom element wrapping a real `<video>`; depending on the
 * build it either forwards the media properties or only exposes them on the
 * inner element, so both are checked before giving up.
 */
export function readMediaVideoSize(
  media: HTMLVideoElement | null,
): { width: number; height: number } | null {
  if (!media) return null

  const host = media as unknown as HTMLElement
  const inner =
    (host.shadowRoot
      ?.querySelector("mux-video")
      ?.shadowRoot?.querySelector("video") as HTMLVideoElement | null) ??
    (host.shadowRoot?.querySelector("video") as HTMLVideoElement | null) ??
    null

  for (const candidate of [media, inner]) {
    const width = candidate?.videoWidth ?? 0
    const height = candidate?.videoHeight ?? 0
    if (width > 0 && height > 0) return { width, height }
  }

  return null
}

function firstPlayableIndex(slides: readonly WatchHomeTvCarouselSlide[]) {
  const index = slides.findIndex((slide) => Boolean(slide.src))
  return index >= 0 ? index : 0
}

function playableSlideIndexes(slides: readonly WatchHomeTvCarouselSlide[]) {
  const indexes = slides
    .map((slide, index) => (slide.src ? index : -1))
    .filter((index) => index >= 0)

  return indexes.length > 0 ? indexes : slides.map((_, index) => index)
}

export function firstUnplayedWatchHomeTvCarouselIndex(
  slides: readonly WatchHomeTvCarouselSlide[],
) {
  if (slides.length === 0) return 0

  const played = new Set(readWatchHomeTvPlayedIds())
  const candidateIndexes = playableSlideIndexes(slides)
  const unplayedIndex = candidateIndexes.find(
    (index) => !played.has(slides[index].id),
  )

  if (unplayedIndex != null) return unplayedIndex

  resetWatchHomeTvPlayedIds()
  return candidateIndexes[0] ?? 0
}

export function nextUnplayedWatchHomeTvCarouselIndex(
  currentIndex: number,
  slides: readonly WatchHomeTvCarouselSlide[],
) {
  if (slides.length <= 0) return 0

  const candidateIndexes = playableSlideIndexes(slides)
  const candidateSet = new Set(candidateIndexes)
  const played = new Set(readWatchHomeTvPlayedIds())

  for (let offset = 1; offset <= slides.length; offset++) {
    const index = (currentIndex + offset) % slides.length
    if (!candidateSet.has(index)) continue
    if (!played.has(slides[index].id)) return index
  }

  resetWatchHomeTvPlayedIds()

  for (let offset = 1; offset <= slides.length; offset++) {
    const index = (currentIndex + offset) % slides.length
    if (candidateSet.has(index)) return index
  }

  return nextWatchHomeTvCarouselIndex(currentIndex, slides.length)
}

export function useWatchHomeTvCarousel(
  slides: readonly WatchHomeTvCarouselSlide[],
  sequence: WatchHomeCarouselSequenceData | null = null,
  options: {
    autoAdvancePausedForSlideId?: string | null
    randomSource?: () => number
    suppressLeavingSlide?: boolean
  } = {},
) {
  const hasHydrated = useSyncExternalStore(
    subscribeToHydrationStore,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  )
  const [prefetchedQueue, setPrefetchedQueue] = useState<{
    sequenceKey: string
    videos: WatchHomeTvCarouselVideoSlide[]
    nextPoolIndex: number
  } | null>(null)
  const [portraitSlideIds, setPortraitSlideIds] = useState<readonly string[]>(
    [],
  )
  const [isMuted, setIsMuted] = useState(true)
  const [progress, setProgress] = useState(0)
  const [playbackTime, setPlaybackTime] = useState<{
    seconds: number
    slideId: string | null
  }>({ seconds: 0, slideId: null })
  const [leavingSlide, setLeavingSlide] =
    useState<WatchHomeTvCarouselSlide | null>(null)
  const [mediaReady, setMediaReady] = useState(false)
  // Bumped when the backstop declines to advance because the media clock still
  // shows time remaining; re-running the effect is how it re-arms.
  const [backstopReArmCount, setBackstopReArmCount] = useState(0)
  // Folded into the ring's animation key so a same-slide restart replays the
  // CSS animation instead of leaving it parked at 100%. State, not a ref: the
  // key has to change during a render for the animation to restart.
  const [restartCount, setRestartCount] = useState(0)
  // The media element's own duration, keyed to the slide it was read from so a
  // stale measurement can never leak into the next slide's turn.
  const [measuredDuration, setMeasuredDuration] = useState<{
    slideId: string | null
    seconds: number | null
  }>({ slideId: null, seconds: null })
  // Waiting on bytes: true from the moment a video slide is chosen until it can
  // play, and again whenever playback stalls. Starts true because the opening
  // slide has not loaded anything yet either.
  const [isBufferingMedia, setIsBufferingMedia] = useState(true)
  // Deliberately paused: scroll-pause covering the hero, a Watch modal taking
  // ownership, or the browser pausing a hidden tab. Driven by the `pause`
  // EVENT rather than `video.paused`, because the element is already paused at
  // mount and emits no event there -- which is what keeps the 1500 ms poster
  // hold behaving exactly as it does today.
  const [isMediaPaused, setIsMediaPaused] = useState(false)
  const isMutedRef = useRef(isMuted)
  const leavingSlideTimeoutRef = useRef<number | null>(null)
  const slideAdvanceTimeoutRef = useRef<number | null>(null)
  const videoPosterHoldIntervalRef = useRef<number | null>(null)
  const videoPosterHoldTimeoutRef = useRef<number | null>(null)
  const mediaWaitTimeoutRef = useRef<number | null>(null)
  // The advance clock is parked while buffering, so the elapsed time has to
  // survive the re-runs that park and restart it.
  const advanceClockRef = useRef<{ slideId: string | null; elapsedMs: number }>(
    {
      slideId: null,
      elapsedMs: 0,
    },
  )
  const previousProgressRef = useRef(0)
  // Monotonic per-turn token. A slide id is not enough: a single-playable-slide
  // queue restarts the SAME id, so two consecutive turns would be
  // indistinguishable and a stale timer from the first could advance the
  // second.
  const turnTokenRef = useRef(0)
  // The media position the backstop last saw. Re-arming requires the media
  // clock to have MOVED since then, so a wedged stream that never emits
  // `waiting` still loses its turn instead of re-arming forever.
  const backstopSeenTimeRef = useRef(0)
  const imageSlideStartedAtRef = useRef<number | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const isSequenced = sequence != null
  const sequenceKey = useMemo(
    () =>
      sequence
        ? sequence.pools
            .map(
              (pool) =>
                `${pool.id}:${pool.videos.map((video) => video.id).join(",")}`,
            )
            .join("|")
        : "fallback",
    [sequence],
  )
  const initialQueue = useMemo(() => {
    if (!isSequenced || !sequence) {
      return { videos: [], nextPoolIndex: 0 }
    }

    return buildWatchHomeVideoQueue({
      pools: sequence.pools,
      startPoolIndex: 0,
      targetVideoCount: 7,
      useStoredProgress: false,
    })
  }, [isSequenced, sequence])
  const activePrefetchedQueue =
    prefetchedQueue?.sequenceKey === sequenceKey ? prefetchedQueue : null
  const videoQueue = activePrefetchedQueue?.videos ?? initialQueue.videos
  const nextPoolIndex =
    activePrefetchedQueue?.nextPoolIndex ?? initialQueue.nextPoolIndex

  const sequencedSlides = useMemo(() => {
    if (!isSequenced || !sequence) return null
    if (videoQueue.length === 0) return null
    if (portraitSlideIds.length === 0) return videoQueue
    const portrait = new Set(portraitSlideIds)
    const landscape = videoQueue.filter((slide) => !portrait.has(slide.id))
    // Never empty the hero: if every queued video measured portrait, keep the
    // queue and let the bounded skip counter stop the churn.
    return landscape.length > 0 ? landscape : videoQueue
  }, [isSequenced, portraitSlideIds, sequence, videoQueue])

  const displaySlides = sequencedSlides ?? slides

  // Server render and the first client render must agree, so the sequenced
  // hero opens on the deterministic queue's first playable slide. The random
  // per-visit draw lands right after mount, once hydration can no longer break.
  const defaultActiveIndex = isSequenced
    ? firstPlayableIndex(displaySlides)
    : hasHydrated
      ? firstUnplayedWatchHomeTvCarouselIndex(displaySlides)
      : firstPlayableIndex(displaySlides)
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null)

  const selectedActiveSlide =
    activeSlideId != null
      ? displaySlides.find((slide) => slide.id === activeSlideId)
      : null
  const activeSlide =
    selectedActiveSlide ??
    displaySlides[defaultActiveIndex] ??
    displaySlides[0] ??
    null
  const autoAdvancePaused =
    activeSlide != null &&
    activeSlide.id === options.autoAdvancePausedForSlideId
  // Only a video slide can be waiting on bytes; an image slide is fully on
  // screen the moment it is chosen.
  const isBuffering = Boolean(activeSlide?.src) && isBufferingMedia
  // A slide's turn is time the viewer spends WATCHING it, so a paused hero
  // holds its turn the same way a buffering one does. The two are kept
  // separate for the ring: only buffering is a stall worth explaining.
  const isMediaHeld = Boolean(activeSlide?.src) && isMediaPaused
  const isTurnHeld = isBuffering || isMediaHeld
  // One resolved duration feeds both the ring and the backstop, so the two
  // cannot drift apart. The measurement only counts for the slide it was read
  // from.
  const activeMeasuredSeconds =
    measuredDuration.slideId != null &&
    measuredDuration.slideId === activeSlide?.id
      ? measuredDuration.seconds
      : null
  const advanceDurationSeconds = activeSlide
    ? watchHomeTvSlideDurationSeconds(activeSlide, activeMeasuredSeconds)
    : WATCH_HOME_TV_IMAGE_SLIDE_ADVANCE_SECONDS
  const advanceBackstopSeconds = activeSlide
    ? watchHomeTvAdvanceBackstopSeconds(activeSlide, activeMeasuredSeconds)
    : WATCH_HOME_TV_IMAGE_SLIDE_ADVANCE_SECONDS
  const safeActiveIndex = activeSlide
    ? Math.max(
        0,
        displaySlides.findIndex((slide) => slide.id === activeSlide.id),
      )
    : 0
  const autoAdvancePausedRef = useRef(autoAdvancePaused)
  const randomSourceRef = useRef(options.randomSource ?? Math.random)
  const randomStartAppliedRef = useRef(false)
  const pendingRandomHeroIdRef = useRef<string | null>(null)
  const portraitSkipCountRef = useRef(0)
  // `advance` is defined below the metadata handler that needs it.
  const advanceRef = useRef<(() => void) | null>(null)

  // The homepage is statically rendered and shared by every visitor, so the
  // per-visit draw happens here — once, right after mount — over the pools the
  // server already shipped. No extra request, no extra server render.
  useEffect(() => {
    if (randomStartAppliedRef.current) return
    randomStartAppliedRef.current = true

    const random = randomSourceRef.current
    const playedIds = readWatchHomeTvPlayedIds()
    // Videos an earlier load measured as portrait are out of the draw entirely;
    // the hero is a wide frame and would crop them to a centre strip.
    // Not mirrored into state: the queue below is built with them excluded, so
    // a stored portrait video never reaches the slide list in the first place.
    const excludedIds = readWatchHomeVerticalVideoIds()

    if (isSequenced && sequence) {
      const hero = pickRandomWatchHomeHeroVideo({
        excludedIds,
        playedIds,
        pools: sequence.pools,
        random,
      })
      if (!hero) return

      const built = buildWatchHomeVideoQueue({
        pools: sequence.pools,
        existingVideos: [hero],
        excludedIds,
        startPoolIndex: boundedRandomIndex(sequence.pools.length, random),
        targetVideoCount: 7,
        randomSource: random,
      })

      pendingRandomHeroIdRef.current = hero.id
      setPrefetchedQueue({
        sequenceKey,
        videos: built.videos,
        nextPoolIndex: built.nextPoolIndex,
      })
      setActiveSlideId(hero.id)
      return
    }

    const excluded = new Set(excludedIds)
    const playable = displaySlides.filter(
      (slide) => Boolean(slide.src) && !excluded.has(slide.id),
    )
    const candidates = playable.length > 0 ? playable : displaySlides
    if (candidates.length === 0) return
    const played = new Set(playedIds)
    const unplayed = candidates.filter((slide) => !played.has(slide.id))
    const drawFrom = unplayed.length > 0 ? unplayed : candidates
    const hero = drawFrom[boundedRandomIndex(drawFrom.length, random)]
    if (!hero) return

    pendingRandomHeroIdRef.current = hero.id
    setActiveSlideId(hero.id)
  }, [displaySlides, isSequenced, sequence, sequenceKey])

  const clearVideoPosterHold = useCallback(() => {
    if (videoPosterHoldTimeoutRef.current != null) {
      window.clearTimeout(videoPosterHoldTimeoutRef.current)
      videoPosterHoldTimeoutRef.current = null
    }
    if (videoPosterHoldIntervalRef.current != null) {
      window.clearInterval(videoPosterHoldIntervalRef.current)
      videoPosterHoldIntervalRef.current = null
    }
  }, [])

  const clearMediaWaitTimeout = useCallback(() => {
    if (mediaWaitTimeoutRef.current != null) {
      window.clearTimeout(mediaWaitTimeoutRef.current)
      mediaWaitTimeoutRef.current = null
    }
  }, [])

  const clearSlideAdvanceTimeout = useCallback(() => {
    if (slideAdvanceTimeoutRef.current != null) {
      window.clearTimeout(slideAdvanceTimeoutRef.current)
      slideAdvanceTimeoutRef.current = null
    }
  }, [])

  const selectIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= displaySlides.length) return
      const nextSlide = displaySlides[index] ?? null
      if (
        activeSlide &&
        nextSlide?.id !== activeSlide.id &&
        options.suppressLeavingSlide !== true
      ) {
        if (leavingSlideTimeoutRef.current != null) {
          window.clearTimeout(leavingSlideTimeoutRef.current)
        }
        setLeavingSlide(activeSlide)
        leavingSlideTimeoutRef.current = window.setTimeout(() => {
          setLeavingSlide(null)
          leavingSlideTimeoutRef.current = null
        }, 900)
      }
      const isSameSlide = nextSlide != null && nextSlide.id === activeSlide?.id
      imageSlideStartedAtRef.current = null
      previousProgressRef.current = 0
      clearSlideAdvanceTimeout()
      clearVideoPosterHold()
      // Every selection opens a new turn, so timers armed for the previous one
      // stop being able to advance -- including when the id is unchanged.
      turnTokenRef.current += 1
      backstopSeenTimeRef.current = 0
      advanceClockRef.current = {
        slideId: nextSlide?.id ?? null,
        elapsedMs: 0,
      }
      setProgress(0)
      setMediaReady(false)
      setIsBufferingMedia(Boolean(nextSlide?.src))
      setIsMediaPaused(false)
      setPlaybackTime({ seconds: 0, slideId: nextSlide?.id ?? null })
      setMeasuredDuration((current) =>
        current.slideId === nextSlide?.id
          ? current
          : { slideId: nextSlide?.id ?? null, seconds: null },
      )
      setActiveSlideId(nextSlide?.id ?? null)

      // Re-selecting the only playable slide cannot remount `<MuxVideo>`, so
      // no fresh `canplay` or `ended` would ever arrive. Replay it by hand and
      // restart the ring, rather than leaving the hero on a frozen last frame.
      if (isSameSlide) {
        setRestartCount((count) => count + 1)
        const video = videoRef.current
        if (video) {
          try {
            video.currentTime = 0
          } catch {
            // A detached or not-yet-seekable element throws here; the replay
            // below is still worth attempting.
          }
          const played = video.play()
          if (played && typeof played.then === "function") {
            played.catch(() => undefined)
          }
        }
        setIsBufferingMedia(false)
        setMediaReady(true)
      }
    },
    [
      activeSlide,
      clearSlideAdvanceTimeout,
      clearVideoPosterHold,
      displaySlides,
      options.suppressLeavingSlide,
    ],
  )

  const selectSlide = useCallback(
    (slideId: string) => {
      const index = displaySlides.findIndex((slide) => slide.id === slideId)
      selectIndex(index)
    },
    [displaySlides, selectIndex],
  )

  const advance = useCallback(() => {
    const nextIndex = isSequenced
      ? safeActiveIndex + 1 < displaySlides.length
        ? safeActiveIndex + 1
        : 0
      : nextUnplayedWatchHomeTvCarouselIndex(safeActiveIndex, displaySlides)
    selectIndex(nextIndex)
  }, [displaySlides, isSequenced, safeActiveIndex, selectIndex])

  useEffect(() => {
    advanceRef.current = advance
  }, [advance])

  const toggleMuted = useCallback(() => {
    setIsMuted((current) => {
      const next = !current
      const video = videoRef.current
      if (video) video.muted = next
      return next
    })
  }, [])

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    setPlaybackTime({
      seconds: video.currentTime,
      slideId: activeSlide?.id ?? null,
    })
  }, [activeSlide?.id])

  const handleLoadedMetadata = useCallback(() => {
    previousProgressRef.current = 0
    clearVideoPosterHold()
    setMediaReady(false)
    setPlaybackTime({ seconds: 0, slideId: activeSlide?.id ?? null })
    setProgress(0)

    // Before the portrait branch below, which can advance away from this
    // slide: the measurement belongs to the slide it was read from either way.
    const metadataSlideId = activeSlide?.id ?? null
    const metadataSeconds = videoRef.current?.duration
    setMeasuredDuration({
      slideId: metadataSlideId,
      seconds:
        typeof metadataSeconds === "number" &&
        Number.isFinite(metadataSeconds) &&
        metadataSeconds > 0
          ? metadataSeconds
          : null,
    })

    // The decoded size is the first and only trustworthy orientation signal in
    // the pipeline, so the skip happens here rather than at draw time. Bounded
    // because a pool that is portrait all the way down must not skip forever.
    const slideId = activeSlide?.id
    const size = readMediaVideoSize(videoRef.current)
    if (
      !slideId ||
      !size ||
      isWatchHomeHeroPlayableAspect(size.width, size.height) ||
      portraitSkipCountRef.current >= displaySlides.length
    ) {
      return
    }

    portraitSkipCountRef.current += 1
    addWatchHomeVerticalVideoId(slideId)
    setPortraitSlideIds((current) =>
      current.includes(slideId) ? current : [...current, slideId],
    )
    advanceRef.current?.()
  }, [activeSlide?.id, clearVideoPosterHold, displaySlides.length, videoRef])

  const handleCanPlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    setIsBufferingMedia(false)
    video.muted = isMutedRef.current
    clearVideoPosterHold()

    videoPosterHoldTimeoutRef.current = window.setTimeout(() => {
      setMediaReady(true)
      if (!autoAdvancePausedRef.current) {
        const played = video.play()
        if (played && typeof played.then === "function") {
          played.catch(() => {
            setIsBufferingMedia(true)
          })
        }
      }
      videoPosterHoldTimeoutRef.current = null
    }, VIDEO_POSTER_HOLD_MS)
  }, [clearVideoPosterHold])

  // A stall after playback has begun is the same situation as one before it:
  // the viewer is watching a still frame, so the ring and the advance clock
  // both hold until the bytes come back.
  const handleWaiting = useCallback(() => {
    setIsBufferingMedia(true)
  }, [])

  const handlePlaying = useCallback(() => {
    setIsBufferingMedia(false)
    setIsMediaPaused(false)
  }, [])

  const handlePause = useCallback(() => {
    setIsMediaPaused(true)
  }, [])

  const handlePlay = useCallback(() => {
    setIsMediaPaused(false)
  }, [])

  useEffect(() => {
    autoAdvancePausedRef.current = autoAdvancePaused
  }, [autoAdvancePaused])

  useEffect(() => {
    isMutedRef.current = isMuted
    const video = videoRef.current
    if (video) video.muted = isMuted
  }, [isMuted])

  useEffect(() => {
    return () => {
      if (leavingSlideTimeoutRef.current != null) {
        window.clearTimeout(leavingSlideTimeoutRef.current)
      }
      if (slideAdvanceTimeoutRef.current != null) {
        window.clearTimeout(slideAdvanceTimeoutRef.current)
      }
      if (videoPosterHoldTimeoutRef.current != null) {
        window.clearTimeout(videoPosterHoldTimeoutRef.current)
      }
      if (videoPosterHoldIntervalRef.current != null) {
        window.clearInterval(videoPosterHoldIntervalRef.current)
      }
      if (mediaWaitTimeoutRef.current != null) {
        window.clearTimeout(mediaWaitTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    imageSlideStartedAtRef.current = null
    previousProgressRef.current = 0
    clearVideoPosterHold()
    // Between mount and the per-visit draw committing, the active slide is the
    // deterministic bootstrap slide nobody actually watched. Recording it would
    // permanently exclude that one video from every visitor's random draw.
    // Compared against the id we set rather than the resolved slide, so a
    // drawn id that fails to resolve cannot wedge play tracking off for the
    // rest of the session.
    const awaitingRandomHero =
      pendingRandomHeroIdRef.current != null &&
      activeSlideId !== pendingRandomHeroIdRef.current
    if (activeSlideId === pendingRandomHeroIdRef.current) {
      pendingRandomHeroIdRef.current = null
    }
    if (hasHydrated && !awaitingRandomHero) {
      if (isSequenced) {
        markWatchHomeVideoPlayed(activeSlide)
        saveWatchHomeCurrentVideoSession(activeSlide)
      } else if (activeSlide?.id) {
        addWatchHomeTvPlayedId(activeSlide.id)
      }
    }
    const video = videoRef.current
    if (!video) return
    video.muted = isMutedRef.current
    video.currentTime = 0
  }, [
    activeSlide,
    activeSlide?.id,
    activeSlideId,
    clearVideoPosterHold,
    hasHydrated,
    isSequenced,
  ])

  useEffect(() => {
    if (!activeSlide) return

    const clock = advanceClockRef.current
    if (clock.slideId !== activeSlide.id) {
      clock.slideId = activeSlide.id
      clock.elapsedMs = 0
    }

    clearSlideAdvanceTimeout()
    // A slide's turn is time the viewer spends WATCHING it. Running this clock
    // from the moment the slide is chosen spent that turn on a loading spinner
    // over a slow connection — the ring filled and the hero moved on over a
    // video nobody ever saw. Parking it while buffering keeps the ring (which
    // animates over the same duration) honest by construction.
    if (autoAdvancePaused || isTurnHeld) return undefined

    const advanceAfterMs = activeSlide.src
      ? advanceBackstopSeconds * 1000
      : IMAGE_SLIDE_ADVANCE_MS
    const startedAt = Date.now()
    const armedForTurn = turnTokenRef.current

    slideAdvanceTimeoutRef.current = window.setTimeout(
      () => {
        slideAdvanceTimeoutRef.current = null
        // A timer armed for a turn that has already ended must not advance the
        // one that replaced it.
        if (turnTokenRef.current !== armedForTurn) return

        // This clock measures WALL time against a MEDIA duration. Any decode
        // slippage that never fired `waiting` accumulates, and on a
        // feature-length film a fraction of a percent eats the whole grace.
        // So the media clock, not this one, decides that the video is over.
        const video = videoRef.current
        const currentTime = video?.currentTime
        const mediaSeconds =
          video &&
          typeof currentTime === "number" &&
          Number.isFinite(currentTime)
            ? currentTime
            : 0
        const remaining = advanceDurationSeconds - mediaSeconds
        const mediaAdvanced = mediaSeconds > backstopSeenTimeRef.current
        if (remaining > 1 && mediaAdvanced) {
          backstopSeenTimeRef.current = mediaSeconds
          clock.elapsedMs = Math.max(
            0,
            advanceAfterMs -
              (remaining + WATCH_HOME_TV_ENDED_BACKSTOP_GRACE_SECONDS) * 1000,
          )
          setBackstopReArmCount((count) => count + 1)
          return
        }

        advance()
      },
      Math.max(0, advanceAfterMs - clock.elapsedMs),
    )

    return () => {
      clearSlideAdvanceTimeout()
      clock.elapsedMs += Date.now() - startedAt
    }
  }, [
    activeSlide,
    activeSlide?.durationSeconds,
    activeSlide?.id,
    activeSlide?.src,
    advance,
    advanceBackstopSeconds,
    advanceDurationSeconds,
    autoAdvancePaused,
    backstopReArmCount,
    clearSlideAdvanceTimeout,
    isTurnHeld,
  ])

  // The ceiling on a parked clock: a stream that never arrives still loses its
  // turn, so one dead video cannot strand the hero.
  useEffect(() => {
    clearMediaWaitTimeout()
    // Buffering and paused are not exclusive: a viewer who scrolls away
    // mid-stall leaves both true, and a ceiling that ignored the pause would
    // force-advance the hero every 12 seconds behind the page -- exactly the
    // behaviour the pause gate exists to stop.
    if (!isBuffering || isMediaHeld || autoAdvancePaused) return undefined

    const armedForTurn = turnTokenRef.current
    mediaWaitTimeoutRef.current = window.setTimeout(() => {
      mediaWaitTimeoutRef.current = null
      // The portrait-aspect skip can advance from `loadedmetadata` without
      // this effect having re-run yet, so the same turn guard applies here.
      if (turnTokenRef.current !== armedForTurn) return
      advance()
    }, WATCH_HOME_TV_MEDIA_WAIT_TIMEOUT_MS)

    return () => {
      clearMediaWaitTimeout()
    }
  }, [
    advance,
    autoAdvancePaused,
    clearMediaWaitTimeout,
    isBuffering,
    isMediaHeld,
  ])

  useEffect(() => {
    if (!isSequenced || !sequence || videoQueue.length === 0) return
    const activeVideoIndex =
      activeSlide?.kind === "video"
        ? videoQueue.findIndex((video) => video.id === activeSlide.id)
        : -1
    const targetVideoCount =
      videoQueue.length < 7
        ? 7
        : activeVideoIndex >= 0
          ? activeVideoIndex + 1 + WATCH_HOME_TV_TIMELINE_FUTURE_COUNT
          : videoQueue.length

    if (targetVideoCount <= videoQueue.length) return

    const built = buildWatchHomeVideoQueue({
      pools: sequence.pools,
      existingVideos: videoQueue,
      startPoolIndex: nextPoolIndex,
      targetVideoCount,
    })
    if (built.videos.length === videoQueue.length) return

    const timeout = window.setTimeout(() => {
      setPrefetchedQueue({
        sequenceKey,
        videos: built.videos,
        nextPoolIndex: built.nextPoolIndex,
      })
    }, 0)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [
    activeSlide,
    isSequenced,
    nextPoolIndex,
    sequence,
    sequenceKey,
    videoQueue,
  ])

  useEffect(() => {
    if (!activeSlide || activeSlide.src || autoAdvancePaused) return

    let animationFrame = 0

    function tick(now: number) {
      if (imageSlideStartedAtRef.current == null) {
        imageSlideStartedAtRef.current = now
      }
      const elapsed = now - imageSlideStartedAtRef.current
      const nextProgress = Math.min(
        100,
        (elapsed / IMAGE_SLIDE_ADVANCE_MS) * 100,
      )
      setProgress(nextProgress)
      animationFrame = requestAnimationFrame(tick)
    }

    animationFrame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(animationFrame)
    }
  }, [activeSlide, autoAdvancePaused])

  return useMemo(
    () => ({
      activeIndex: safeActiveIndex,
      activeSlide,
      advance,
      advanceDurationSeconds,
      // Changes when the resolved duration lands late or the same slide is
      // replayed, so the ring's CSS animation restarts instead of
      // reinterpreting a running one.
      ringAnimationKey: `${activeSlide?.id ?? "none"}:${advanceDurationSeconds}:${restartCount}`,
      handleCanPlay,
      handleEnded: advance,
      handleLoadedMetadata,
      handlePause,
      handlePlay,
      handlePlaying,
      handleTimeUpdate,
      handleWaiting,
      isBuffering,
      isTurnHeld,
      isMuted,
      leavingSlide,
      mediaReady,
      progress,
      playbackTimeSeconds:
        playbackTime.slideId === activeSlide?.id ? playbackTime.seconds : 0,
      selectSlide,
      slides: displaySlides,
      toggleMuted,
      videoRef,
    }),
    [
      safeActiveIndex,
      activeSlide,
      advance,
      advanceDurationSeconds,
      restartCount,
      handleCanPlay,
      handleLoadedMetadata,
      handlePause,
      handlePlay,
      handlePlaying,
      handleTimeUpdate,
      handleWaiting,
      displaySlides,
      isBuffering,
      isTurnHeld,
      isMuted,
      leavingSlide,
      mediaReady,
      playbackTime,
      progress,
      selectSlide,
      toggleMuted,
    ],
  )
}
