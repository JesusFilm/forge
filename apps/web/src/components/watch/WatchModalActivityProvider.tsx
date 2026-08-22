"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

export const WATCH_MODAL_CLOSE_DELAY_MS = 200

export type WatchPausableMedia = {
  paused: boolean
  pause: () => void
  play: () => Promise<void> | void
  addEventListener?: (type: "play", listener: EventListener) => void
  removeEventListener?: (type: "play", listener: EventListener) => void
}

type WatchModalRegistryActions = {
  acquire: (token: symbol) => void
  tryAcquire: (token: symbol) => boolean
  release: (token: symbol) => void
  hasActivity: () => boolean
}

export type WatchModalReservation = {
  tryAcquire: () => boolean
  release: () => void
  isAcquired: () => boolean
}

const WatchModalRegistryContext =
  createContext<WatchModalRegistryActions | null>(null)
const WatchModalActiveContext = createContext<boolean | null>(null)

export function WatchModalActivityProvider({
  children,
}: {
  children: ReactNode
}) {
  const [tokens] = useState(() => new Set<symbol>())
  const [active, setActive] = useState(false)

  const acquire = useCallback(
    (token: symbol) => {
      if (tokens.has(token)) return
      const wasInactive = tokens.size === 0
      tokens.add(token)
      if (wasInactive) setActive(true)
    },
    [tokens],
  )

  const release = useCallback(
    (token: symbol) => {
      if (!tokens.delete(token)) return
      if (tokens.size === 0) setActive(false)
    },
    [tokens],
  )

  const hasActivity = useCallback(() => tokens.size > 0, [tokens])

  const tryAcquire = useCallback(
    (token: symbol) => {
      if (tokens.has(token)) return true
      if (tokens.size > 0) return false
      tokens.add(token)
      setActive(true)
      return true
    },
    [tokens],
  )

  const registry = useMemo<WatchModalRegistryActions>(
    () => ({ acquire, tryAcquire, release, hasActivity }),
    [acquire, hasActivity, release, tryAcquire],
  )

  return (
    <WatchModalRegistryContext.Provider value={registry}>
      <WatchModalActiveContext.Provider value={active}>
        {children}
      </WatchModalActiveContext.Provider>
    </WatchModalRegistryContext.Provider>
  )
}

/**
 * Reserve the shared Watch modal surface synchronously. Unlike an effect-only
 * activity registration, this lets two same-tick open attempts deterministically
 * choose one owner before either dialog is rendered.
 */
export function useWatchModalReservation(): WatchModalReservation {
  const registry = useContext(WatchModalRegistryContext)
  const [token] = useState(() => Symbol("watch-modal-reservation"))
  const acquiredRef = useRef(false)

  const tryAcquire = useCallback(() => {
    if (acquiredRef.current) return true
    if (!registry?.tryAcquire(token)) return false
    acquiredRef.current = true
    return true
  }, [registry, token])

  const release = useCallback(() => {
    if (!acquiredRef.current) return
    acquiredRef.current = false
    registry?.release(token)
  }, [registry, token])

  const isAcquired = useCallback(() => acquiredRef.current, [])

  useLayoutEffect(() => release, [release])

  return useMemo(
    () => ({ tryAcquire, release, isAcquired }),
    [isAcquired, release, tryAcquire],
  )
}

/**
 * Register one modal owner with a unique instance token. The default delayed
 * release keeps playback paused through Base UI's visible close transition.
 */
export function useWatchModalActivity(
  active: boolean,
  {
    releaseDelayMs = WATCH_MODAL_CLOSE_DELAY_MS,
  }: { releaseDelayMs?: number } = {},
) {
  const registry = useContext(WatchModalRegistryContext)
  const acquire = registry?.acquire
  const releaseToken = registry?.release
  const [token] = useState(() => Symbol())
  const acquiredRef = useRef(false)
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    if (!acquire || !releaseToken) return

    if (active) {
      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current)
        releaseTimerRef.current = null
      }
      if (!acquiredRef.current) {
        acquiredRef.current = true
        acquire(token)
      }
      return
    }

    if (!acquiredRef.current || releaseTimerRef.current) return
    const release = () => {
      releaseTimerRef.current = null
      if (!acquiredRef.current) return
      acquiredRef.current = false
      releaseToken(token)
    }
    if (releaseDelayMs <= 0) {
      release()
    } else {
      releaseTimerRef.current = setTimeout(release, releaseDelayMs)
    }
  }, [acquire, active, releaseDelayMs, releaseToken, token])

  useLayoutEffect(() => {
    if (!releaseToken) return
    return () => {
      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current)
        releaseTimerRef.current = null
      }
      if (acquiredRef.current) {
        acquiredRef.current = false
        releaseToken(token)
      }
    }
  }, [releaseToken, token])
}

