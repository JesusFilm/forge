"use client"

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  CornerDownLeft,
  Folder,
  Languages,
  ListVideo,
  PlaySquare,
  Search,
} from "lucide-react"

import {
  useFloatingSearch,
  useWatchRouteSurface,
} from "./FloatingSearchContext"
import {
  FloatingSearchFieldInput,
  useFloatingSearchInputAutofocus,
} from "./FloatingSearchField"
import { CATEGORY_ICON_BY_SEARCH_TERM } from "./SearchCategoryIcons"
import { VideoCard } from "./search/VideoCard"
import { reportDatadogRumAction } from "@/components/DatadogRum"
import { SpinnerIcon } from "@/components/ui/spinner"
import {
  recordWatchSearchResultClick,
  recordWatchSearchResultsViewed,
} from "@/lib/search-actions"
import {
  LanguageCombobox,
  type LanguageComboboxOption,
} from "@/components/watch/LanguageCombobox"
import { CATEGORIES } from "@/lib/search-categories"
import {
  FLOATING_HEADER_FIELD_WIDTH_CLASS,
  FLOATING_HEADER_HOME_LOGO_SLOT_CLASS,
  FLOATING_HEADER_LANGUAGE_SLOT_CLASS,
  FLOATING_HEADER_LOGO_SLOT_CLASS,
  FLOATING_HEADER_PINNED_TOP_CLASS,
  FLOATING_HEADER_TOP_CLASS,
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
import type { CategorySearchTerm } from "@/lib/search-categories"
import type { SearchLanguageOption } from "@/lib/search-language"
import { localizedSearchLanguageName } from "@/lib/search-language-display-name"
import {
  parseWatchPath,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchVideoPath,
} from "@/lib/routes"
import { videoLabelMessageKey } from "@/lib/video-labels"
import { WATCH_SEARCH_RUM_RESULT_CLICKED_ACTION } from "@/lib/watch-search-analytics-contract"
import { buildWatchSearchResultClickRumContext } from "@/lib/watch-search-rum"
import { normalizeWatchSearchQuery } from "@/lib/watch-search-query"
import {
  fetchWatchSearchSuggestions,
  type WatchSearchSuggestion,
} from "@/lib/watch-search-client"

const SEARCH_SUGGESTIONS_DEBOUNCE_MS = 180
const SEARCH_SUGGESTIONS_VIEWPORT_GAP = 8
const SEARCH_SUGGESTIONS_VIEWPORT_PADDING = 16
const SEARCH_SUGGESTION_DESCRIPTION_LENGTH = 96
const SEARCH_SUGGESTION_DESCRIPTION_CONTEXT_BEFORE = 18
const MEANINGFUL_SEARCH_CHARACTER = /[\p{L}\p{N}]/u

type SuggestionListPosition = {
  height: number
  left: number
  top: number
  width: number
}

type SuggestionResult = {
  requestKey: string
  suggestions: WatchSearchSuggestion[]
}

type SuggestionDescriptionParts = {
  before: string
  match: string | null
  after: string
}

type SuggestionSection = {
  id: "query" | "titles" | "collections" | "scenes"
  label: string
  icon: typeof Search
  rows: Array<{ suggestion: WatchSearchSuggestion; index: number }>
}

type SuggestionGroup = {
  id: "suggestions" | "direct-matches"
  label: string
  sections: SuggestionSection[]
}

function suggestionContentSection(
  label: WatchSearchSuggestion["label"],
): Exclude<SuggestionSection["id"], "query"> {
  if (label === "COLLECTION" || label === "SERIES") return "collections"
  if (label === "SEGMENT" || label === "BEHIND_THE_SCENES") return "scenes"
  return "titles"
}

function escapedRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function findSuggestionMatch(
  value: string,
  query: string,
): RegExpExecArray | null {
  const normalizedQuery = normalizeWatchSearchQuery(query)
  if (!normalizedQuery) return null
  return new RegExp(escapedRegularExpression(normalizedQuery), "iu").exec(value)
}

function suggestionDescriptionParts(
  description: string,
  query: string,
): SuggestionDescriptionParts {
  const initialMatch = findSuggestionMatch(description, query)
  let start = 0
  let end = Math.min(description.length, SEARCH_SUGGESTION_DESCRIPTION_LENGTH)
  if (initialMatch) {
    start = Math.max(
      0,
      initialMatch.index - SEARCH_SUGGESTION_DESCRIPTION_CONTEXT_BEFORE,
    )
    end = Math.min(
      description.length,
      Math.max(
        initialMatch.index + initialMatch[0].length + 40,
        start + SEARCH_SUGGESTION_DESCRIPTION_LENGTH,
      ),
    )
  }
  const excerpt = `${start > 0 ? "…" : ""}${description
    .slice(start, end)
    .trim()}${end < description.length ? "…" : ""}`
  const match = findSuggestionMatch(excerpt, query)
  if (!match) return { before: excerpt, match: null, after: "" }
  return {
    before: excerpt.slice(0, match.index),
    match: match[0],
    after: excerpt.slice(match.index + match[0].length),
  }
}

function hasEnoughMeaningfulSearchCharacters(value: string): boolean {
  let count = 0
  for (const character of value) {
    if (MEANINGFUL_SEARCH_CHARACTER.test(character) && ++count >= 2) {
      return true
    }
  }
  return false
}

const CATEGORY_TITLE_KEYS: Record<
  CategorySearchTerm,
  | "categoryBibleStories"
  | "categoryParables"
  | "categoryAnimated"
  | "categoryStudy"
  | "categoryFamily"
  | "categoryChristmas"
> = {
  "bible stories": "categoryBibleStories",
  parables: "categoryParables",
  animated: "categoryAnimated",
  study: "categoryStudy",
  family: "categoryFamily",
  christmas: "categoryChristmas",
}

export function SearchOverlay() {
  const t = useTranslations("SearchOverlay")
  const floatingSearchT = useTranslations("FloatingSearch")
  const videoLabels = useTranslations("VideoLabels")
  const uiLocale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const parsedPath = parseWatchPath(pathname)
  const routeSurface = useWatchRouteSurface()
  const isWatchHome =
    routeSurface == null
      ? parsedPath.kind === "home" || parsedPath.kind === "localized-home"
      : routeSurface === "language-home" || routeSurface === "experience"
  const logoSlotClass = isWatchHome
    ? FLOATING_HEADER_HOME_LOGO_SLOT_CLASS
    : FLOATING_HEADER_LOGO_SLOT_CLASS
  const {
    open,
    closing,
    query,
    submittedQuery,
    displayResults,
    exiting,
    resultsKey,
    hasMore,
    loading,
    showSkeleton,
    loadingMore,
    error,
    errorKind,
    searched,
    languageOptions,
    languageOptionsLoading,
    languageOptionsError,
    selectedSearchLanguageOption,
    defaultSearchLanguageOption,
    searchResultAnalytics,
    headerLanguageSwitcherVisible,
    headerLanguageCode,
    headerPinned,
    languageVideosHref,
    setOpen,
    setQuery,
    search,
    loadMore,
    selectSearchLanguage,
  } = useFloatingSearch()

  const overlayRef = useRef<HTMLDivElement>(null)
  const [closePortalContainer, setClosePortalContainer] =
    useState<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fieldShellRef = useRef<HTMLDivElement>(null)
  const suggestionPanelRef = useRef<HTMLDivElement>(null)
  const suggestionListRef = useRef<HTMLDivElement>(null)
  const suggestionListId = `${useId()}-search-suggestions`
  const recordedResultClickKeysRef = useRef<Set<string>>(new Set())
  const recordedResultsViewedKeysRef = useRef<Map<string, Set<string>>>(
    new Map(),
  )
  const [languageAutocompleteOpen, setLanguageAutocompleteOpen] =
    useState(false)
  const [suggestionResult, setSuggestionResult] =
    useState<SuggestionResult | null>(null)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionPanelVisible, setSuggestionPanelVisible] = useState(true)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<
    number | null
  >(null)
  const [isComposing, setIsComposing] = useState(false)
  const [suppressedSuggestionValue, setSuppressedSuggestionValue] = useState<
    string | null
  >(null)
  const [suggestionListPosition, setSuggestionListPosition] =
    useState<SuggestionListPosition | null>(null)
  const suggestionGenerationRef = useRef(0)
  const activeSubmissionKeyRef = useRef<string | null>(null)
  const suggestionTouchGestureRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    moved: boolean
  } | null>(null)
  const clearSuggestionRows = useCallback(() => {
    setSuggestionResult((current) => (current == null ? current : null))
  }, [])
  const invalidateSuggestionRequest = useCallback(() => {
    suggestionGenerationRef.current += 1
    clearSuggestionRows()
    setSuggestionsLoading(false)
    setActiveSuggestionIndex(null)
  }, [clearSuggestionRows])

  const setOverlayElement = useCallback((node: HTMLDivElement | null) => {
    overlayRef.current = node
    setClosePortalContainer(node)
  }, [])

  useFloatingSearchInputAutofocus(open, inputRef)

  const suggestionLanguageSlug =
    selectedSearchLanguageOption?.publicSlug ??
    defaultSearchLanguageOption?.publicSlug ??
    null
  const normalizedSuggestionQuery = normalizeWatchSearchQuery(query)
  const normalizedSubmittedQuery =
    submittedQuery == null ? null : normalizeWatchSearchQuery(submittedQuery)
  const submittedSearchLanguageMatchesSelection =
    searchResultAnalytics != null &&
    (searchResultAnalytics.searchLanguageSlug === suggestionLanguageSlug ||
      (searchResultAnalytics.searchLanguageSlug == null &&
        selectedSearchLanguageOption == null))
  const searchIntentMatchesCompletedResults =
    normalizedSuggestionQuery.length > 0 &&
    normalizedSuggestionQuery === normalizedSubmittedQuery &&
    submittedSearchLanguageMatchesSelection
  const hasUnsubmittedSearchIntent =
    normalizedSuggestionQuery.length > 0 && !searchIntentMatchesCompletedResults
  const suggestionRequestKey =
    open &&
    !closing &&
    !isComposing &&
    suggestionLanguageSlug != null &&
    hasEnoughMeaningfulSearchCharacters(normalizedSuggestionQuery) &&
    normalizedSuggestionQuery !== normalizedSubmittedQuery &&
    query !== suppressedSuggestionValue
      ? `${suggestionLanguageSlug}\0${normalizedSuggestionQuery}`
      : null
  const suggestions = useMemo(
    () =>
      suggestionResult?.requestKey === suggestionRequestKey
        ? suggestionResult.suggestions
        : [],
    [suggestionRequestKey, suggestionResult],
  )
  const visibleSuggestionsLoading =
    suggestionRequestKey != null && suggestionsLoading
  const searchLanguageControlVisible =
    languageOptionsLoading ||
    languageOptions.length > 0 ||
    languageOptionsError != null
  const suggestionPanelActive =
    suggestionRequestKey != null ||
    visibleSuggestionsLoading ||
    suggestions.length > 0
  const suggestionPanelHasContent =
    (suggestionPanelActive || languageAutocompleteOpen) &&
    (searchLanguageControlVisible ||
      visibleSuggestionsLoading ||
      suggestions.length > 0)
  const languagePickerOwnedByContextRow =
    languageAutocompleteOpen && !suggestionPanelActive
  const suggestionSections = useMemo<SuggestionSection[]>(() => {
    const indexed = suggestions.map((suggestion, index) => ({
      suggestion,
      index,
    }))
    const sections: SuggestionSection[] = [
      {
        id: "query",
        label: t("searchSuggestions"),
        icon: Search,
        rows: indexed.filter(({ suggestion }) => suggestion.kind === "query"),
      },
      {
        id: "titles",
        label: videoLabels("video"),
        icon: PlaySquare,
        rows: indexed.filter(
          ({ suggestion }) =>
            suggestion.kind === "content" &&
            suggestionContentSection(suggestion.label) === "titles",
        ),
      },
      {
        id: "collections",
        label: videoLabels("collection"),
        icon: Folder,
        rows: indexed.filter(
          ({ suggestion }) =>
            suggestion.kind === "content" &&
            suggestionContentSection(suggestion.label) === "collections",
        ),
      },
      {
        id: "scenes",
        label: videoLabels("segment"),
        icon: BookOpen,
        rows: indexed.filter(
          ({ suggestion }) =>
            suggestion.kind === "content" &&
            suggestionContentSection(suggestion.label) === "scenes",
        ),
      },
    ]
    return sections.filter((section) => section.rows.length > 0)
  }, [suggestions, t, videoLabels])
  const suggestionGroups = useMemo<SuggestionGroup[]>(() => {
    const querySections = suggestionSections.filter(
      (section) => section.id === "query",
    )
    const directMatchSections = suggestionSections.filter(
      (section) => section.id !== "query",
    )

    return [
      {
        id: "suggestions",
        label: t("searchSuggestions"),
        sections: querySections,
      },
      {
        id: "direct-matches",
        label: t("directMatches"),
        sections: directMatchSections,
      },
    ].filter((group) => group.sections.length > 0) as SuggestionGroup[]
  }, [suggestionSections, t])
  const suggestionNavigationOrder = useMemo(
    () =>
      suggestionSections.flatMap((section) =>
        section.rows.map(({ index }) => index),
      ),
    [suggestionSections],
  )

  useEffect(() => {
    activeSubmissionKeyRef.current = null
  }, [query, suggestionLanguageSlug])

  useLayoutEffect(() => {
    suggestionGenerationRef.current += 1
  }, [suggestionRequestKey])

  useEffect(() => {
    if (suggestionRequestKey == null || suggestionLanguageSlug == null) return

    const controller = new AbortController()
    let cancelled = false
    const generation = suggestionGenerationRef.current
    const timer = window.setTimeout(() => {
      if (cancelled || generation !== suggestionGenerationRef.current) return
      setSuggestionsLoading(true)
      void fetchWatchSearchSuggestions({
        query: normalizedSuggestionQuery,
        languageSlug: suggestionLanguageSlug,
        signal: controller.signal,
      })
        .then((nextSuggestions) => {
          if (cancelled || generation !== suggestionGenerationRef.current)
            return
          setSuggestionResult({
            requestKey: suggestionRequestKey,
            suggestions: nextSuggestions,
          })
        })
        .catch(() => {
          if (cancelled || generation !== suggestionGenerationRef.current)
            return
          clearSuggestionRows()
        })
        .finally(() => {
          if (cancelled || generation !== suggestionGenerationRef.current)
            return
          setSuggestionsLoading(false)
        })
    }, SEARCH_SUGGESTIONS_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [
    clearSuggestionRows,
    normalizedSuggestionQuery,
    suggestionLanguageSlug,
    suggestionRequestKey,
  ])

  useLayoutEffect(() => {
    if (
      !open ||
      !suggestionPanelVisible ||
      (!suggestionPanelHasContent && !searchLanguageControlVisible)
    )
      return

    const updatePosition = () => {
      const fieldShell = fieldShellRef.current
      if (!fieldShell) return
      const rect = fieldShell.getBoundingClientRect()
      const visualViewport = window.visualViewport
      const viewportLeft = visualViewport?.offsetLeft ?? 0
      const viewportTop = visualViewport?.offsetTop ?? 0
      const viewportWidth = visualViewport?.width ?? window.innerWidth
      const viewportHeight = visualViewport?.height ?? window.innerHeight
      const viewportRight = viewportLeft + viewportWidth
      const viewportBottom = viewportTop + viewportHeight
      const top = rect.bottom + SEARCH_SUGGESTIONS_VIEWPORT_GAP
      const height = Math.max(
        0,
        viewportBottom - top - SEARCH_SUGGESTIONS_VIEWPORT_PADDING,
      )
      const width = Math.max(
        0,
        Math.min(
          rect.width,
          viewportWidth - SEARCH_SUGGESTIONS_VIEWPORT_PADDING * 2,
        ),
      )
      const left = Math.min(
        Math.max(rect.left, viewportLeft + SEARCH_SUGGESTIONS_VIEWPORT_PADDING),
        viewportRight - width - SEARCH_SUGGESTIONS_VIEWPORT_PADDING,
      )

      setSuggestionListPosition((current) => {
        if (
          current?.left === left &&
          current.top === top &&
          current.width === width &&
          current.height === height
        ) {
          return current
        }
        return { height, left, top, width }
      })
    }

    updatePosition()
    let animationFrame: number | null = null
    const schedulePositionUpdate = () => {
      if (animationFrame != null) return
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null
        updatePosition()
      })
    }
    const visualViewport = window.visualViewport
    window.addEventListener("resize", schedulePositionUpdate, { passive: true })
    visualViewport?.addEventListener("resize", schedulePositionUpdate, {
      passive: true,
    })
    visualViewport?.addEventListener("scroll", schedulePositionUpdate, {
      passive: true,
    })
    return () => {
      if (animationFrame != null) window.cancelAnimationFrame(animationFrame)
      window.removeEventListener("resize", schedulePositionUpdate)
      visualViewport?.removeEventListener("resize", schedulePositionUpdate)
      visualViewport?.removeEventListener("scroll", schedulePositionUpdate)
    }
  }, [
    open,
    searchLanguageControlVisible,
    suggestionPanelHasContent,
    suggestionPanelVisible,
  ])

  useEffect(() => {
    if (activeSuggestionIndex == null) return
    const activeOption = suggestionListRef.current?.querySelector<HTMLElement>(
      `[data-suggestion-index="${activeSuggestionIndex}"]`,
    )
    if (typeof activeOption?.scrollIntoView === "function") {
      activeOption.scrollIntoView({ block: "nearest" })
    }
  }, [activeSuggestionIndex])

  // Escape closes the modal through the provider-owned reset boundary.
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        invalidateSuggestionRequest()
        setOpen(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [invalidateSuggestionRequest, open, setOpen])

  // Body scroll lock — prevents the page behind from scrolling while modal open.
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = ""
    }
  }, [open])

  // Focus trap — keep Tab cycling inside the overlay.
  useEffect(() => {
    if (!open) return
    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return
      const overlay = overlayRef.current
      if (!overlay) return
      const overlayFocusable = Array.from(
        overlay.querySelectorAll<HTMLElement>(
          'input, button, a[href], [tabindex]:not([tabindex="-1"])',
        ),
      )
      const headerLogo = document.querySelector<HTMLElement>(
        '[data-testid="floating-header-logo"]',
      )
      const headerLanguage = document.querySelector<HTMLElement>(
        '[data-testid="floating-header-language-button"]',
      )
      const headerClose = document.querySelector<HTMLElement>(
        '[data-testid="floating-header-search-close"]',
      )
      const focusable = [
        headerLogo,
        ...overlayFocusable,
        headerLanguage,
        headerClose,
      ].filter((element): element is HTMLElement => element != null)
      if (focusable.length === 0) return
      const activeIndex = focusable.indexOf(
        document.activeElement as HTMLElement,
      )
      const nextIndex = e.shiftKey
        ? activeIndex <= 0
          ? focusable.length - 1
          : activeIndex - 1
        : activeIndex === -1 || activeIndex >= focusable.length - 1
          ? 0
          : activeIndex + 1
      e.preventDefault()
      focusable[nextIndex]?.focus()
    }
    document.addEventListener("keydown", handleTab)
    return () => document.removeEventListener("keydown", handleTab)
  }, [open])

  const visibleResultIds = useMemo(
    () => displayResults.map((row) => row.id),
    [displayResults],
  )

  useEffect(() => {
    if (!searchResultAnalytics || visibleResultIds.length === 0) return
    const requestId = searchResultAnalytics.searchRequestId
    const recordedIds =
      recordedResultsViewedKeysRef.current.get(requestId) ?? new Set<string>()
    const newlyVisibleResultIds = visibleResultIds.filter(
      (id) => !recordedIds.has(id),
    )
    if (newlyVisibleResultIds.length === 0) return
    for (const id of newlyVisibleResultIds) {
      recordedIds.add(id)
    }
    recordedResultsViewedKeysRef.current.set(requestId, recordedIds)
    void recordWatchSearchResultsViewed({
      requestId,
      visibleResultIds: newlyVisibleResultIds,
      routeLanguageSlug: searchResultAnalytics.routeLanguageSlug,
      searchLanguageSlug: searchResultAnalytics.searchLanguageSlug,
    })
  }, [searchResultAnalytics, visibleResultIds])

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setSuggestionPanelVisible(true)
      setSuppressedSuggestionValue(null)
      // The debounced fetch effect is keyed on the normalized query, so a
      // normalization-neutral keystroke (e.g. removing a trailing space)
      // must not bump the generation — that would orphan the pending
      // request without the effect ever rescheduling a replacement.
      if (
        normalizeWatchSearchQuery(e.target.value) !== normalizedSuggestionQuery
      ) {
        invalidateSuggestionRequest()
      }
      setQuery(e.target.value)
    },
    [invalidateSuggestionRequest, normalizedSuggestionQuery, setQuery],
  )

  const dismissSuggestions = useCallback(() => {
    setSuppressedSuggestionValue(query)
    invalidateSuggestionRequest()
  }, [invalidateSuggestionRequest, query])

  const hideSuggestionPanel = useCallback(() => {
    setSuggestionPanelVisible(false)
    setActiveSuggestionIndex(null)
  }, [])

  const handleInputBlur = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      if (suggestionTouchGestureRef.current != null) return
      const nextTarget = event.relatedTarget
      if (
        nextTarget instanceof Node &&
        (suggestionPanelRef.current?.contains(nextTarget) ||
          (nextTarget instanceof Element &&
            nextTarget.closest('[data-testid="language-combobox-popover"]') !=
              null))
      ) {
        return
      }
      hideSuggestionPanel()
    },
    [hideSuggestionPanel],
  )

  const handleInputFocus = useCallback(() => {
    setSuggestionPanelVisible(true)
  }, [])

  const handleSearchSubmit = useCallback(
    (submittedQuery: string) => {
      const normalizedQuery = normalizeWatchSearchQuery(submittedQuery)
      if (!normalizedQuery) return
      const submissionKey = `${suggestionLanguageSlug ?? ""}\0${normalizedQuery}`
      if (activeSubmissionKeyRef.current === submissionKey) return
      activeSubmissionKeyRef.current = submissionKey
      setSuppressedSuggestionValue(submittedQuery)
      invalidateSuggestionRequest()
      void search(submittedQuery).finally(() => {
        if (activeSubmissionKeyRef.current === submissionKey) {
          activeSubmissionKeyRef.current = null
        }
      })
    },
    [invalidateSuggestionRequest, search, suggestionLanguageSlug],
  )

  const selectSuggestion = useCallback(
    (suggestion: string) => {
      setQuery(suggestion)
      setSuppressedSuggestionValue(suggestion)
      invalidateSuggestionRequest()
      inputRef.current?.focus({ preventScroll: true })
    },
    [invalidateSuggestionRequest, setQuery],
  )

  const activateSuggestion = useCallback(
    (suggestion: WatchSearchSuggestion) => {
      if (suggestion.kind === "query") {
        selectSuggestion(suggestion.title)
        handleSearchSubmit(suggestion.title)
        return
      }
      const slug = suggestion.slug ? tryAsContentSlug(suggestion.slug) : null
      const language = tryAsLocaleSlug(suggestionLanguageSlug ?? "english")
      if (!slug || !language) {
        selectSuggestion(suggestion.title)
        return
      }
      invalidateSuggestionRequest()
      router.push(watchVideoPath(slug, language))
      setOpen(false)
    },
    [
      handleSearchSubmit,
      invalidateSuggestionRequest,
      router,
      selectSuggestion,
      setOpen,
      suggestionLanguageSlug,
    ],
  )

  const handleInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      const composing = isComposing || event.nativeEvent.isComposing
      if (event.key === "Enter" && composing) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (
        event.key === "ArrowDown" &&
        !languageAutocompleteOpen &&
        suggestionPanelVisible &&
        suggestionNavigationOrder.length > 0
      ) {
        event.preventDefault()
        setActiveSuggestionIndex((current) => {
          const currentPosition =
            current == null ? -1 : suggestionNavigationOrder.indexOf(current)
          const nextPosition =
            currentPosition < 0
              ? 0
              : (currentPosition + 1) % suggestionNavigationOrder.length
          return suggestionNavigationOrder[nextPosition] ?? null
        })
        return
      }

      if (
        event.key === "ArrowUp" &&
        !languageAutocompleteOpen &&
        suggestionPanelVisible &&
        suggestionNavigationOrder.length > 0
      ) {
        event.preventDefault()
        setActiveSuggestionIndex((current) => {
          const currentPosition =
            current == null ? -1 : suggestionNavigationOrder.indexOf(current)
          const nextPosition =
            currentPosition < 0
              ? suggestionNavigationOrder.length - 1
              : (currentPosition - 1 + suggestionNavigationOrder.length) %
                suggestionNavigationOrder.length
          return suggestionNavigationOrder[nextPosition] ?? null
        })
        return
      }

      if (
        event.key === "Enter" &&
        !languageAutocompleteOpen &&
        suggestionPanelVisible &&
        activeSuggestionIndex != null &&
        suggestions[activeSuggestionIndex]
      ) {
        event.preventDefault()
        event.stopPropagation()
        activateSuggestion(suggestions[activeSuggestionIndex])
        return
      }

      if (
        event.key === "Escape" &&
        suggestionPanelVisible &&
        (suggestions.length > 0 || visibleSuggestionsLoading)
      ) {
        event.preventDefault()
        event.stopPropagation()
        hideSuggestionPanel()
        return
      }

      if (
        event.key === "Tab" &&
        suggestionPanelVisible &&
        (suggestions.length > 0 || visibleSuggestionsLoading)
      ) {
        hideSuggestionPanel()
      }
    },
    [
      activeSuggestionIndex,
      activateSuggestion,
      hideSuggestionPanel,
      isComposing,
      languageAutocompleteOpen,
      suggestionPanelVisible,
      suggestionNavigationOrder,
      suggestions,
      visibleSuggestionsLoading,
    ],
  )

  const handleCategoryClick = useCallback(
    (query: string) => {
      dismissSuggestions()
      void search(query)
    },
    [dismissSuggestions, search],
  )

  const handleSemanticLanguageClick = useCallback(
    (language: SearchLanguageOption, regionName?: string) => {
      if (!language.publicSlug) return
      setSuppressedSuggestionValue(null)
      invalidateSuggestionRequest()
      setLanguageAutocompleteOpen(false)
      selectSearchLanguage(language, regionName)
    },
    [invalidateSuggestionRequest, selectSearchLanguage],
  )

  const closeAfterResultNavigation = useCallback(() => {
    window.setTimeout(() => setOpen(false), 0)
  }, [setOpen])

  const handleClearInput = useCallback(() => {
    activeSubmissionKeyRef.current = null
    dismissSuggestions()
    void search("")
    inputRef.current?.focus()
  }, [dismissSuggestions, search])

  const showCategoryGrid = query.trim().length === 0 && !loading && !searched
  const searchOverlayScrollTopClass =
    searchLanguageControlVisible && !suggestionPanelActive
      ? "top-56 md:top-44"
      : "top-44 md:top-32"
  const semanticLanguageTriggerClassName =
    "!h-auto !min-h-8 !w-auto !justify-start !rounded-lg !border !border-white/20 !bg-transparent !px-1.5 !py-0.5 !text-base sm:!text-sm !font-semibold !text-stone-100 !shadow-none hover:!border-white/40 hover:!bg-transparent focus-visible:!ring-white/45"
  const semanticLanguageComboboxOptions = useMemo<LanguageComboboxOption[]>(
    () =>
      languageOptions.flatMap((language) =>
        language.publicSlug
          ? [
              {
                slug: language.publicSlug,
                searchAliasSlug: language.aliasOwnerSlug ?? null,
                name: language.englishName,
                nativeName: language.nativeName,
                bcp47: language.bcp47,
              },
            ]
          : [],
      ),
    [languageOptions],
  )
  const semanticLanguageOptionBySlug = useMemo(() => {
    const bySlug = new Map<string, SearchLanguageOption>()
    for (const language of languageOptions) {
      if (language.publicSlug) bySlug.set(language.publicSlug, language)
    }
    return bySlug
  }, [languageOptions])
  const completedSearchLanguageSlug =
    searchResultAnalytics?.searchLanguageSlug ?? null
  const completedSearchLanguageOption = completedSearchLanguageSlug
    ? (semanticLanguageOptionBySlug.get(completedSearchLanguageSlug) ?? null)
    : null
  const completedSearchLanguageName = completedSearchLanguageOption
    ? localizedSearchLanguageName(
        completedSearchLanguageOption,
        uiLocale,
        t("searchLanguageLabel"),
        "standalone",
      )
    : (searchResultAnalytics?.searchLanguageEnglishName ?? null)
  const semanticLanguageComboboxValue =
    selectedSearchLanguageOption?.publicSlug ??
    defaultSearchLanguageOption?.publicSlug ??
    ""
  const languageContextMessage = t.raw(
    searchIntentMatchesCompletedResults
      ? "searchingInLanguage"
      : "searchInLanguage",
  ) as string
  const semanticLanguageOption =
    selectedSearchLanguageOption ?? defaultSearchLanguageOption
  const semanticLanguageName = localizedSearchLanguageName(
    semanticLanguageOption,
    uiLocale,
    t("searchLanguageLabel"),
    hasUnsubmittedSearchIntent || searchIntentMatchesCompletedResults
      ? "search-prepositional"
      : "standalone",
  )
  const semanticLanguageTriggerContent = (
    <span
      data-testid="searching-in-language-label"
      className="flex min-w-0 items-center gap-1"
    >
      <Languages
        aria-hidden
        data-testid="search-language-icon"
        className="h-3.5 w-3.5 shrink-0 text-stone-400"
      />
      <span className="truncate">{semanticLanguageName}</span>
      <ChevronDown
        aria-hidden
        data-testid="search-language-chevron"
        className={`h-3.5 w-3.5 shrink-0 text-stone-500 transition-transform duration-150 ${
          languageAutocompleteOpen ? "rotate-180" : ""
        }`}
      />
    </span>
  )

  const handleSemanticLanguageSlugChange = useCallback(
    (slug: string) => {
      const language = semanticLanguageOptionBySlug.get(slug)
      if (!language) return
      handleSemanticLanguageClick(language, language.regionNames[0])
    },
    [handleSemanticLanguageClick, semanticLanguageOptionBySlug],
  )
  const renderSemanticLanguageCombobox = (
    takeoverRect?: SuggestionListPosition,
  ) => (
    <span className="pointer-events-auto relative mx-1 inline-flex shrink-0">
      <LanguageCombobox
        options={semanticLanguageComboboxOptions}
        value={semanticLanguageComboboxValue}
        onChange={handleSemanticLanguageSlugChange}
        compact
        open={languageAutocompleteOpen}
        onOpenChange={setLanguageAutocompleteOpen}
        disabled={languageOptionsLoading}
        placeholder={t("searchLanguageLabel")}
        popoverPortalContainer={closePortalContainer}
        triggerClassName={semanticLanguageTriggerClassName}
        triggerContent={semanticLanguageTriggerContent}
        takeoverRect={takeoverRect}
        takeoverDismissLabel={floatingSearchT("closeSearch")}
      />
    </span>
  )
  const renderLanguageContextContent = (
    takeoverRect?: SuggestionListPosition,
  ) =>
    hasUnsubmittedSearchIntent ? (
      <>
        <span className="min-w-0 flex-1 truncate">
          {(t.raw("searchSuggestionWithLanguage") as string)
            .split(/(\{language\}|\{suggestion\})/u)
            .map((part, index) => {
              if (part === "{language}") {
                return (
                  <span key={`language-${index}`}>
                    {renderSemanticLanguageCombobox(takeoverRect)}
                  </span>
                )
              }
              if (part === "{suggestion}") {
                return (
                  <strong
                    key={`suggestion-${index}`}
                    className="font-semibold text-white"
                  >
                    <bdi dir="auto">{query.trim()}</bdi>
                  </strong>
                )
              }
              return <span key={`copy-${index}`}>{part}</span>
            })}
        </span>
        <CornerDownLeft aria-hidden className="h-4 w-4 shrink-0" />
      </>
    ) : (
      <span className="min-w-0 flex-1 truncate text-base sm:text-sm">
        {languageContextMessage
          .split(/(\{language\})/u)
          .map((part, index) =>
            part === "{language}" ? (
              <span key={`language-${index}`}>
                {renderSemanticLanguageCombobox(takeoverRect)}
              </span>
            ) : (
              <span key={`copy-${index}`}>{part}</span>
            ),
          )}
      </span>
    )
  const headerTopClass = headerPinned
    ? FLOATING_HEADER_PINNED_TOP_CLASS
    : FLOATING_HEADER_TOP_CLASS

  return (
    <div
      ref={setOverlayElement}
      role="dialog"
      aria-modal="true"
      aria-label={t("dialogLabel")}
      className={`fixed inset-0 h-dvh min-h-dvh overflow-visible ${closing ? "animate-overlay-fade-out" : "animate-overlay-fade-in"}`}
      style={{
        zIndex: 45,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {/* Mirror the floating header grid so the active input lands exactly
          where its hidden header slot sits. On mobile, logo/close occupy the
          first row and search/language occupy the second. The persistent
          header stays above this overlay and owns all three controls. */}
      <div
        data-testid="search-overlay-top-bar"
        className={`pointer-events-none absolute ${WATCH_PAGE_LEFT_EDGE_CLASSES} ${WATCH_PAGE_RIGHT_EDGE_CLASSES} ${headerTopClass} z-10 ${FLOATING_MODAL_HEADER_LAYOUT_CLASS}`}
      >
        <div
          aria-hidden="true"
          className={`${logoSlotClass} ${FLOATING_MODAL_HEADER_LOGO_POSITION_CLASS}`}
        />
        <div
          ref={fieldShellRef}
          data-testid="search-overlay-field-shell"
          onClick={(e) => e.stopPropagation()}
          className={`pointer-events-auto ${FLOATING_HEADER_FIELD_WIDTH_CLASS} ${FLOATING_MODAL_HEADER_FIELD_POSITION_CLASS} ${
            headerLanguageSwitcherVisible ? "" : "col-span-2"
          }`}
        >
          <FloatingSearchFieldInput
            ref={inputRef}
            value={query}
            onChange={handleInputChange}
            onSubmit={handleSearchSubmit}
            onClear={handleClearInput}
            onKeyDown={handleInputKeyDown}
            onBlur={handleInputBlur}
            onFocus={handleInputFocus}
            onCompositionStart={() => {
              setIsComposing(true)
              invalidateSuggestionRequest()
            }}
            onCompositionEnd={() => setIsComposing(false)}
            placeholder={t("placeholder")}
            aria-label={t("inputLabel")}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={
              !languageAutocompleteOpen &&
              suggestionPanelVisible &&
              suggestions.length > 0
            }
            aria-controls={
              languageAutocompleteOpen ? undefined : suggestionListId
            }
            aria-busy={visibleSuggestionsLoading}
            aria-activedescendant={
              activeSuggestionIndex == null
                ? undefined
                : `${suggestionListId}-option-${activeSuggestionIndex}`
            }
            dir="auto"
            iconTestId="search-overlay-input-icon"
            autoFocus
            showSubmitButton={false}
            wrapperClassName="w-full"
          />
          {searchLanguageControlVisible && !suggestionPanelActive && (
            <div
              data-testid="search-language-context"
              className="relative mt-2 min-h-11 w-full min-w-0 overflow-hidden rounded-lg text-base sm:text-sm text-stone-400"
            >
              {hasUnsubmittedSearchIntent && (
                <button
                  type="button"
                  data-testid="search-context-submit"
                  aria-label={t("searchSuggestionWithLanguage", {
                    suggestion: query.trim(),
                    language: semanticLanguageName,
                  })}
                  onClick={() => handleSearchSubmit(query)}
                  className="absolute inset-0 z-0 cursor-pointer rounded-lg transition hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-white/45 focus-visible:outline-offset-1"
                />
              )}
              <div className="pointer-events-none relative z-10 flex min-h-11 min-w-0 items-center gap-0.5 px-1.5 min-[480px]:px-4">
                {renderLanguageContextContent(
                  suggestionListPosition ?? undefined,
                )}
              </div>
            </div>
          )}
        </div>
        <div
          aria-hidden="true"
          data-testid="search-overlay-trailing-controls-spacer"
          className={FLOATING_MODAL_HEADER_TRAILING_GROUP_CLASS}
        >
          {headerLanguageSwitcherVisible ? (
            <div
              className={`${FLOATING_HEADER_LANGUAGE_SLOT_CLASS} ${FLOATING_MODAL_HEADER_LANGUAGE_POSITION_CLASS} ${
                headerLanguageCode
                  ? "w-auto min-w-[4.25rem] px-2 md:w-auto md:min-w-[4.75rem]"
                  : ""
              }`}
            />
          ) : null}
          <div
            className={`${FLOATING_HEADER_TRAILING_SLOT_CLASS} ${FLOATING_MODAL_HEADER_CLOSE_POSITION_CLASS}`}
          />
        </div>
      </div>

      {closePortalContainer &&
        suggestionListPosition &&
        suggestionPanelVisible &&
        suggestionPanelHasContent &&
        !languagePickerOwnedByContextRow &&
        createPortal(
          <div
            ref={suggestionPanelRef}
            data-testid="search-suggestions-panel"
            className="fixed z-[1000] m-0 flex origin-top-left flex-col overflow-hidden rounded-2xl border border-white/10 bg-stone-950/92 text-stone-100 shadow-2xl shadow-black/40 backdrop-blur-xl duration-150 animate-in fade-in-0 zoom-in-95"
            style={{
              height: suggestionListPosition.height,
              left: suggestionListPosition.left,
              top: suggestionListPosition.top,
              width: suggestionListPosition.width,
            }}
          >
            {searchLanguageControlVisible && (
              <div
                data-testid="search-suggestions-language-context"
                className="relative min-h-14 shrink-0 min-w-0 overflow-hidden border-b border-white/[0.08] text-base sm:text-sm text-stone-400"
              >
                {hasUnsubmittedSearchIntent && (
                  <button
                    type="button"
                    data-testid="search-context-submit"
                    aria-label={t("searchSuggestionWithLanguage", {
                      suggestion: query.trim(),
                      language: semanticLanguageName,
                    })}
                    onClick={() => handleSearchSubmit(query)}
                    className="absolute inset-0 z-0 cursor-pointer transition hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-white/45 focus-visible:-outline-offset-2"
                  />
                )}
                <div className="pointer-events-none relative z-10 flex min-h-14 min-w-0 items-center gap-0.5 px-1.5 py-2 min-[480px]:px-4">
                  {renderLanguageContextContent(suggestionListPosition)}
                </div>
              </div>
            )}
            {!languageAutocompleteOpen && suggestions.length > 0 && (
              <div
                ref={suggestionListRef}
                id={suggestionListId}
                role="listbox"
                aria-label={t("searchSuggestions")}
                className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {suggestionGroups.map((group, groupIndex) => (
                  <div
                    key={group.id}
                    role="presentation"
                    data-testid={`search-suggestion-group-${group.id}`}
                    className={
                      groupIndex === 0
                        ? ""
                        : "mt-2 border-t border-white/[0.12] pt-2"
                    }
                  >
                    <div
                      id={`${suggestionListId}-${group.id}-heading`}
                      className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-[0.12em] text-stone-400 sm:text-[0.6875rem]"
                    >
                      {group.label}
                    </div>
                    {group.sections.map((section, sectionIndex) => {
                      const SectionIcon = section.icon
                      const groupHeadingId = `${suggestionListId}-${group.id}-heading`
                      const sectionHeadingId = `${suggestionListId}-${section.id}-heading`
                      return (
                        <div
                          key={section.id}
                          role="group"
                          aria-label={
                            group.id === "direct-matches"
                              ? undefined
                              : section.label
                          }
                          aria-labelledby={
                            group.id === "direct-matches"
                              ? `${groupHeadingId} ${sectionHeadingId}`
                              : undefined
                          }
                          className={
                            sectionIndex === 0
                              ? ""
                              : "mt-1 border-t border-white/[0.06] pt-1"
                          }
                        >
                          {group.id === "direct-matches" && (
                            <div
                              id={sectionHeadingId}
                              className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-[0.12em] text-stone-600 sm:text-[0.625rem]"
                            >
                              {section.label}
                            </div>
                          )}
                          {section.rows.map(({ suggestion, index }) => {
                            const active = activeSuggestionIndex === index
                            const descriptionParts = suggestion.description
                              ? suggestionDescriptionParts(
                                  suggestion.description,
                                  normalizedSuggestionQuery,
                                )
                              : null
                            return (
                              <div
                                key={`${suggestion.kind}-${suggestion.id ?? suggestion.title}-${index}`}
                                id={`${suggestionListId}-option-${index}`}
                                role="option"
                                aria-selected={active}
                                data-suggestion-index={index}
                                dir="auto"
                                onMouseEnter={() =>
                                  setActiveSuggestionIndex(index)
                                }
                                onPointerDown={(event) => {
                                  if (
                                    !event.pointerType ||
                                    event.pointerType === "mouse"
                                  ) {
                                    event.preventDefault()
                                    return
                                  }
                                  suggestionTouchGestureRef.current = {
                                    pointerId: event.pointerId,
                                    startX: event.clientX,
                                    startY: event.clientY,
                                    moved: false,
                                  }
                                }}
                                onPointerMove={(event) => {
                                  const gesture =
                                    suggestionTouchGestureRef.current
                                  if (gesture?.pointerId !== event.pointerId)
                                    return
                                  if (
                                    Math.hypot(
                                      event.clientX - gesture.startX,
                                      event.clientY - gesture.startY,
                                    ) > 8
                                  ) {
                                    gesture.moved = true
                                  }
                                }}
                                onPointerUp={(event) => {
                                  const gesture =
                                    suggestionTouchGestureRef.current
                                  if (gesture?.pointerId !== event.pointerId)
                                    return
                                  suggestionTouchGestureRef.current = null
                                  if (gesture.moved) {
                                    event.preventDefault()
                                  }
                                }}
                                onPointerCancel={() => {
                                  suggestionTouchGestureRef.current = null
                                }}
                                onClick={() => {
                                  activateSuggestion(suggestion)
                                }}
                                className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors ${
                                  active
                                    ? "bg-white/[0.11] text-white"
                                    : "text-stone-200 hover:bg-white/[0.07] hover:text-white"
                                }`}
                              >
                                <SectionIcon
                                  size={17}
                                  strokeWidth={1.8}
                                  aria-hidden="true"
                                  className={`mt-0.5 shrink-0 ${
                                    active ? "text-stone-200" : "text-stone-500"
                                  }`}
                                />
                                <span className="min-w-0 flex-1">
                                  <bdi className="block truncate text-base sm:text-sm font-medium leading-5">
                                    {suggestion.title}
                                  </bdi>
                                  {suggestion.kind === "content" && (
                                    <span className="block truncate text-xs font-medium uppercase tracking-[0.08em] text-stone-500 sm:text-[0.6875rem]">
                                      {videoLabels(
                                        videoLabelMessageKey(suggestion.label),
                                      )}
                                    </span>
                                  )}
                                  {descriptionParts && (
                                    <bdi
                                      className={`line-clamp-1 text-sm sm:text-xs leading-4 ${
                                        active
                                          ? "text-stone-300"
                                          : "text-stone-500"
                                      }`}
                                    >
                                      {descriptionParts.before}
                                      {descriptionParts.match && (
                                        <mark className="bg-transparent font-medium text-stone-200">
                                          {descriptionParts.match}
                                        </mark>
                                      )}
                                      {descriptionParts.after}
                                    </bdi>
                                  )}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>,
          closePortalContainer,
        )}

      {/* Body: category grid when empty, results grid when queried. Its top
          edge clears the floating search controls so cards cannot scroll under
          the language chip or detected-language prompt. */}
      <div
        className={`search-overlay-scroll absolute inset-x-0 bottom-0 z-1 overflow-y-auto px-4 pb-8 sm:px-6 ${searchOverlayScrollTopClass}`}
        aria-live="polite"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="mx-auto max-w-[1400px]"
        >
          {showCategoryGrid && languageVideosHref ? (
            // The search-open surface's own language-inventory entry point,
            // at every width: the header control is suppressed while the modal
            // is open, so this row is the only one in the browse state.
            <Link
              href={languageVideosHref}
              prefetch={false}
              data-testid="search-overlay-language-videos-link"
              className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-stone-100 transition-colors duration-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <ListVideo aria-hidden className="size-5 shrink-0" />
                <span className="truncate text-base font-semibold">
                  {t("allVideosOnSinglePage")}
                </span>
              </span>
              <ArrowRight aria-hidden className="size-4 shrink-0" />
            </Link>
          ) : null}

          {showCategoryGrid && (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {CATEGORIES.map((cat) => {
                const Icon = CATEGORY_ICON_BY_SEARCH_TERM[cat.searchTerm]
                const title = t(CATEGORY_TITLE_KEYS[cat.searchTerm])
                return (
                  <button
                    key={cat.searchTerm}
                    type="button"
                    onClick={() => handleCategoryClick(title)}
                    aria-label={title}
                    data-testid={`search-overlay-category-${cat.searchTerm.replace(/\s+/g, "-")}`}
                    className="group relative isolate aspect-video w-full cursor-pointer overflow-hidden rounded-lg p-3 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 sm:p-6"
                  >
                    <span
                      aria-hidden="true"
                      data-testid={`search-overlay-category-background-${cat.searchTerm.replace(/\s+/g, "-")}`}
                      className="search-card-hover-zoom pointer-events-none absolute inset-0 z-0 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                      style={{ background: cat.gradient }}
                    >
                      {Icon ? (
                        <Icon
                          aria-hidden="true"
                          className="absolute right-1 top-1 h-16 w-16 opacity-30 drop-shadow-lg sm:right-2 sm:top-2 sm:h-24 sm:w-24"
                        />
                      ) : null}
                    </span>
                    <span
                      aria-hidden="true"
                      data-testid={`search-overlay-category-hover-outline-${cat.searchTerm.replace(/\s+/g, "-")}`}
                      className="search-category-hover-outline search-category-red-outline pointer-events-none absolute z-20 opacity-0 transition-opacity duration-200"
                    />
                    <span
                      className="absolute bottom-3 left-3 z-10 text-base font-semibold leading-tight sm:text-lg md:text-xl"
                      style={{ textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}
                    >
                      {title}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {loading && showSkeleton && (
            <div
              className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              aria-hidden="true"
            >
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="overflow-hidden rounded-2xl bg-white/5">
                  <div className="aspect-video w-full animate-pulse bg-white/10" />
                  <div className="flex flex-col gap-2 p-3">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-white/10" />
                    <div className="h-3 w-full animate-pulse rounded bg-white/10" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {loading && !showSkeleton && (
            <p className="sr-only">{t("searching")}</p>
          )}

          {!loading && searched && displayResults.length === 0 && error && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <h2 className="text-lg font-semibold text-stone-200">{error}</h2>
              {errorKind === "rate_limited" ? (
                <p className="mt-2 text-base sm:text-sm text-stone-500">
                  {t("rateLimitHint")}
                </p>
              ) : errorKind === "network_error" ? (
                <p className="mt-2 text-base sm:text-sm text-stone-500">
                  {t("connectionHint")}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void search(submittedQuery ?? query)}
                className="mt-4 cursor-pointer rounded-lg bg-stone-700 px-4 py-2 text-base sm:text-sm text-stone-200 transition hover:bg-stone-600 focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2"
              >
                {t("retrySearch")}
              </button>
            </div>
          )}

          {!loading && searched && displayResults.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <h2 className="text-lg font-semibold text-stone-200">
                {t("noResults", { query: submittedQuery ?? query.trim() })}
              </h2>
              <p className="mt-2 text-base sm:text-sm text-stone-500">
                {t("tryDifferentKeywordsOrLanguage")}
              </p>
            </div>
          )}

          {displayResults.length > 0 && (
            <>
              <div
                key={resultsKey}
                className={`grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4${exiting ? " animate-card-exit" : ""}`}
              >
                {displayResults.map((result, index) => (
                  <VideoCard
                    key={`${result.id}-${index}`}
                    result={result}
                    index={exiting ? 0 : index}
                    requestedLanguageSlug={completedSearchLanguageSlug}
                    requestedLanguageName={completedSearchLanguageName}
                    onResultClick={
                      searchResultAnalytics
                        ? (clickedResult) => {
                            closeAfterResultNavigation()
                            const clickKey = [
                              searchResultAnalytics.searchRequestId,
                              clickedResult.id,
                              index + 1,
                            ].join(":")
                            if (
                              recordedResultClickKeysRef.current.has(clickKey)
                            ) {
                              return
                            }
                            recordedResultClickKeysRef.current.add(clickKey)
                            reportDatadogRumAction(
                              WATCH_SEARCH_RUM_RESULT_CLICKED_ACTION,
                              buildWatchSearchResultClickRumContext(
                                clickedResult,
                                {
                                  ...searchResultAnalytics,
                                  position: index + 1,
                                },
                              ),
                            )
                            void recordWatchSearchResultClick({
                              requestId: searchResultAnalytics.searchRequestId,
                              resultId: clickedResult.id,
                              resultType: clickedResult.type,
                              position: index + 1,
                              visibleResultIds,
                              routeLanguageSlug:
                                searchResultAnalytics.routeLanguageSlug,
                              searchLanguageSlug:
                                searchResultAnalytics.searchLanguageSlug,
                            })
                          }
                        : () => {
                            closeAfterResultNavigation()
                          }
                    }
                  />
                ))}
              </div>

              {error && (
                <div className="mt-6 text-center">
                  <p className="text-base sm:text-sm text-brand-red">{error}</p>
                  {errorKind === "rate_limited" ? (
                    <p className="mt-2 text-base sm:text-sm text-stone-500">
                      {t("rateLimitHint")}
                    </p>
                  ) : errorKind === "network_error" ? (
                    <p className="mt-2 text-base sm:text-sm text-stone-500">
                      {t("connectionHint")}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="mt-2 cursor-pointer rounded-lg bg-stone-700 px-4 py-2 text-base sm:text-sm text-stone-200 transition hover:bg-stone-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("retry")}
                  </button>
                </div>
              )}

              {hasMore && !error && (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="flex cursor-pointer items-center gap-2 rounded-lg bg-white/10 px-6 py-3 text-base sm:text-sm font-medium text-stone-300 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2"
                  >
                    {loadingMore && (
                      <SpinnerIcon className="h-4 w-4 animate-spin" />
                    )}
                    {loadingMore ? t("loading") : t("loadMore")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
