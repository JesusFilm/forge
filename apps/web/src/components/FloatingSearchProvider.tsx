"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react"
import dynamic from "next/dynamic"
import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { usePathname } from "next/navigation"
import { Globe, X } from "lucide-react"
import { useTranslations } from "next-intl"

import type { FloatingSearchControllerProps } from "./FloatingSearchController"
import { FloatingSearchBar } from "./FloatingSearchBar"
import { SearchOverlayInstantShell } from "./SearchOverlayInstantShell"
import {
  FloatingSearchPinnedContext,
  type FloatingSearchPinnedContextValue,
  WatchRouteSurfaceContext,
  type WatchRouteSurface,
  type WatchRouteSurfaceContextValue,
} from "./FloatingSearchContext"
import { AccountControl } from "@/components/watch/AccountControl"
import type { GlobalLanguagePickerModalProps } from "@/components/watch/GlobalLanguagePickerModal"
import {
  WATCH_MODAL_CLOSE_DELAY_MS,
  useWatchModalActivity,
} from "@/components/watch/WatchModalActivityProvider"
import {
  FLOATING_HEADER_FIELD_WIDTH_CLASS,
  FLOATING_HEADER_HOME_LOGO_SLOT_CLASS,
  FLOATING_HEADER_LAYOUT_CLASS,
  FLOATING_HEADER_LANGUAGE_SLOT_CLASS,
  FLOATING_HEADER_LOGO_SLOT_CLASS,
  FLOATING_HEADER_PINNED_TOP_CLASS,
  FLOATING_HEADER_TOP_CLASS,
  FLOATING_HEADER_TRAILING_GROUP_CLASS,
  FLOATING_HEADER_TRAILING_SLOT_CLASS,
  FLOATING_MODAL_HEADER_CLOSE_POSITION_CLASS,
  FLOATING_MODAL_HEADER_FIELD_POSITION_CLASS,
  FLOATING_MODAL_HEADER_LANGUAGE_POSITION_CLASS,
  FLOATING_MODAL_HEADER_LAYOUT_CLASS,
  FLOATING_MODAL_HEADER_LOGO_POSITION_CLASS,
  FLOATING_MODAL_HEADER_TRAILING_GROUP_CLASS,
  WATCH_PAGE_LEFT_EDGE_CLASSES,
  WATCH_PAGE_RIGHT_EDGE_CLASSES,
} from "@/lib/content-width"
import { languageCodeFor } from "@/lib/language-code"
import { isPublicWatchHomeLanguageSlug } from "@/lib/locale"
import {
  localizedHomePath,
  parseWatchPath,
  tryAsLocaleSlug,
} from "@/lib/routes"
import { isOneSegmentCollectionSlug } from "@/lib/url-shape"
import {
  loadWatchInteraction,
  scheduleWatchInteractionWarmup,
} from "@/lib/watch-interaction-loader"
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

const LazyGlobalLanguagePickerModal = dynamic<GlobalLanguagePickerModalProps>(
  () =>
    import("@/components/watch/GlobalLanguagePickerModal").then((module) => ({
      default: module.GlobalLanguagePickerModal,
    })),
  { ssr: false },
)

type HeaderLanguageSwitcherState = {
  visible: boolean
  onClick: (() => void) | null
  languageCode: string | null
  ownerToken: symbol | null
  pathname: string | null
}

type RouteIdentity = Readonly<{ pathname: string }>

type PendingPageLanguageOpen = {
  ownerToken: symbol | null
  onClick: () => void
  routeIdentity: RouteIdentity
}

type WatchRouteSurfaceRegistrationState = {
  pathname: string
  surface: WatchRouteSurface
  owner: symbol
}

type ParsedWatchPath = ReturnType<typeof parseWatchPath>

function fallbackWatchRouteSurface(
  parsed: ParsedWatchPath,
): WatchRouteSurface | null {
  if (parsed.kind === "home") return "language-home"
  if (parsed.kind !== "localized-home") return null
  if (isPublicWatchHomeLanguageSlug(parsed.lang)) return "language-home"
  if (isOneSegmentCollectionSlug(parsed.lang)) return "experience"
  return "english-video"
}

