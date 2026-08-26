"use client"

import {
  Component,
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
import { useLocale } from "next-intl"

import { useWatchRouteSurface } from "@/components/FloatingSearchContext"
import { useBetaTesterModal } from "@/components/watch/BetaTesterModalProvider"
import { WatchIntroductionLoadingDialog } from "@/components/watch/WatchIntroductionLoadingDialog"
import type { WatchIntroductionTourProps } from "@/components/watch/WatchIntroductionTour"
import {
  WATCH_MODAL_CLOSE_DELAY_MS,
  useWatchModalReservation,
} from "@/components/watch/WatchModalActivityProvider"
import { WATCH_PLAYER_PLAYBACK_STATE_EVENT } from "@/lib/watch-player-chrome-events"
import {
  isWatchIntroductionLocaleEligible,
  markWatchIntroductionCompleted,
  readWatchIntroductionCompletion,
} from "@/lib/watch-introduction-preference"

const WATCH_INTRODUCTION_AUTO_DELAY_MS = 1_000

type WatchIntroductionContextValue = {
  replay: (trigger?: HTMLElement | null) => boolean
  registerReplayTrigger: (trigger: HTMLButtonElement | null) => void
}

const WatchIntroductionContext =
  createContext<WatchIntroductionContextValue | null>(null)

type WatchIntroductionLoadContextValue = {
  onCancel: () => void
  open: boolean
}

const WatchIntroductionLoadContext =
  createContext<WatchIntroductionLoadContextValue | null>(null)

function WatchIntroductionTourLoadingFallback({
  failed,
  onRetry,
}: {
  failed: boolean
  onRetry?: () => void
}) {
  const loadState = useContext(WatchIntroductionLoadContext)

  if (!loadState?.open) return null

  return (
    <WatchIntroductionLoadingDialog
      failed={failed}
      onCancel={loadState.onCancel}
      onRetry={onRetry}
      open
    />
  )
}

class WatchIntroductionTourLoadBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <WatchIntroductionTourLoadingFallback
          failed
          onRetry={() => this.setState({ failed: false })}
        />
      )
    }
    return this.props.children
  }
}

const LazyWatchIntroductionTour = dynamic<WatchIntroductionTourProps>(
  () =>
    import("@/components/watch/WatchIntroductionTour").then((module) => ({
      default: module.WatchIntroductionTour,
    })),
  {
    ssr: false,
    loading: ({ error, retry }) => (
      <WatchIntroductionTourLoadingFallback
        failed={error != null}
        onRetry={retry}
      />
    ),
  },
)

export class WatchIntroductionContextError extends Error {
  constructor() {
    super(
      "useWatchIntroduction must be used inside <WatchIntroductionProvider>",
    )
    this.name = "WatchIntroductionContextError"
  }
}

export function useWatchIntroduction(): WatchIntroductionContextValue {
  const context = useContext(WatchIntroductionContext)
  if (!context) {
    throw new WatchIntroductionContextError()
  }
  return context
}

export function useOptionalWatchIntroduction(): WatchIntroductionContextValue | null {
  return useContext(WatchIntroductionContext)
}

function connectedFocusTarget(candidate?: HTMLElement | null) {
  if (candidate?.isConnected) return candidate
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body
    ? active
    : null
}

function stableWatchFocusTarget() {
  return document.querySelector<HTMLElement>(
    '[data-testid="floating-header-logo"], [data-testid="floating-search-desktop-button"], [data-testid="floating-header-language-button"]',
  )
}

export function WatchIntroductionProvider({
  children,
}: {
  children: ReactNode
}) {
  const pathname = usePathname()
  const locale = useLocale()
  const routeSurface = useWatchRouteSurface()
  const betaTesterModal = useBetaTesterModal()
  const reservation = useWatchModalReservation()
  const [open, setOpen] = useState(false)
  const [tourEnabled, setTourEnabled] = useState(false)
  const [suppressFinalFocus, setSuppressFinalFocus] = useState(false)
  const initialPathnameRef = useRef(pathname)
  const automaticAttemptedRef = useRef(false)
  const automaticAttemptAbandonedRef = useRef(false)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const replayTriggerRef = useRef<HTMLButtonElement | null>(null)
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openTour = useCallback(
    (trigger?: HTMLElement | null, automatic = false) => {
      if (open) return true
      if (!reservation.tryAcquire()) return false

      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current)
        releaseTimerRef.current = null
      }
      returnFocusRef.current = automatic
        ? (connectedFocusTarget() ?? stableWatchFocusTarget())
        : ((trigger ? connectedFocusTarget(trigger) : null) ??
          replayTriggerRef.current ??
          connectedFocusTarget())
      setTourEnabled(true)
      setSuppressFinalFocus(false)
      setOpen(true)
      return true
    },
    [open, reservation],
  )

  const closeTour = useCallback(
    (restoreFocus = true) => {
      setOpen(false)

      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = setTimeout(() => {
        releaseTimerRef.current = null
        reservation.release()
        setTourEnabled(false)
      }, WATCH_MODAL_CLOSE_DELAY_MS)

      if (restoreFocus) {
        window.requestAnimationFrame(() => {
          if (returnFocusRef.current?.isConnected) {
            returnFocusRef.current.focus({ preventScroll: true })
          }
        })
      }
    },
    [reservation],
  )

  const finishTour = useCallback(
    (restoreFocus = true) => {
      markWatchIntroductionCompleted()
      closeTour(restoreFocus)
    },
    [closeTour],
  )

  const cancelTourLoad = useCallback(() => {
    closeTour()
  }, [closeTour])

  const registerReplayTrigger = useCallback(
    (trigger: HTMLButtonElement | null) => {
      replayTriggerRef.current = trigger
    },
    [],
  )

  const requestSignup = useCallback(() => {
    const focusTarget =
      (returnFocusRef.current?.isConnected ? returnFocusRef.current : null) ??
      stableWatchFocusTarget() ??
      (replayTriggerRef.current?.isConnected ? replayTriggerRef.current : null)
    if (!betaTesterModal?.openModal(focusTarget)) return false

    setSuppressFinalFocus(true)
    finishTour(false)
    return true
  }, [betaTesterModal, finishTour])

  useEffect(() => {
    return () => {
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current)
    }
  }, [])

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
    if (!isWatchIntroductionLocaleEligible(locale)) return
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
      openTour(undefined, true)
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
  }, [locale, openTour, pathname, routeSurface])

  const value = useMemo<WatchIntroductionContextValue>(
    () => ({ replay: openTour, registerReplayTrigger }),
    [openTour, registerReplayTrigger],
  )

  const loadState = useMemo<WatchIntroductionLoadContextValue>(
    () => ({ onCancel: cancelTourLoad, open }),
    [cancelTourLoad, open],
  )

  return (
    <WatchIntroductionContext.Provider value={value}>
      {children}
      {tourEnabled ? (
        <WatchIntroductionLoadContext.Provider value={loadState}>
          <WatchIntroductionTourLoadBoundary key={String(open)}>
            <LazyWatchIntroductionTour
              open={open}
              onSkip={finishTour}
              onComplete={finishTour}
              onSignup={requestSignup}
              finalFocus={suppressFinalFocus ? false : returnFocusRef}
            />
          </WatchIntroductionTourLoadBoundary>
        </WatchIntroductionLoadContext.Provider>
      ) : null}
    </WatchIntroductionContext.Provider>
  )
}
