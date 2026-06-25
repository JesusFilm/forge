"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import dynamic from "next/dynamic"
import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { usePathname } from "next/navigation"
import { Globe } from "lucide-react"
import { useTranslations } from "next-intl"

import type { FloatingSearchControllerProps } from "./FloatingSearchController"
import { FloatingSearchBar } from "./FloatingSearchBar"
import {
  FloatingSearchPinnedContext,
  type FloatingSearchPinnedContextValue,
} from "./FloatingSearchContext"
import { WATCH_PAGE_LEFT_RAIL_CLASSES } from "@/lib/content-width"
import { loadWatchInteraction } from "@/lib/watch-interaction-loader"
import {
  WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
  WATCH_PLAYER_CHROME_REVEAL_EVENT,
  WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
  WATCH_PLAYER_PLAYBACK_STATE_EVENT,
  type WatchHeaderLanguageSwitcherDetail,
  type WatchPlayerChromeVisibilityDetail,
  type WatchPlayerPlaybackStateDetail,
} from "@/lib/watch-player-chrome-events"

export {
  useFloatingSearch,
  useFloatingSearchPinned,
} from "./FloatingSearchContext"
export type {
  FloatingSearchContextValue,
  FloatingSearchPinnedContextValue,
} from "./FloatingSearchContext"

const HEADER_HOVER_HEIGHT_PX = 144

const LazyFloatingSearchController = dynamic<FloatingSearchControllerProps>(
  () =>
    import("./FloatingSearchController").then((module) => ({
      default: module.FloatingSearchController,
    })),
  { ssr: false },
)

type HeaderLanguageSwitcherState = {
  visible: boolean
  onClick: (() => void) | null
}

