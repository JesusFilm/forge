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
import { createPortal } from "react-dom"
import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { usePathname, useRouter } from "next/navigation"
import { Globe } from "lucide-react"
import { useTranslations } from "next-intl"

import { runSearch } from "@/lib/search-actions"
import type { SearchResult } from "@/lib/search"
import { buildSearchUrl } from "@/lib/search-url"
import { WATCH_PAGE_LEFT_RAIL_CLASSES } from "@/lib/content-width"
import {
  WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
  WATCH_PLAYER_CHROME_REVEAL_EVENT,
  WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
  WATCH_PLAYER_PLAYBACK_STATE_EVENT,
  type WatchHeaderLanguageSwitcherDetail,
  type WatchPlayerChromeVisibilityDetail,
  type WatchPlayerPlaybackStateDetail,
} from "@/lib/watch-player-chrome-events"

import { FloatingSearchBar } from "./FloatingSearchBar"
import { SearchOverlay } from "./SearchOverlay"

const HEADER_HOVER_HEIGHT_PX = 144
const SEARCH_PAGE_SIZE = 10

export type FloatingSearchContextValue = {
  open: boolean
  closing: boolean
  query: string
  results: SearchResult[]
  displayResults: SearchResult[]
  exiting: boolean
  resultsKey: number
  hasMore: boolean
  loading: boolean
  showSkeleton: boolean
  loadingMore: boolean
  error: string | null
  searched: boolean
  setOpen: (open: boolean) => void
  setQuery: (q: string) => void
  search: (q: string) => Promise<void>
  loadMore: () => Promise<void>
  closeAndKeepQuery: () => void
}

export type FloatingSearchPinnedContextValue = {
  pinned: boolean
  playerChromeVisible: boolean
  searchChromeVisible: boolean
  searchChromeDimmed: boolean
  // True while the search overlay is open OR running its close animation.
  // Watch-page modal coordinators read this to pause/resume the video
  // alongside their own (download / language / share) modal state.
  searchOpen: boolean
}

const FloatingSearchContext = createContext<FloatingSearchContextValue | null>(
  null,
)
const FloatingSearchPinnedContext =
  createContext<FloatingSearchPinnedContextValue | null>(null)

type HeaderLanguageSwitcherState = {
  visible: boolean
  onClick: (() => void) | null
}

export function useFloatingSearch(): FloatingSearchContextValue {
  const ctx = useContext(FloatingSearchContext)
  if (ctx === null) {
    throw new Error(
      "useFloatingSearch must be used inside <FloatingSearchProvider>",
    )
  }
  return ctx
}

export function useFloatingSearchPinned(): FloatingSearchPinnedContextValue {
  const ctx = useContext(FloatingSearchPinnedContext)
  if (ctx === null) {
    throw new Error(
      "useFloatingSearchPinned must be used inside <FloatingSearchProvider>",
    )
  }
  return ctx
}

