"use client"

/**
 * Slim anchor-video picker for "Generate section from video".
 *
 * A search + select variant of the editor's media-library modal: it lists
 * the whole video library, badges + sorts-first the videos that are "ready"
 * to anchor a section (playable AND grounded), and emits the chosen video.
 *
 * Deliberately omits the block-attachment picker's playback/trim/loop/audio
 * configuration — anchoring a section only needs a video id, not a clip
 * config. The "ready" badge is advisory: every row stays selectable so the
 * section action remains the authoritative eligibility gate (R5).
 */

import { CirclePlay, Search, Sparkles, X } from "lucide-react"
import { useMemo, useState } from "react"

import type { VideoLibraryItem } from "./block-helpers"

/** A video is "ready" to anchor a section when it is playable AND grounded. */
export function isAnchorReady(item: VideoLibraryItem): boolean {
  return item.previewStreamUrl != null && item.hasGrounding
}

export type AnchorVideoPickerProps = {
  videoLibrary: VideoLibraryItem[]
  open: boolean
  onClose: () => void
  onSelect: (item: VideoLibraryItem) => void
}

export function AnchorVideoPicker({
  videoLibrary,
  open,
  onClose,
  onSelect,
}: AnchorVideoPickerProps) {
  const [query, setQuery] = useState("")

  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const filtered = videoLibrary.filter((item) => {
      if (normalized.length === 0) return true
      const haystack =
        `${item.title} ${item.id} ${item.sourceLabel} ${item.dubs}`.toLowerCase()
      return haystack.includes(normalized)
    })
    // Stable sort: ready videos first, preserving the incoming order
    // (recently-updated) within each group.
    return filtered
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        const readyLeft = isAnchorReady(left.item) ? 0 : 1
        const readyRight = isAnchorReady(right.item) ? 0 : 1
        if (readyLeft !== readyRight) return readyLeft - readyRight
        return left.index - right.index
      })
      .map((entry) => entry.item)
  }, [videoLibrary, query])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="anchor-video-picker-title"
      data-testid="anchor-video-picker"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-sm border border-[var(--color-hairline-strong)] bg-[var(--color-surface)] shadow-xl">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-hairline)] px-5 py-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
              Choose a video
            </div>
            <h2
              id="anchor-video-picker-title"
              className="mt-2 text-[16px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]"
            >
              Anchor a section to a video
            </h2>
            <p className="mt-1 max-w-md text-[12px] leading-5 text-[var(--color-text-muted)]">
              Videos marked “ready” are playable and have study questions or
              scripture to ground a section.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="anchor-video-picker-close"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
            aria-label="Close video picker"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* Search */}
        <div className="shrink-0 border-b border-[var(--color-hairline)] px-5 py-3">
          <label className="grid gap-1.5">
            <span className="sr-only">Search videos</span>
            <div className="flex h-10 items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3">
              <Search className="h-4 w-4 text-[var(--color-text-muted)]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                data-testid="anchor-video-picker-search"
                className="w-full border-0 bg-transparent text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-disabled)]"
                placeholder="Search title, Core ID, source, or dub coverage"
              />
            </div>
          </label>
        </div>

        {/* Results */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin]">
          {rows.length === 0 ? (
            <div
              data-testid="anchor-video-picker-empty"
              className="m-3 rounded-sm border border-dashed border-[var(--color-hairline)] px-4 py-8 text-center"
            >
              <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                No videos match these filters
              </div>
              <div className="mt-2 text-[12px] leading-5 text-[var(--color-text-muted)]">
                Try widening the search or clearing the current query.
              </div>
            </div>
          ) : (
            <ul className="grid gap-1">
              {rows.map((video) => {
                const ready = isAnchorReady(video)
                return (
                  <li key={video.key}>
                    <button
                      type="button"
                      data-testid="anchor-video-picker-row"
                      data-video-key={video.key}
                      data-ready={ready ? "true" : "false"}
                      onClick={() => {
                        onSelect(video)
                        onClose()
                      }}
                      className="grid w-full min-w-0 cursor-pointer grid-cols-[112px_minmax(0,1fr)] gap-3 overflow-hidden rounded-sm border border-transparent px-3 py-2.5 text-left transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline)] hover:bg-[color-mix(in_oklab,var(--color-surface)_92%,white)]"
                    >
                      <div className="relative aspect-video w-full overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[linear-gradient(180deg,#1c2027,#121419)]">
                        {video.previewImageUrl ? (
                          <div
                            className="absolute inset-0 bg-cover bg-center"
                            style={{
                              backgroundImage: `url("${video.previewImageUrl}")`,
                            }}
                          />
                        ) : null}
                        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,12,18,0.04),rgba(6,8,12,0.56))]" />
                        <div className="absolute bottom-1.5 left-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-[rgba(4,6,10,0.56)] text-white backdrop-blur-[4px]">
                          <CirclePlay className="h-3 w-3" strokeWidth={1.5} />
                        </div>
                      </div>
                      <div className="min-w-0 overflow-hidden">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="truncate text-[14px] font-medium text-[var(--color-text-primary)]">
                            {video.title}
                          </div>
                          {ready ? (
                            <span
                              data-testid="anchor-video-picker-ready-badge"
                              className="inline-flex h-5 shrink-0 items-center gap-1 rounded-pill border border-[color-mix(in_oklab,var(--color-success)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-success)_14%,transparent)] px-2 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--color-success)]"
                            >
                              <Sparkles className="h-3 w-3" strokeWidth={1.5} />
                              Ready
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 truncate text-[12px] leading-5 text-[var(--color-text-muted)]">
                          {video.id} • {video.duration}
                        </div>
                        <div className="mt-0.5 truncate text-[12px] leading-5 text-[var(--color-text-muted)]">
                          {video.sourceLabel} • {video.dubs}
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