export function FloatingSearchProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("FloatingSearch")
  const pathname = usePathname()

  const [open, setOpenState] = useState<boolean>(false)
  const [closing, setClosing] = useState<boolean>(false)
  const [query, setQuery] = useState<string>("")
  const [searchControllerEnabled, setSearchControllerEnabled] = useState(false)
  const [searchResetToken, setSearchResetToken] = useState(0)
  const [pinned, setPinned] = useState<boolean>(false)
  const [playerChromeVisible, setPlayerChromeVisible] = useState(true)
  const [playerChromeOpacity, setPlayerChromeOpacity] = useState(1)
  const [playerPlaybackState, setPlayerPlaybackState] =
    useState<WatchPlayerPlaybackStateDetail>({
      playing: false,
      muted: true,
      preview: false,
    })
  const [headerLanguageSwitcher, setHeaderLanguageSwitcher] =
    useState<HeaderLanguageSwitcherState>({
      visible: false,
      onClick: null,
    })
  const [headerHovered, setHeaderHovered] = useState(false)
  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setOpen = useCallback((next: boolean) => {
    if (closingTimerRef.current) {
      clearTimeout(closingTimerRef.current)
      closingTimerRef.current = null
    }
    if (next) {
      setClosing(false)
      setOpenState(true)
    } else {
      setClosing(true)
      closingTimerRef.current = setTimeout(() => {
        setOpenState(false)
        setClosing(false)
        closingTimerRef.current = null
      }, 200)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (closingTimerRef.current) clearTimeout(closingTimerRef.current)
    }
  }, [])

  const enableSearchController = useCallback(() => {
    setSearchControllerEnabled(true)
    void loadWatchInteraction("search").catch(() => {})
  }, [])

  const openSearch = useCallback(() => {
    enableSearchController()
    setOpen(true)
  }, [enableSearchController, setOpen])

  useEffect(() => {
    if (!searchControllerEnabled) return
    void loadWatchInteraction("search").catch(() => {})
  }, [searchControllerEnabled])

  // Scroll-driven pinned state. Shared between the floating searchbar and
  // the floating logo so they track together. Listener registers only while
  // modal is closed (body scroll lock keeps scrollY fixed while open).
  useEffect(() => {
    if (open) return
    if (typeof window === "undefined") return
    let frame = 0
    const updatePinned = () => {
      setPinned(window.scrollY > 80)
    }
    const onScroll = () => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(() => {
        updatePinned()
        frame = 0
      })
    }
    updatePinned()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [open])

  useLayoutEffect(() => {
    if (typeof window === "undefined") return

    const handleVisibilityChange = (event: Event) => {
      const detail = (event as CustomEvent<WatchPlayerChromeVisibilityDetail>)
        .detail
      if (typeof detail?.visible !== "boolean") return
      setPlayerChromeVisible(detail.visible)
      const nextOpacity =
        typeof detail.opacity === "number"
          ? Math.max(0, Math.min(1, detail.opacity))
          : detail.visible
            ? 1
            : 0
      setPlayerChromeOpacity(nextOpacity)
      if (nextOpacity < 1) setHeaderHovered(false)
    }

    window.addEventListener(
      WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
      handleVisibilityChange,
    )
    return () => {
      window.removeEventListener(
        WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
        handleVisibilityChange,
      )
    }
  }, [])

  useLayoutEffect(() => {
    if (typeof window === "undefined") return

    const handleLanguageSwitcherChange = (event: Event) => {
      const detail = (event as CustomEvent<WatchHeaderLanguageSwitcherDetail>)
        .detail
      if (typeof detail?.visible !== "boolean") return
      setHeaderLanguageSwitcher({
        visible: detail.visible && typeof detail.onClick === "function",
        onClick: typeof detail.onClick === "function" ? detail.onClick : null,
      })
    }

    window.addEventListener(
      WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
      handleLanguageSwitcherChange,
    )
    return () => {
      window.removeEventListener(
        WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
        handleLanguageSwitcherChange,
      )
    }
  }, [])

  useLayoutEffect(() => {
    if (typeof window === "undefined") return

    const handlePlaybackStateChange = (event: Event) => {
      const detail = (event as CustomEvent<WatchPlayerPlaybackStateDetail>)
        .detail
      if (
        typeof detail?.playing !== "boolean" ||
        typeof detail?.muted !== "boolean"
      ) {
        return
      }
      setPlayerPlaybackState({
        playing: detail.playing,
        muted: detail.muted,
        preview: detail.preview === true,
      })
    }

    window.addEventListener(
      WATCH_PLAYER_PLAYBACK_STATE_EVENT,
      handlePlaybackStateChange,
    )
    return () => {
      window.removeEventListener(
        WATCH_PLAYER_PLAYBACK_STATE_EVENT,
        handlePlaybackStateChange,
      )
    }
  }, [])

  useLayoutEffect(() => {
    if (typeof window === "undefined") return
    const frame = window.requestAnimationFrame(() => {
      setPlayerChromeVisible(true)
      setPlayerChromeOpacity(1)
      setPlayerPlaybackState({ playing: false, muted: true, preview: false })
      setHeaderHovered(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [pathname])

  const modalChromeHidden = open || closing
  const playerPlayingWithSound =
    playerPlaybackState.playing && !playerPlaybackState.muted
  const headerBackdropHidden = modalChromeHidden || !playerPlaybackState.preview
  const headerHoverZoneActive =
    !modalChromeHidden &&
    (playerPlayingWithSound || playerChromeOpacity < 1 || !playerChromeVisible)
  const effectiveHeaderHovered = headerHoverZoneActive && headerHovered
  const headerChromeOpacity =
    effectiveHeaderHovered && playerChromeOpacity <= 0 ? 1 : playerChromeOpacity
  const headerChromeHidden = modalChromeHidden || headerChromeOpacity <= 0
  const headerChromeDimmed = !headerChromeHidden && headerChromeOpacity < 1
  const searchChromeVisible = !headerChromeHidden
  const searchChromeDimmed = headerChromeDimmed
  const headerCanBrightenLocally = playerChromeOpacity <= 0
  const headerPointerRevealAllowed = playerChromeOpacity < 1

  const revealPlayerChromeFromHeader = useCallback(() => {
    if (typeof window === "undefined") return
    window.dispatchEvent(new CustomEvent(WATCH_PLAYER_CHROME_REVEAL_EVENT))
  }, [])

  const handleHeaderPointerEnter = useCallback(() => {
    if (!headerPointerRevealAllowed) return
    setHeaderHovered(headerCanBrightenLocally)
    revealPlayerChromeFromHeader()
  }, [
    headerCanBrightenLocally,
    headerPointerRevealAllowed,
    revealPlayerChromeFromHeader,
  ])

  useEffect(() => {
    if (!headerHoverZoneActive) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const hoveringHeader = event.clientY <= HEADER_HOVER_HEIGHT_PX
      setHeaderHovered(hoveringHeader && headerCanBrightenLocally)
      if (hoveringHeader && headerPointerRevealAllowed) {
        revealPlayerChromeFromHeader()
      }
    }

    window.addEventListener("pointermove", handlePointerMove)
    return () => window.removeEventListener("pointermove", handlePointerMove)
  }, [
    headerHoverZoneActive,
    headerCanBrightenLocally,
    headerPointerRevealAllowed,
    revealPlayerChromeFromHeader,
  ])

  const pinnedValue = useMemo<FloatingSearchPinnedContextValue>(
    () => ({
      pinned,
      playerChromeVisible,
      searchChromeVisible,
      searchChromeDimmed,
      searchOpen: modalChromeHidden,
    }),
    [
      pinned,
      playerChromeVisible,
      searchChromeVisible,
      searchChromeDimmed,
      modalChromeHidden,
    ],
  )

  return (
    <FloatingSearchPinnedContext.Provider value={pinnedValue}>
      <div
        inert={modalChromeHidden || undefined}
        aria-hidden={modalChromeHidden || undefined}
        className={
          modalChromeHidden
            ? "blur-[12px] transition-[filter] duration-200"
            : "transition-[filter] duration-200"
        }
      >
        {children}
      </div>
      <div
        aria-hidden="true"
        data-testid="floating-header-backdrop"
        className={`pointer-events-none fixed inset-x-0 top-0 z-40 h-[calc(6rem+env(safe-area-inset-top,0px))] bg-[linear-gradient(180deg,rgba(8,16,24,0.46)_0%,rgba(28,56,72,0.22)_44%,rgba(28,56,72,0.08)_72%,rgba(28,56,72,0)_100%)] backdrop-blur-[10px] [mask-image:linear-gradient(to_bottom,black_0%,black_56%,transparent_100%)] transition-opacity duration-300 ease-out md:h-[calc(8rem+env(safe-area-inset-top,0px))] ${
          headerBackdropHidden ? "opacity-0" : "opacity-100"
        }`}
      />
      <div
        aria-hidden="true"
        data-testid="floating-header-hover-zone"
        onPointerEnter={handleHeaderPointerEnter}
        className={`fixed inset-x-0 top-0 z-[45] h-[calc(6.75rem+env(safe-area-inset-top,0px))] md:h-[calc(9rem+env(safe-area-inset-top,0px))] ${
          headerHoverZoneActive ? "pointer-events-auto" : "pointer-events-none"
        }`}
      />
      <FloatingSearchBar
        open={open}
        closing={closing}
        query={query}
        onOpen={openSearch}
      />
      {headerLanguageSwitcher.visible && headerLanguageSwitcher.onClick ? (
        <button
          type="button"
          data-testid="floating-header-language-button"
          onClick={headerLanguageSwitcher.onClick}
          aria-label={t("changeAudioLanguage")}
          title={t("changeAudioLanguage")}
          inert={headerChromeHidden || undefined}
          aria-hidden={headerChromeHidden || undefined}
          className={`fixed right-10 z-50 inline-flex h-[52px] w-12 cursor-pointer items-center justify-center rounded-full text-stone-100 transition-[top,opacity,color] duration-300 ease-out hover:text-white focus-visible:ring-2 focus-visible:ring-stone-300 focus-visible:outline-none ${
            pinned
              ? "top-[calc(env(safe-area-inset-top,0px)+1rem)]"
              : "top-[calc(env(safe-area-inset-top,0px)+2rem)] md:top-[calc(env(safe-area-inset-top,0px)+3rem)]"
          } ${
            headerChromeHidden
              ? "opacity-0 pointer-events-none"
              : headerChromeDimmed
                ? "opacity-30"
                : "opacity-100"
          }`}
        >
          <Globe
            aria-hidden
            className="h-6 w-6 drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.35)]"
          />
        </button>
      ) : null}
      <Link
        href={"/" as Route}
        aria-label={t("home")}
        data-testid="floating-header-logo"
        inert={headerChromeHidden || undefined}
        aria-hidden={headerChromeHidden || undefined}
        onClick={() => {
          setQuery("")
          setSearchResetToken((token) => token + 1)
        }}
        className={`fixed ${WATCH_PAGE_LEFT_RAIL_CLASSES} z-50 flex h-[52px] items-center transition-[top,opacity] duration-300 ease-out focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2 ${
          pinned
            ? "top-[calc(env(safe-area-inset-top,0px)+1rem)]"
            : "top-[calc(env(safe-area-inset-top,0px)+2rem)] md:top-[calc(env(safe-area-inset-top,0px)+3rem)]"
        } ${
          headerChromeHidden
            ? "opacity-0 pointer-events-none"
            : headerChromeDimmed
              ? "opacity-30"
              : "opacity-100"
        }`}
      >
        <Image
          src="/watch/images/jesusfilm-sign.svg"
          alt="JesusFilm"
          width={70}
          height={70}
          unoptimized
          className="h-auto max-w-[42px] drop-shadow-md sm:max-w-[50px] lg:max-w-[70px]"
        />
      </Link>
      {searchControllerEnabled ? (
        <LazyFloatingSearchController
          open={open}
          closing={closing}
          query={query}
          setOpen={setOpen}
          setQuery={setQuery}
          resetToken={searchResetToken}
        />
      ) : null}
    </FloatingSearchPinnedContext.Provider>
  )
}
