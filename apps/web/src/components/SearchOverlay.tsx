"use client"

import { useCallback, useEffect, useRef } from "react"
import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"

import { useFloatingSearch } from "./FloatingSearchProvider"
import { VideoCard } from "./search/VideoCard"
import { CATEGORIES } from "@/lib/search-categories"

export function SearchOverlay() {
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
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  const hasQuery = query.trim().length > 0

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Search and browse videos"
      onClick={() => closeAndKeepQuery()}
      className={`fixed inset-0 flex flex-col ${closing ? "animate-overlay-fade-out" : "animate-overlay-fade-in"}`}
      style={{
        zIndex: 9999,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {/* Top bar: input is viewport-centered via mx-auto; mobile logo and
          close button are absolutely positioned so they don't push the input
          off-center. Outer padding (px-4 sm:px-6) matches the floating
          searchbar's side margin (w-[calc(100%-2rem)] sm:w-[calc(100%-3rem)])
          so the input's position and size on open match the bar's exactly. */}
      <div className="relative shrink-0 px-4 pt-6 sm:px-6 sm:pt-10">
        <Link
          href={"/" as Route}
          aria-label="JesusFilm home"
          onClick={(e) => e.stopPropagation()}
          className="absolute left-4 top-[30px] z-10 flex items-center rounded-full p-1 sm:hidden focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2"
        >
          <Image
            src="/watch/images/jesusfilm-sign.svg"
            alt="JesusFilm"
            width={24}
            height={18}
            unoptimized
          />
        </Link>
        <div
          role="search"
          aria-label="Search videos"
          onClick={(e) => e.stopPropagation()}
          className="relative mx-auto w-full max-w-[810px]"
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            placeholder="Search or browse topics…"
            aria-label="Search videos by keyword"
            className="w-full rounded-[35px] bg-white/10 py-3 pl-6 pr-12 text-base text-white shadow-xl outline-1 outline-white/20 backdrop-blur-[10px] placeholder:text-white/70 focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2"
          />
          {hasQuery && (
            <button
              type="button"
              onClick={handleClearInput}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-white/70 transition hover:text-white focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <line x1={18} y1={6} x2={6} y2={18} />
                <line x1={6} y1={6} x2={18} y2={18} />
              </svg>
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            closeAndKeepQuery()
          }}
          aria-label="Close search"
          className="absolute right-2 top-[18px] z-10 rounded-full p-3 text-stone-400 transition hover:text-white focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2 sm:right-4 sm:top-[34px]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <line x1={18} y1={6} x2={6} y2={18} />
            <line x1={6} y1={6} x2={18} y2={18} />
          </svg>
        </button>
      </div>

      {/* Body: category grid when empty, results grid when queried */}
      <div
        className="search-overlay-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-6 sm:px-6"
        aria-live="polite"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="mx-auto max-w-[1400px]"
        >
          {showCategoryGrid && (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.searchTerm}
                  type="button"
                  onClick={() => handleCategoryClick(cat.searchTerm)}
                  className="relative aspect-video w-full overflow-hidden rounded-lg p-3 text-white transition-transform duration-200 active:scale-95 [@media(hover:hover)]:hover:scale-105 focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2 sm:p-6"
                  style={{ background: cat.gradient }}
                >
                  <span
                    className="absolute bottom-3 left-3 text-base font-semibold leading-tight sm:text-lg md:text-xl"
                    style={{ textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}
                  >
                    {cat.title}
                  </span>
                </button>
              ))}
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

          {loading && !showSkeleton && <p className="sr-only">Searching...</p>}

          {!loading && searched && displayResults.length === 0 && error && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <h2 className="text-lg font-semibold text-stone-200">{error}</h2>
              <p className="mt-2 text-sm text-stone-500">
                Please check your connection and try again.
              </p>
              <button
                type="button"
                onClick={() => void search(query)}
                className="mt-4 rounded-lg bg-stone-700 px-4 py-2 text-sm text-stone-200 transition hover:bg-stone-600 focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2"
              >
                Retry search
              </button>
            </div>
          )}

          {!loading && searched && displayResults.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <h2 className="text-lg font-semibold text-stone-200">
                No results for &apos;{query.trim()}&apos;
              </h2>
              <p className="mt-2 text-sm text-stone-500">
                Try different keywords or browse categories
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
                  <p className="text-sm text-red-400">{error}</p>
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="mt-2 rounded-lg bg-stone-700 px-4 py-2 text-sm text-stone-200 transition hover:bg-stone-600 disabled:opacity-50"
                  >
                    Retry
                  </button>
                </div>
              )}

              {hasMore && !error && (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="flex items-center gap-2 rounded-lg bg-white/10 px-6 py-3 text-sm font-medium text-stone-300 transition hover:bg-white/15 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2"
                  >
                    {loadingMore && (
                      <svg
                        className="h-4 w-4 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    )}
                    {loadingMore ? "Loading..." : "Load more"}
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