export function FloatingSearchProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("FloatingSearch")
  const tSearchOverlay = useTranslations("SearchOverlay")
  const router = useRouter()
  // usePathname() returns the app-relative path (no basePath prefix). The
  // router.replace() call auto-prefixes basePath, so feeding it
  // window.location.pathname (which includes basePath) would double-prefix
  // on every search. usePathname() does NOT force the Full Route Cache
  // deopt that useSearchParams() would.
  const pathname = usePathname()

  // Open/query state starts false — the URL-hydration effect below seeds it
  // after mount. Reading useSearchParams() here would force every route under
  // this layout out of the Full Route Cache, so we trade a one-frame flash of
  // closed modal for preserved ISR on all pages.
  const [open, setOpenState] = useState<boolean>(false)
  const [closing, setClosing] = useState<boolean>(false)
  const [query, setQuery] = useState<string>("")
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
  // Whether the modal was opened via URL hydration (vs user click). Gates a
  // shorter skeleton threshold so the URL-hydrated blank window is less jarring.
  const hydratedOpenRef = useRef<boolean>(false)

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
    setPlayerChromeVisible(true)
    setPlayerChromeOpacity(1)
    setPlayerPlaybackState({ playing: false, muted: true, preview: false })
    setHeaderLanguageSwitcher({ visible: false, onClick: null })
    setHeaderHovered(false)
  }, [pathname])

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

  const [results, setResults] = useState<SearchResult[]>([])
  const [displayResults, setDisplayResults] = useState<SearchResult[]>([])
  const [exiting, setExiting] = useState(false)
  const [resultsKey, setResultsKey] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const requestIdRef = useRef(0)
  const skeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadingMoreRef = useRef(false)
  const displayResultsRef = useRef<SearchResult[]>([])
  useEffect(() => {
    displayResultsRef.current = displayResults
  }, [displayResults])

  // Cancel any pending skeleton timer on unmount.
  useEffect(() => {
    return () => {
      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
    }
  }, [])

  const [portalReady, setPortalReady] = useState(false)
  useEffect(() => {
    setPortalReady(true)
  }, [])

  const search = useCallback(
    async (q: string): Promise<void> => {
      const trimmed = q.trim()
      setQuery(q)

      // Bump the request id immediately so any in-flight request (from a prior
      // call in any branch — exit-animation, Apollo, or clear) fails its
      // freshness check when it resolves.
      const thisRequest = ++requestIdRef.current

      // URL sync — preserves any existing params (utm_*, etc.) and strips ?q=
      // when the query is empty. Use usePathname() (app-relative) so
      // router.replace's auto basePath prefix isn't applied twice.
      const currentParams =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search)
          : new URLSearchParams()
      const nextUrl = buildSearchUrl(pathname, currentParams, trimmed)
      router.replace(nextUrl as Route)

      if (!trimmed) {
        if (displayResultsRef.current.length > 0) {
          setExiting(true)
          await new Promise<void>((resolve) => setTimeout(resolve, 200))
          if (requestIdRef.current !== thisRequest) return
          setExiting(false)
        }
        if (requestIdRef.current !== thisRequest) return
        setResults([])
        setDisplayResults([])
        setHasMore(false)
        setSearched(false)
        setError(null)
        return
      }

      if (displayResultsRef.current.length > 0) {
        setExiting(true)
        await new Promise<void>((resolve) => setTimeout(resolve, 200))
        if (requestIdRef.current !== thisRequest) return
        setExiting(false)
        setDisplayResults([])
      }

      setLoading(true)
      setError(null)
      setSearched(true)
      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
      const skeletonThreshold = hydratedOpenRef.current ? 150 : 500
      skeletonTimerRef.current = setTimeout(() => {
        if (requestIdRef.current === thisRequest) setShowSkeleton(true)
      }, skeletonThreshold)

      try {
        const data = await runSearch({
          query: trimmed.slice(0, 200),
          limit: SEARCH_PAGE_SIZE,
          offset: 0,
        })

        if (requestIdRef.current !== thisRequest) return

        const newResults = data.results
        setResults(newResults)
        setDisplayResults(newResults)
        setResultsKey((k) => k + 1)
        setHasMore(data.hasMore)
      } catch {
        if (requestIdRef.current === thisRequest) {
          setError(tSearchOverlay("searchFailed"))
        }
      } finally {
        // Only clear loading state for the winning request — otherwise a
        // stale response's finally would drop the active spinner mid-fetch.
        if (requestIdRef.current === thisRequest) {
          if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
          setShowSkeleton(false)
          setLoading(false)
        }
      }
    },
    [pathname, router, tSearchOverlay],
  )

  const loadMore = useCallback(async (): Promise<void> => {
    // Synchronous guard against double-fire before React commits `disabled`.
    if (loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    setError(null)
    // Capture the current search's request id; bail out of the append if a
    // new search supersedes us mid-fetch.
    const thisRequest = requestIdRef.current
    try {
      const data = await runSearch({
        query: query.trim().slice(0, 200),
        limit: SEARCH_PAGE_SIZE,
        offset: results.length,
      })
      if (requestIdRef.current !== thisRequest) return
      setResults((prev) => [...prev, ...data.results])
      setDisplayResults((prev) => [...prev, ...data.results])
      setHasMore(data.hasMore)
    } catch {
      if (requestIdRef.current === thisRequest) {
        setError(tSearchOverlay("loadMoreFailed"))
      }
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [query, results.length, tSearchOverlay])

  const closeAndKeepQuery = useCallback(() => {
    setOpen(false)
  }, [setOpen])

  // On first client mount, seed state from ?q= in the URL.
  const didHydrateRef = useRef(false)
  useEffect(() => {
    if (didHydrateRef.current) return
    didHydrateRef.current = true
    if (typeof window === "undefined") return
    const seeded = new URLSearchParams(window.location.search).get("q") ?? ""
    const trimmed = seeded.slice(0, 200)
    if (trimmed.length === 0) return
    hydratedOpenRef.current = true
    setQuery(trimmed)
    setOpenState(true)
    void search(trimmed)
  }, [search])

  const value = useMemo<FloatingSearchContextValue>(
    () => ({
      open,
      closing,
      query,
      results,
      displayResults,
      exiting,
      resultsKey,
      hasMore,
      loading,
      showSkeleton,
      loadingMore,
      error,
      searched,
      setOpen,
      setQuery,
      search,
      loadMore,
      closeAndKeepQuery,
    }),
    [
      open,
      closing,
      query,
      results,
      displayResults,
      exiting,
      resultsKey,
      hasMore,
      loading,
      showSkeleton,
      loadingMore,
      error,
      searched,
      setOpen,
      search,
      loadMore,
      closeAndKeepQuery,
    ],
  )

  // Pinned lives on its own context so scroll-rate state updates don't
  // re-render the modal result grid (up to 20 VideoCards).
  const modalChromeHidden = open || closing
  const playerPlayingWithSound =
    playerPlaybackState.playing && !playerPlaybackState.muted
  const headerChromeOpacity =
    headerHovered && playerChromeOpacity <= 0 ? 1 : playerChromeOpacity
  const headerChromeHidden = modalChromeHidden || headerChromeOpacity <= 0
  const headerChromeDimmed = !headerChromeHidden && headerChromeOpacity < 1
  const searchChromeVisible = !headerChromeHidden
  const searchChromeDimmed = headerChromeDimmed
  const headerBackdropHidden = modalChromeHidden || !playerPlaybackState.preview
  const headerHoverZoneActive =
    !modalChromeHidden &&
    (playerPlayingWithSound || playerChromeOpacity < 1 || !playerChromeVisible)
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
      setHeaderHovered(false)
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
    <FloatingSearchContext.Provider value={value}>
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
            headerHoverZoneActive
              ? "pointer-events-auto"
              : "pointer-events-none"
          }`}
        />
        <FloatingSearchBar />
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
          // Clear the search query (and ?q= URL param + cached results) on
          // click so the home navigation lands on a fresh search bar instead
          // of carrying the previous query across.
          onClick={() => {
            void search("")
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
        {portalReady && modalChromeHidden
          ? createPortal(<SearchOverlay />, document.body)
          : null}
      </FloatingSearchPinnedContext.Provider>
    </FloatingSearchContext.Provider>
  )
}
