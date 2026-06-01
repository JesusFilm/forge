"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { useTranslations } from "next-intl"

import { useFloatingSearch } from "./FloatingSearchProvider"
import { FloatingSearchFieldInput } from "./FloatingSearchField"
import { CATEGORY_ICON_BY_SEARCH_TERM } from "./SearchCategoryIcons"
import { VideoCard } from "./search/VideoCard"
import { SpinnerIcon } from "@/components/ui/spinner"
import { WatchModalViewportCloseButton } from "@/components/watch/WatchModalViewportCloseButton"
import { CATEGORIES } from "@/lib/search-categories"
import type { CategorySearchTerm } from "@/lib/search-categories"

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
  const {
    open,
    closing,
    query,
    displayResults,
    exiting,
    resultsKey,
    hasMore,
    loading,
    showSkeleton,
    loadingMore,
    error,
    searched,
    setQuery,
    search,
    loadMore,
    closeAndKeepQuery,
  } = useFloatingSearch()

  const overlayRef = useRef<HTMLDivElement>(null)
  const [closePortalContainer, setClosePortalContainer] =
    useState<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setOverlayElement = useCallback((node: HTMLDivElement | null) => {
    overlayRef.current = node
    setClosePortalContainer(node)
  }, [])

  // Autofocus the input shortly after mount. Covers both user-open and
  // URL-hydration paths.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [open])

  // Escape closes the modal (preserving ?q= and query state).
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeAndKeepQuery()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, closeAndKeepQuery])

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
      const focusable = overlay.querySelectorAll<HTMLElement>(
        'input, button, a[href], [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", handleTab)
    return () => document.removeEventListener("keydown", handleTab)
  }, [open])

  // Cleanup debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value
      setQuery(newValue)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        void search(newValue)
      }, 300)
    },
    [setQuery, search],
  )

  const handleCategoryClick = useCallback(
    (searchTerm: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      void search(searchTerm)
    },
    [search],
  )

  const handleClearInput = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    void search("")
    inputRef.current?.focus()
  }, [search])

  const showCategoryGrid = query.trim().length === 0 && !loading && !searched

  return (
    <div
      ref={setOverlayElement}
      role="dialog"
      aria-modal="true"
      aria-label={t("dialogLabel")}
      onClick={() => closeAndKeepQuery()}
      className={`fixed inset-0 h-dvh min-h-dvh overflow-visible ${closing ? "animate-overlay-fade-out" : "animate-overlay-fade-in"}`}
      style={{
        zIndex: 9999,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {/* Floating top bar: input is viewport-centered via mx-auto. On mobile
          the logo is in normal flow above the field so it cannot overlap the
          input. Outer padding (px-4 sm:px-6) matches the
          floating searchbar's side margin (w-[calc(100%-2rem)]
          sm:w-[calc(100%-3rem)]) so the input's position and size on open
          match the bar's exactly. `pt-12` mirrors the header bar's
          unpinned `top-12` position so the modal input does not jump
          vertically when opened. The wrapper is `pointer-events-none` so
          scroll wheel events over the empty edges pass through to the
          body; the pill + logo + close button re-enable pointer events
          on themselves. */}
      <div
        data-testid="search-overlay-top-bar"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 px-4 pt-6 sm:px-6 sm:pt-12"
      >
        <Link
          href={"/" as Route}
          aria-label={t("home")}
          // stopPropagation keeps the overlay from intercepting the click as
          // a backdrop dismiss; search("") clears the query + ?q= + cached
          // results so home navigation lands on a fresh search bar.
          onClick={(e) => {
            e.stopPropagation()
            void search("")
          }}
          className="pointer-events-auto mb-6 flex w-fit items-center rounded-full p-1 sm:hidden focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2"
        >
          <Image
            src="/watch/images/jesusfilm-sign.svg"
            alt="JesusFilm"
            width={70}
            height={70}
            unoptimized
            className="h-auto max-w-[50px]"
          />
        </Link>
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto mx-auto w-full max-w-[810px]"
        >
          <FloatingSearchFieldInput
            ref={inputRef}
            value={query}
            onChange={handleInputChange}
            onClear={handleClearInput}
            placeholder={t("placeholder")}
            aria-label={t("inputLabel")}
            iconTestId="search-overlay-input-icon"
            wrapperClassName="w-full"
          />
        </div>
      </div>
      <WatchModalViewportCloseButton
        open={open || closing}
        onClose={closeAndKeepQuery}
        testId="search-overlay-close"
        portalContainer={closePortalContainer}
        positionClassName="top-6 right-4 sm:top-12 sm:right-10"
      />

      <div
        aria-hidden="true"
        data-testid="search-overlay-bottom-backdrop"
        className="pointer-events-none absolute inset-x-0 bottom-[-14rem] z-0 h-[max(28rem,calc(env(safe-area-inset-bottom,0px)+24rem))] bg-black/85 backdrop-blur-[14px]"
      />

      {/* Body: category grid when empty, results grid when queried.
          Fills the entire dialog so the floating bar can sit ABOVE it
          with backdrop-blur — `pt-24 sm:pt-32` clears the bar's height
          (mobile logo + gap + input, or desktop input pt-12 + breathing room). */}
      <div
        className="search-overlay-scroll absolute inset-0 z-1 overflow-y-auto px-4 pb-8 pt-44 sm:px-6 sm:pt-32"
        aria-live="polite"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="mx-auto max-w-[1400px]"
        >
          {showCategoryGrid && (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {CATEGORIES.map((cat) => {
                const Icon = CATEGORY_ICON_BY_SEARCH_TERM[cat.searchTerm]
                const title = t(CATEGORY_TITLE_KEYS[cat.searchTerm])
                return (
                  <button
                    key={cat.searchTerm}
                    type="button"
                    onClick={() => handleCategoryClick(cat.searchTerm)}
                    aria-label={title}
                    data-testid={`search-overlay-category-${cat.searchTerm.replace(/\s+/g, "-")}`}
                    className="relative aspect-video w-full cursor-pointer overflow-hidden rounded-lg p-3 text-white transition-transform duration-200 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 [@media(hover:hover)]:hover:scale-105 sm:p-6"
                    style={{ background: cat.gradient }}
                  >
                    {Icon ? (
                      // Decorative top-right icon. Sized at roughly a
                      // quarter of the rectangle's width so it reads as
                      // a prominent corner badge (matching the reference
                      // from core/apps/watch's CategoryGrid). `pointer-
                      // events-none` keeps clicks falling through to
                      // the button.
                      <Icon
                        aria-hidden="true"
                        className="pointer-events-none absolute right-1 top-1 h-16 w-16 opacity-30 drop-shadow-lg sm:right-2 sm:top-2 sm:h-24 sm:w-24"
                      />
                    ) : null}
                    <span
                      className="absolute bottom-3 left-3 text-base font-semibold leading-tight sm:text-lg md:text-xl"
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
              <p className="mt-2 text-sm text-stone-500">
                {t("connectionHint")}
              </p>
              <button
                type="button"
                onClick={() => void search(query)}
                className="mt-4 cursor-pointer rounded-lg bg-stone-700 px-4 py-2 text-sm text-stone-200 transition hover:bg-stone-600 focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2"
              >
                {t("retrySearch")}
              </button>
            </div>
          )}

          {!loading && searched && displayResults.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <h2 className="text-lg font-semibold text-stone-200">
                {t("noResults", { query: query.trim() })}
              </h2>
              <p className="mt-2 text-sm text-stone-500">
                {t("tryDifferentKeywords")}
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
                  <div
                    key={`${result.id}-${index}`}
                    onClick={() => closeAndKeepQuery()}
                  >
                    <VideoCard result={result} index={exiting ? 0 : index} />
                  </div>
                ))}
              </div>

              {error && (
                <div className="mt-6 text-center">
                  <p className="text-sm text-brand-red">{error}</p>
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="mt-2 cursor-pointer rounded-lg bg-stone-700 px-4 py-2 text-sm text-stone-200 transition hover:bg-stone-600 disabled:cursor-not-allowed disabled:opacity-50"
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
                    className="flex cursor-pointer items-center gap-2 rounded-lg bg-white/10 px-6 py-3 text-sm font-medium text-stone-300 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2"
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