function resolveCurrentWatchLanguageSlug(
  parsed: ParsedWatchPath,
  routeSurface: WatchRouteSurface | null,
  defaultLanguageSlug: string,
): string {
  if (parsed.kind === "video" || parsed.kind === "episode") return parsed.lang
  if (routeSurface === "english-video") return "english"
  if (routeSurface === "language-home" && parsed.kind === "localized-home") {
    return parsed.lang
  }
  return defaultLanguageSlug
}

function resolveHeaderLanguageSlug(
  parsed: ParsedWatchPath,
  currentLanguageSlug: string,
): string {
  if (
    parsed.kind === "language-videos" ||
    parsed.kind === "localized-languages" ||
    parsed.kind === "localized-history"
  ) {
    return parsed.lang
  }
  return currentLanguageSlug
}

export function FloatingSearchProvider({
  children,
  defaultLanguageSlug = "english",
  initialRouteSurface = null,
}: {
  children: ReactNode
  defaultLanguageSlug?: string
  initialRouteSurface?: WatchRouteSurface | null
}) {
  const t = useTranslations("FloatingSearch")
  const searchT = useTranslations("SearchOverlay")
  const pathname = usePathname()
  const routeIdentity = useMemo<RouteIdentity>(() => ({ pathname }), [pathname])
  const parsedPath = useMemo(() => parseWatchPath(pathname), [pathname])
  const [initialRoute] = useState(() => ({
    pathname,
    surface: initialRouteSurface,
  }))
  const [routeSurfaceRegistration, setRouteSurfaceRegistration] =
    useState<WatchRouteSurfaceRegistrationState | null>(null)
  const unregisterRouteSurface = useCallback(
    (registrationPathname: string, owner: symbol) => {
      setRouteSurfaceRegistration((current) =>
        current?.pathname === registrationPathname && current.owner === owner
          ? null
          : current,
      )
    },
    [],
  )
  const registerRouteSurface = useCallback(
    (registrationPathname: string, surface: WatchRouteSurface) => {
      const owner = Symbol("watch-route-surface")
      setRouteSurfaceRegistration((current) => {
        const baselineSurface =
          registrationPathname === initialRoute.pathname &&
          initialRoute.surface != null
            ? initialRoute.surface
            : fallbackWatchRouteSurface(parseWatchPath(registrationPathname))

        // A clean registration that confirms the server seed or pathname
        // fallback does not need to force another pre-paint provider render.
        if (
          current?.pathname !== registrationPathname &&
          surface === baselineSurface
        ) {
          return null
        }

        return {
          pathname: registrationPathname,
          surface,
          owner,
        }
      })
      return () => unregisterRouteSurface(registrationPathname, owner)
    },
    [initialRoute, unregisterRouteSurface],
  )
  const initialSurface =
    initialRoute.pathname === pathname ? initialRoute.surface : null
  const routeSurface =
    routeSurfaceRegistration?.pathname === pathname
      ? routeSurfaceRegistration.surface
      : (initialSurface ?? fallbackWatchRouteSurface(parsedPath))
  const routeSurfaceValue = useMemo<WatchRouteSurfaceContextValue>(
    () => ({
      surface: routeSurface,
      register: registerRouteSurface,
    }),
    [registerRouteSurface, routeSurface],
  )
  const currentLanguageSlug = resolveCurrentWatchLanguageSlug(
    parsedPath,
    routeSurface,
    defaultLanguageSlug,
  )
  const currentLanguageCode =
    languageCodeFor({
      slug: resolveHeaderLanguageSlug(parsedPath, currentLanguageSlug),
    }) ?? languageCodeFor({ slug: currentLanguageSlug })
  const isWatchHome =
    routeSurface === "language-home" || routeSurface === "experience"
  const currentLocaleSlug = tryAsLocaleSlug(currentLanguageSlug)
  const logoHref = isWatchHome
    ? "https://www.jesusfilm.org/"
    : currentLocaleSlug && currentLocaleSlug !== "english"
      ? localizedHomePath(currentLocaleSlug)
      : "/"
  const logoSlotClass = isWatchHome
    ? FLOATING_HEADER_HOME_LOGO_SLOT_CLASS
    : FLOATING_HEADER_LOGO_SLOT_CLASS

  const [open, setOpenState] = useState<boolean>(false)
  const [closing, setClosing] = useState<boolean>(false)
  const [query, setQuery] = useState<string>("")
  const [searchControllerEnabled, setSearchControllerEnabled] = useState(false)
  const [searchControllerReady, setSearchControllerReady] = useState(false)
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
      languageCode: null,
      ownerToken: null,
      pathname: null,
    })
  const [globalLanguageOpenRoute, setGlobalLanguageOpenRoute] =
    useState<RouteIdentity | null>(null)
  const [globalLanguageLoadingRoute, setGlobalLanguageLoadingRoute] =
    useState<RouteIdentity | null>(null)
  const [globalLanguageErrorRoute, setGlobalLanguageErrorRoute] =
    useState<RouteIdentity | null>(null)
  const [headerHovered, setHeaderHovered] = useState(false)
  const [headerScrollVisible, setHeaderScrollVisible] = useState(true)
  const [headerOverHero, setHeaderOverHero] = useState(true)
  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastScrollYRef = useRef(0)
  const globalLanguageIntentRef = useRef(0)
  const globalLanguagePendingRouteRef = useRef<RouteIdentity | null>(null)
  const globalLanguageTriggerRef = useRef<HTMLButtonElement>(null)
  const pendingPageLanguageOpenRef = useRef<PendingPageLanguageOpen | null>(
    null,
  )
  const invalidateGlobalLanguageIntent = useCallback(() => {
    globalLanguageIntentRef.current += 1
    globalLanguagePendingRouteRef.current = null
    setGlobalLanguageLoadingRoute(null)
    setGlobalLanguageErrorRoute(null)
    setGlobalLanguageOpenRoute(null)
  }, [])

  const resetSearch = useCallback(() => {
    setQuery("")
    setSearchResetToken((token) => token + 1)
  }, [])

  const setOpen = useCallback(
    (next: boolean) => {
      if (closingTimerRef.current) {
        clearTimeout(closingTimerRef.current)
        closingTimerRef.current = null
      }
      if (next) {
        pendingPageLanguageOpenRef.current = null
        invalidateGlobalLanguageIntent()
        setClosing(false)
        setOpenState(true)
      } else {
        resetSearch()
        setClosing(true)
        closingTimerRef.current = setTimeout(() => {
          setOpenState(false)
          setClosing(false)
          closingTimerRef.current = null
        }, WATCH_MODAL_CLOSE_DELAY_MS)
      }
    },
    [invalidateGlobalLanguageIntent, resetSearch],
  )

  useEffect(() => {
    return () => {
      globalLanguageIntentRef.current += 1
      globalLanguagePendingRouteRef.current = null
      if (closingTimerRef.current) clearTimeout(closingTimerRef.current)
    }
  }, [])

  useEffect(
    () =>
      scheduleWatchInteractionWarmup({
        globalLanguage: true,
        globalLanguageOptions: false,
        interactionKeys: [],
      }),
    [],
  )

  const enableSearchController = useCallback(() => {
    setSearchControllerEnabled(true)
    void loadWatchInteraction("search").catch(() => {})
  }, [])

  const openSearch = useCallback(() => {
    enableSearchController()
    setOpen(true)
  }, [enableSearchController, setOpen])

  const markSearchControllerReady = useCallback(() => {
    setSearchControllerReady(true)
  }, [])

  useEffect(() => {
    if (!searchControllerEnabled) return
    void loadWatchInteraction("search").catch(() => {})
  }, [searchControllerEnabled])

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = ""
    }
  }, [open])

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

  useEffect(() => {
    if (open) return
    if (typeof window === "undefined") return

    let frame = 0
    const updateHeaderScrollState = () => {
      const currentY = window.scrollY
      const hero = document.querySelector<HTMLElement>(
        '[data-testid="hero-player-wrapper"], [data-testid="series-hero-static"], [data-testid="watch-home-tv-carousel"]',
      )
      const heroBottom = hero
        ? hero.offsetTop +
          Math.max(hero.offsetHeight, hero.getBoundingClientRect().height)
        : Math.max(window.innerHeight, 1)
      const overHero = currentY < heroBottom - 24
      const scrollingUp = currentY < lastScrollYRef.current - 4
      const scrollingDown = currentY > lastScrollYRef.current + 4

      setHeaderOverHero(overHero)
      if (overHero || scrollingUp || currentY < 24) {
        setHeaderScrollVisible(true)
      } else if (scrollingDown) {
        setHeaderScrollVisible(false)
      }

      lastScrollYRef.current = currentY
    }
    const onScroll = () => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(() => {
        updateHeaderScrollState()
        frame = 0
      })
    }

    updateHeaderScrollState()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [open, pathname])

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
      const ownerToken = detail.ownerToken ?? null
      const visible = detail.visible && typeof detail.onClick === "function"

      setHeaderLanguageSwitcher((current) => {
        if (!visible) {
          const cleanupMatches = ownerToken
            ? current.ownerToken === ownerToken
            : current.ownerToken === null
          return cleanupMatches
            ? {
                visible: false,
                onClick: null,
                languageCode: null,
                ownerToken: null,
                pathname: null,
              }
            : current
        }

        return {
          visible: true,
          onClick: detail.onClick,
          languageCode: detail.languageCode ?? null,
          ownerToken,
          pathname,
        }
      })
      if (visible) invalidateGlobalLanguageIntent()
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
  }, [invalidateGlobalLanguageIntent, pathname])

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
      setHeaderScrollVisible(true)
      setHeaderOverHero(true)
      lastScrollYRef.current = window.scrollY
    })
    return () => window.cancelAnimationFrame(frame)
  }, [pathname])

  const globalLanguageOpen = globalLanguageOpenRoute === routeIdentity

  const openGlobalLanguage = useCallback(() => {
    if (
      globalLanguagePendingRouteRef.current === routeIdentity ||
      globalLanguageOpen
    ) {
      return
    }
    if (open || closing) setOpen(false)

    const intent = globalLanguageIntentRef.current + 1
    globalLanguageIntentRef.current = intent
    globalLanguagePendingRouteRef.current = routeIdentity
    setGlobalLanguageLoadingRoute(routeIdentity)
    setGlobalLanguageErrorRoute(null)

    void loadWatchInteraction("global-language")
      .then(() => {
        if (globalLanguageIntentRef.current === intent) {
          setGlobalLanguageOpenRoute(routeIdentity)
        }
      })
      .catch(() => {
        if (globalLanguageIntentRef.current === intent) {
          setGlobalLanguageErrorRoute(routeIdentity)
        }
      })
      .finally(() => {
        if (globalLanguageIntentRef.current === intent) {
          globalLanguagePendingRouteRef.current = null
          setGlobalLanguageLoadingRoute(null)
        }
      })
  }, [closing, globalLanguageOpen, open, routeIdentity, setOpen])

  const closeGlobalLanguage = useCallback(() => {
    setGlobalLanguageOpenRoute(null)
  }, [])

  const openPageSpecificLanguage = useCallback(() => {
    const onClick = headerLanguageSwitcher.onClick
    if (onClick == null) return
    if (!open && !closing) {
      onClick()
      return
    }

    pendingPageLanguageOpenRef.current = {
      ownerToken: headerLanguageSwitcher.ownerToken,
      onClick,
      routeIdentity,
    }
    setOpen(false)
  }, [closing, headerLanguageSwitcher, open, routeIdentity, setOpen])

  useEffect(() => {
    if (open || closing) return
    const pending = pendingPageLanguageOpenRef.current
    if (pending == null) return
    pendingPageLanguageOpenRef.current = null
    if (
      pending.routeIdentity !== routeIdentity ||
      !headerLanguageSwitcher.visible ||
      headerLanguageSwitcher.pathname !== pathname ||
      headerLanguageSwitcher.ownerToken !== pending.ownerToken ||
      headerLanguageSwitcher.onClick !== pending.onClick
    ) {
      return
    }
    pending.onClick()
  }, [closing, headerLanguageSwitcher, open, pathname, routeIdentity])

  const modalChromeHidden = open || closing
  const handleLogoClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (modalChromeHidden) {
        event.preventDefault()
        if (!closing) setOpen(false)
        return
      }
      resetSearch()
    },
    [closing, modalChromeHidden, resetSearch, setOpen],
  )
  useWatchModalActivity(modalChromeHidden, { releaseDelayMs: 0 })
  const playerPlayingWithSound =
    playerPlaybackState.playing && !playerPlaybackState.muted
  const pageSpecificLanguageSwitcherActive =
    headerLanguageSwitcher.pathname === pathname &&
    headerLanguageSwitcher.visible &&
    headerLanguageSwitcher.onClick != null
  const headerLanguageClick = pageSpecificLanguageSwitcherActive
    ? openPageSpecificLanguage
    : openGlobalLanguage
  const headerLanguageControlVisible = true
  const headerLanguageCode = pageSpecificLanguageSwitcherActive
    ? (headerLanguageSwitcher.languageCode ?? currentLanguageCode)
    : currentLanguageCode
  const headerLanguageBusy =
    !pageSpecificLanguageSwitcherActive &&
    globalLanguageLoadingRoute === routeIdentity
  const globalLanguageLoadFailed =
    !pageSpecificLanguageSwitcherActive &&
    globalLanguageErrorRoute === routeIdentity
  const globalLanguageLabel = globalLanguageLoadFailed
    ? `${t("changeAudioLanguage")}. ${searchT("connectionHint")}`
    : t("changeAudioLanguage")
  const headerHoverZoneActive =
    !modalChromeHidden &&
    (playerPlayingWithSound || playerChromeOpacity < 1 || !playerChromeVisible)
  const effectiveHeaderHovered = headerHoverZoneActive && headerHovered
  const headerChromeOpacity =
    effectiveHeaderHovered && playerChromeOpacity <= 0 ? 1 : playerChromeOpacity
  const headerChromeUnavailable = !modalChromeHidden && headerChromeOpacity <= 0
  const headerChromeHidden =
    headerChromeUnavailable || (!modalChromeHidden && !headerScrollVisible)
  const headerChromeDimmed =
    !modalChromeHidden && !headerChromeHidden && headerChromeOpacity < 1
  const searchChromeVisible = !headerChromeUnavailable
  const searchChromeDimmed = headerChromeDimmed
  const headerCanBrightenLocally = playerChromeOpacity <= 0
  const headerPointerRevealAllowed = playerChromeOpacity < 1
  const headerSurfaceSolid = modalChromeHidden || !headerOverHero || pinned
  const headerTopClass = pinned
    ? FLOATING_HEADER_PINNED_TOP_CLASS
    : FLOATING_HEADER_TOP_CLASS
  const headerMotionClass = modalChromeHidden
    ? "pointer-events-none translate-y-0 opacity-100"
    : headerChromeUnavailable
      ? "pointer-events-none -translate-y-[calc(100%+2rem)] opacity-0"
      : !headerScrollVisible
        ? "pointer-events-none -translate-y-[calc(100%+2rem)] opacity-100"
        : headerChromeDimmed
          ? "pointer-events-auto translate-y-0 opacity-30"
          : "pointer-events-auto translate-y-0 opacity-100"
  const headerBackdropMotionClass = headerChromeUnavailable
    ? "-translate-y-[calc(100%+2rem)] opacity-0"
    : !headerScrollVisible
      ? "-translate-y-[calc(100%+2rem)] opacity-100"
      : headerSurfaceSolid
        ? "translate-y-0 opacity-100 md:-translate-y-[72%]"
        : "translate-y-0 opacity-100"

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
    <WatchRouteSurfaceContext.Provider value={routeSurfaceValue}>
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
          className={`pointer-events-none fixed inset-x-0 top-0 z-40 h-[calc(4.75rem+env(safe-area-inset-top,0px))] backdrop-blur-[14px] transition-[opacity,background-color,translate,backdrop-filter] duration-500 ease-[cubic-bezier(0.2,0.9,0.2,1)] md:h-[calc(8rem+env(safe-area-inset-top,0px))] md:backdrop-blur-none compact-landscape:h-[calc(4.25rem+env(safe-area-inset-top,0px))] compact-landscape:backdrop-blur-[14px] ${
            headerSurfaceSolid
              ? "bg-black/72 shadow-[0_1px_0_rgba(255,255,255,0.08)] md:bg-[linear-gradient(180deg,rgba(8,16,24,0.46)_0%,rgba(28,56,72,0.22)_44%,rgba(28,56,72,0.08)_72%,rgba(28,56,72,0)_100%)] md:shadow-none md:[mask-image:linear-gradient(to_bottom,black_0%,black_56%,transparent_100%)]"
              : "bg-[linear-gradient(180deg,rgba(8,16,24,0.46)_0%,rgba(28,56,72,0.22)_44%,rgba(28,56,72,0.08)_72%,rgba(28,56,72,0)_100%)] [mask-image:linear-gradient(to_bottom,black_0%,black_56%,transparent_100%)]"
          } ${headerBackdropMotionClass}`}
        />
        <div
          aria-hidden="true"
          data-testid="floating-header-hover-zone"
          onPointerEnter={handleHeaderPointerEnter}
          className={`fixed inset-x-0 top-0 z-[45] h-[calc(5.5rem+env(safe-area-inset-top,0px))] md:h-[calc(9rem+env(safe-area-inset-top,0px))] compact-landscape:h-[calc(4.25rem+env(safe-area-inset-top,0px))] ${
            headerHoverZoneActive
              ? "pointer-events-auto"
              : "pointer-events-none"
          }`}
        />
        <header
          data-testid="floating-header"
          inert={headerChromeHidden || undefined}
          aria-hidden={headerChromeHidden || undefined}
          className={`fixed ${WATCH_PAGE_LEFT_EDGE_CLASSES} ${WATCH_PAGE_RIGHT_EDGE_CLASSES} ${headerTopClass} z-50 ${
            modalChromeHidden
              ? FLOATING_MODAL_HEADER_LAYOUT_CLASS
              : FLOATING_HEADER_LAYOUT_CLASS
          } transition-[top,opacity,translate] duration-500 ease-[cubic-bezier(0.2,0.9,0.2,1)] ${headerMotionClass}`}
        >
          <Link
            href={logoHref as Route}
            aria-label={modalChromeHidden ? t("closeSearch") : t("home")}
            data-testid="floating-header-logo"
            onClick={handleLogoClick}
            className={`pointer-events-auto flex ${logoSlotClass} ${
              modalChromeHidden ? FLOATING_MODAL_HEADER_LOGO_POSITION_CLASS : ""
            } items-center justify-start transition-opacity duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80`}
          >
            <Image
              src={
                isWatchHome
                  ? "/watch/images/jesus-film-logo-full.svg"
                  : "/watch/images/jesusfilm-sign.svg"
              }
              alt="JesusFilm"
              width={isWatchHome ? 139 : 70}
              height={isWatchHome ? 36 : 70}
              unoptimized
              className={
                isWatchHome
                  ? "h-auto w-20 drop-shadow-md sm:w-28 md:w-[139px]"
                  : "h-auto max-w-[38px] drop-shadow-md sm:max-w-[50px] lg:max-w-[70px]"
              }
            />
          </Link>
          <div
            className={`${FLOATING_HEADER_FIELD_WIDTH_CLASS} ${
              modalChromeHidden
                ? `${FLOATING_MODAL_HEADER_FIELD_POSITION_CLASS} ${
                    headerLanguageControlVisible ? "" : "col-span-2"
                  }`
                : ""
            }`}
          >
            <FloatingSearchBar
              open={open}
              closing={closing}
              query={query}
              onOpen={openSearch}
            />
          </div>
          <div
            data-testid="floating-header-trailing-controls"
            className={
              modalChromeHidden
                ? FLOATING_MODAL_HEADER_TRAILING_GROUP_CLASS
                : `pointer-events-auto ${FLOATING_HEADER_TRAILING_GROUP_CLASS}`
            }
          >
            {headerLanguageControlVisible ? (
              <button
                type="button"
                ref={globalLanguageTriggerRef}
                data-testid="floating-header-language-button"
                onClick={headerLanguageClick}
                aria-busy={headerLanguageBusy}
                disabled={headerLanguageBusy}
                aria-label={globalLanguageLabel}
                title={globalLanguageLabel}
                className={`pointer-events-auto inline-flex ${FLOATING_HEADER_LANGUAGE_SLOT_CLASS} ${
                  modalChromeHidden
                    ? FLOATING_MODAL_HEADER_LANGUAGE_POSITION_CLASS
                    : ""
                } cursor-pointer items-center justify-center rounded-full text-stone-100 transition-[color,transform] duration-300 ease-out hover:text-white focus-visible:ring-2 focus-visible:ring-stone-300 focus-visible:outline-none ${
                  headerLanguageCode
                    ? "w-auto min-w-[4.25rem] gap-1.5 px-2 md:w-auto md:min-w-[4.75rem]"
                    : ""
                }`}
              >
                <Globe
                  aria-hidden
                  className="h-6 w-6 drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.35)]"
                />
                {headerLanguageCode ? (
                  <span
                    data-testid="floating-header-language-code"
                    className="text-[10px] font-bold tracking-[0.14em]"
                  >
                    {headerLanguageCode}
                  </span>
                ) : null}
              </button>
            ) : null}
            {globalLanguageLoadFailed ? (
              <span
                role="status"
                data-testid="global-language-picker-load-error"
                className="sr-only"
              >
                {searchT("connectionHint")}
              </span>
            ) : null}
            {modalChromeHidden ? (
              <button
                type="button"
                aria-label={t("closeSearch")}
                data-testid="floating-header-search-close"
                onClick={() => setOpen(false)}
                className={`pointer-events-auto inline-flex ${FLOATING_HEADER_TRAILING_SLOT_CLASS} ${FLOATING_MODAL_HEADER_CLOSE_POSITION_CLASS} cursor-pointer items-center justify-center rounded-full text-stone-100 transition-[color,transform] duration-300 ease-out hover:text-white focus-visible:ring-2 focus-visible:ring-stone-300 focus-visible:outline-none`}
              >
                <X
                  aria-hidden
                  className="h-6 w-6 drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.35)]"
                />
              </button>
            ) : (
              <AccountControl />
            )}
          </div>
        </header>
        {searchControllerEnabled ? (
          <LazyFloatingSearchController
            open={open}
            closing={closing}
            query={query}
            setOpen={setOpen}
            setQuery={setQuery}
            headerLanguageSwitcherVisible={headerLanguageControlVisible}
            headerLanguageCode={headerLanguageCode}
            headerPinned={pinned}
            resetToken={searchResetToken}
            onReady={markSearchControllerReady}
          />
        ) : null}
        {modalChromeHidden && !searchControllerReady ? (
          <SearchOverlayInstantShell
            open={open}
            closing={closing}
            query={query}
            setOpen={setOpen}
            setQuery={setQuery}
            headerTopClass={headerTopClass}
            logoSlotClass={logoSlotClass}
            headerLanguageControlVisible={headerLanguageControlVisible}
          />
        ) : null}
        {globalLanguageOpen && !modalChromeHidden ? (
          <LazyGlobalLanguagePickerModal
            open={globalLanguageOpen}
            pathname={pathname}
            currentLanguageSlug={currentLanguageSlug}
            onClose={closeGlobalLanguage}
            returnFocusRef={globalLanguageTriggerRef}
          />
        ) : null}
      </FloatingSearchPinnedContext.Provider>
    </WatchRouteSurfaceContext.Provider>
  )
}
