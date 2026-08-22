"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"

import { useWatchRouteSurface } from "@/components/FloatingSearchContext"
import type { WatchIntroductionTourProps } from "@/components/watch/WatchIntroductionTour"
import {
  WATCH_MODAL_CLOSE_DELAY_MS,
  useWatchModalReservation,
} from "@/components/watch/WatchModalActivityProvider"
import { WATCH_PLAYER_PLAYBACK_STATE_EVENT } from "@/lib/watch-player-chrome-events"
import {
  markWatchIntroductionCompleted,
  readWatchIntroductionCompletion,
} from "@/lib/watch-introduction-preference"

const WATCH_INTRODUCTION_AUTO_DELAY_MS = 1_000

type WatchIntroductionContextValue = {
  open: boolean
  replay: (trigger?: HTMLElement | null) => boolean
}

const WatchIntroductionContext =
  createContext<WatchIntroductionContextValue | null>(null)

const LazyWatchIntroductionTour = dynamic<WatchIntroductionTourProps>(
  () =>
    import("@/components/watch/WatchIntroductionTour").then((module) => ({
      default: module.WatchIntroductionTour,
    })),
  { ssr: false },
)

export function useWatchIntroduction(): WatchIntroductionContextValue {
  const context = useContext(WatchIntroductionContext)
  if (!context) {
    throw new Error(
      "useWatchIntroduction must be used inside <WatchIntroductionProvider>",
    )
  }
  return context
}

function connectedFocusTarget(candidate?: HTMLElement | null) {
  if (candidate?.isConnected) return candidate
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body
    ? active
    : null
}

export function WatchIntroductionProvider({
  children,
}: {
  children: ReactNode
}) {
  const pathname = usePathname()
  const routeSurface = useWatchRouteSurface()
  const reservation = useWatchModalReservation()
  const [open, setOpen] = useState(false)
  const [tourEnabled, setTourEnabled] = useState(false)
  const initialPathnameRef = useRef(pathname)
  const automaticAttemptedRef = useRef(false)
  const automaticAttemptAbandonedRef = useRef(false)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openTour = useCallback(
    (trigger?: HTMLElement | null) => {
      if (open) return true
      if (!reservation.tryAcquire()) return false

      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current)
        releaseTimerRef.current = null
      }
      returnFocusRef.current = connectedFocusTarget(trigger)
      setTourEnabled(true)
      setOpen(true)
      return true
    },
    [open, reservation],
  )

  const finishTour = useCallback(() => {
    markWatchIntroductionCompleted()
    setOpen(false)

    if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current)
    releaseTimerRef.current = setTimeout(() => {
      releaseTimerRef.current = null
      reservation.release()
    }, WATCH_MODAL_CLOSE_DELAY_MS)

    window.requestAnimationFrame(() => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
    })
  }, [reservation])

  useEffect(() => {
    return () => {
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current)
      reservation.release()
    }
  }, [reservation])

  useEffect(() => {
    if (automaticAttemptedRef.current || automaticAttemptAbandonedRef.current) {
      return
    }
    if (pathname !== initialPathnameRef.current) {
      automaticAttemptAbandonedRef.current = true
      return
    }
    if (routeSurface !== "language-home" && routeSurface !== "experience") {
      return
    }
    if (readWatchIntroductionCompletion() !== "incomplete") return
    if (document.visibilityState !== "visible") {
      automaticAttemptAbandonedRef.current = true
      return
    }

    let active = true
    let delayTimer: ReturnType<typeof setTimeout> | null = null

    const abandon = () => {
      automaticAttemptAbandonedRef.current = true
      if (delayTimer) {
        clearTimeout(delayTimer)
        delayTimer = null
      }
    }
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") abandon()
    }
    const handlePlayback = (event: Event) => {
      const detail = (event as CustomEvent<{ playing?: unknown }>).detail
      if (detail?.playing === true) abandon()
    }
    const tryAutomaticOpen = () => {
      delayTimer = null
      if (
        !active ||
        automaticAttemptAbandonedRef.current ||
        document.visibilityState !== "visible" ||
        pathname !== initialPathnameRef.current ||
        readWatchIntroductionCompletion() !== "incomplete"
      ) {
        return
      }
      automaticAttemptedRef.current = true
      openTour()
    }
    const schedule = () => {
      if (!active || delayTimer || automaticAttemptAbandonedRef.current) return
      delayTimer = setTimeout(
        tryAutomaticOpen,
        WATCH_INTRODUCTION_AUTO_DELAY_MS,
      )
    }

    window.addEventListener("pointerdown", abandon, { passive: true })
    window.addEventListener("keydown", abandon)
    window.addEventListener("scroll", abandon, { passive: true })
    window.addEventListener(WATCH_PLAYER_PLAYBACK_STATE_EVENT, handlePlayback)
    document.addEventListener("visibilitychange", handleVisibility)

    if (document.readyState === "complete") schedule()
    else window.addEventListener("load", schedule, { once: true })

    return () => {
      active = false
      if (delayTimer) clearTimeout(delayTimer)
      window.removeEventListener("load", schedule)
      window.removeEventListener("pointerdown", abandon)
      window.removeEventListener("keydown", abandon)
      window.removeEventListener("scroll", abandon)
      window.removeEventListener(
        WATCH_PLAYER_PLAYBACK_STATE_EVENT,
        handlePlayback,
      )
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [openTour, pathname, routeSurface])

  const value = useMemo<WatchIntroductionContextValue>(
    () => ({ open, replay: openTour }),
    [open, openTour],
  )

  return (
    <WatchIntroductionContext.Provider value={value}>
      {children}
      {tourEnabled ? (
        <LazyWatchIntroductionTour
          open={open}
          onSkip={finishTour}
          onComplete={finishTour}
          finalFocus={returnFocusRef}
        />
      ) : null}
    </WatchIntroductionContext.Provider>
  )
}