/** Make a media callback ref reactive so modal activity covers ref changes. */
export function useWatchModalMediaRef<T extends WatchPausableMedia>(
  playbackIdentity?: unknown,
) {
  const mediaRef = useRef<T | null>(null)
  const [media, setMedia] = useState<T | null>(null)
  usePauseForWatchModal(media, playbackIdentity)

  const setMediaRef = useCallback((next: T | null | undefined) => {
    const element = next ?? null
    mediaRef.current = element
    setMedia((current) => (current === element ? current : element))
  }, [])

  return { media, mediaRef, setMediaRef }
}

/**
 * Pause a route-owned media element while any Watch modal owns interaction.
 * Resume entitlement belongs only to the exact element that was playing on
 * the first inactive-to-active edge.
 */
export function usePauseForWatchModal(
  media: WatchPausableMedia | null,
  playbackIdentity: unknown = media,
) {
  const modalActive = useContext(WatchModalActiveContext)
  const registry = useContext(WatchModalRegistryContext)
  const registryAvailable = modalActive != null
  const active = modalActive ?? false
  const initializedRef = useRef(false)
  const wasActiveRef = useRef(active)
  const resumeMediaRef = useRef<WatchPausableMedia | null>(null)
  const resumeIdentityRef = useRef<unknown>(null)
  const shouldResumeRef = useRef(false)
  const inactiveMediaRef = useRef<WatchPausableMedia | null>(null)
  const inactiveIdentityRef = useRef<unknown>(null)

  // Keep the last media identity from a fully inactive commit. Checking the
  // synchronous token registry prevents a media/source replacement batched
  // with modal opening from acquiring stale resume entitlement while the
  // provider's aggregate state update is still pending.
  useEffect(() => {
    if (!registry || active || registry.hasActivity()) return
    inactiveMediaRef.current = media
    inactiveIdentityRef.current = playbackIdentity
  }, [active, media, playbackIdentity, registry])

  useLayoutEffect(() => {
    if (!registryAvailable) {
      initializedRef.current = false
      resumeMediaRef.current = null
      resumeIdentityRef.current = null
      shouldResumeRef.current = false
      return
    }

    if (!initializedRef.current) {
      initializedRef.current = true
      wasActiveRef.current = active
      if (active && media && !media.paused) media.pause()
      return
    }

    const wasActive = wasActiveRef.current
    wasActiveRef.current = active

    if (active) {
      if (!wasActive) {
        resumeMediaRef.current = media
        resumeIdentityRef.current = playbackIdentity
        shouldResumeRef.current =
          media != null &&
          media === inactiveMediaRef.current &&
          playbackIdentity === inactiveIdentityRef.current &&
          !media.paused
      } else if (
        resumeMediaRef.current !== media ||
        resumeIdentityRef.current !== playbackIdentity
      ) {
        resumeMediaRef.current = null
        resumeIdentityRef.current = null
        shouldResumeRef.current = false
      }
      if (media && !media.paused) media.pause()
      return
    }

    if (wasActive) {
      const resumeMedia = resumeMediaRef.current
      if (
        shouldResumeRef.current &&
        resumeMedia === media &&
        resumeIdentityRef.current === playbackIdentity &&
        resumeMedia
      ) {
        const playResult = resumeMedia.play()
        if (playResult && typeof playResult.catch === "function") {
          playResult.catch(() => undefined)
        }
      }
    }
    resumeMediaRef.current = null
    resumeIdentityRef.current = null
    shouldResumeRef.current = false
  }, [active, media, playbackIdentity, registryAvailable])

  useLayoutEffect(() => {
    if (!active || !media?.addEventListener || !media.removeEventListener) {
      return
    }
    const handlePlay: EventListener = () => {
      if (!media.paused) media.pause()
    }
    media.addEventListener("play", handlePlay)
    return () => media.removeEventListener?.("play", handlePlay)
  }, [active, media])
}
