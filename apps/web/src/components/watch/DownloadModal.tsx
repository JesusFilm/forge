"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import Image from "next/image"
import {
  Check,
  ChevronDown,
  Download as DownloadIcon,
  Globe2,
  Play,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  SAFE_DOWNLOAD_EXTENSIONS,
  isAllowedDownloadOrigin,
} from "@/lib/download-allowlist"
import { cn } from "@/lib/utils"

export type DownloadModalDownload = {
  documentId: string
  quality: string
  size: number | null
  url: string
}

export type DownloadModalProps = {
  open: boolean
  downloads: DownloadModalDownload[]
  videoTitle?: string | null
  posterUrl?: string | null
  /** Variant duration in seconds (used for the runtime overlay on the thumbnail). */
  durationSeconds?: number | null
  languageName?: string | null
  onClose: () => void
}

// Public terms-of-use page; opens in a new tab from the modal's checkbox row.
const TERMS_OF_USE_URL = "https://www.jesusfilm.org/terms-of-use/"

// Same-origin streaming proxy. Hardcoded against `next.config.mjs`'s
// `basePath: "/watch"`; if the basePath ever moves, this string moves
// with it.
const DOWNLOAD_PROXY_PATH = "/watch/api/download"

// Quality keys the CMS emits, ordered highest-fidelity first. Used to sort
// the downloads before bucketing into UI tiers. Kept as `as const` so
// `pickFirst`-style typo-guards stay intact; if Strapi codegen evolves
// the enum, a literal-type comparison would catch new keys at the call
// site rather than silently sorting them to the tail.
const QUALITY_PRIORITY = [
  "uhd",
  "qhd",
  "fhd",
  "highest",
  "high",
  "distroHigh",
  "sd",
  "distroSd",
  "low",
  "distroLow",
] as const

type Tier = "highest" | "high" | "low"

type TierOption = {
  tier: Tier
  label: string
  download: DownloadModalDownload
}

// Sort primarily by size (largest first) so the "Highest" tier always
// surfaces the largest file even when admin's `quality` enum is wrong
// for the underlying asset. Observed in the wild: the Albanian dub of
// `1-jesus-our-loving-pursuer` reports a 606 KB `fhd` entry pointing
// at a 1080p Mux URL, which the old quality-enum-only sort promoted
// to the "Highest" slot ahead of the real 21 MB `highest` row. Tied or
// unknown sizes fall back to the original QUALITY_PRIORITY order so
// the historical behavior holds for clean data.
function sortByQuality(
  downloads: DownloadModalDownload[],
): DownloadModalDownload[] {
  const priority = new Map<string, number>(
    QUALITY_PRIORITY.map((q, i) => [q, i]),
  )
  const tail = QUALITY_PRIORITY.length
  return [...downloads].sort((a, b) => {
    const aSize = a.size != null && a.size > 0 ? a.size : 0
    const bSize = b.size != null && b.size > 0 ? b.size : 0
    if (aSize > 0 && bSize > 0 && aSize !== bSize) return bSize - aSize
    const ai = priority.get(a.quality) ?? tail
    const bi = priority.get(b.quality) ?? tail
    return ai - bi
  })
}

// Surface as many tier options as there are distinct downloads, up to three.
//   1 download  → [Highest]
//   2 downloads → [Highest, Low]
//   3+ downloads → [Highest, High, Low] picked at evenly-spaced positions in
//                  the priority-sorted list, so we always include the best
//                  and worst options plus a middle representative.
function bucketDownloads(downloads: DownloadModalDownload[]): TierOption[] {
  const sorted = sortByQuality(downloads)
  if (sorted.length === 0) return []
  const head = sorted[0] as DownloadModalDownload
  if (sorted.length === 1) {
    return [{ tier: "highest", label: "Highest", download: head }]
  }
  const tail = sorted[sorted.length - 1] as DownloadModalDownload
  if (sorted.length === 2) {
    return [
      { tier: "highest", label: "Highest", download: head },
      { tier: "low", label: "Low", download: tail },
    ]
  }
  const middle = sorted[Math.floor(sorted.length / 2)] as DownloadModalDownload
  return [
    { tier: "highest", label: "Highest", download: head },
    { tier: "high", label: "High", download: middle },
    { tier: "low", label: "Low", download: tail },
  ]
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return ""
  const mb = bytes / 1024 / 1024
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  if (mb >= 100) return `${mb.toFixed(0)} MB`
  return `${mb.toFixed(2)} MB`
}

// Probe the same-origin download proxy for a `Content-Length` when the
// CMS-provided `size` is missing or zero. Returns null on any failure so
// the UI can fall back to rendering just the tier label.
async function fetchSizeFromProxy(
  url: string,
  signal: AbortSignal,
): Promise<number | null> {
  try {
    const res = await fetch(
      `${DOWNLOAD_PROXY_PATH}?url=${encodeURIComponent(url)}`,
      { method: "HEAD", signal },
    )
    if (!res.ok) return null
    const len = res.headers.get("content-length")
    if (!len) return null
    const n = Number.parseInt(len, 10)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

// Renders `({formatted})` when the size is known, nothing otherwise.
// Used by both the dropdown trigger and each option row so the hide-when-
// unknown behavior is defined once.
function SizeLabel({
  bytes,
  className,
}: {
  bytes: number | null | undefined
  className?: string
}) {
  const label = formatSize(bytes)
  if (!label) return null
  return <span className={className}>({label})</span>
}

function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => n.toString().padStart(2, "0")
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function DownloadModal({
  open,
  downloads,
  videoTitle,
  posterUrl,
  durationSeconds,
  languageName,
  onClose,
}: DownloadModalProps) {
  const [tosAgreed, setTosAgreed] = useState(false)
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Keyed by download URL since the CMS-generated `documentId` is stable
  // per-variant but the URL is what we probe — lookups for the same URL
  // (which happens when the CMS sets fhd === highest) dedupe naturally.
  const [probedSizes, setProbedSizes] = useState<Record<string, number | null>>(
    {},
  )
  // Probe attempts (success OR failure) are tracked here so dedup is
  // decoupled from result state — using `probedSizes` for both would put
  // it in the probe effect's deps and cause an extra no-op effect run per
  // batch. Survives modal close/reopen so a rapid open-close-open cycle
  // doesn't re-issue HEAD requests for URLs we already tried.
  const attemptedUrlsRef = useRef<Set<string>>(new Set())
  const dropdownId = useId()
  const dropdownListId = `${dropdownId}-list`
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  // Re-entry guard: blocks a double-click / stray pointer event from
  // queueing a second proxy request before the modal-close re-render
  // hides the button.
  const downloadInFlight = useRef<boolean>(false)

  const tiers = useMemo(() => bucketDownloads(downloads), [downloads])

  // Resolves the effective size for a tier: prefer the CMS-provided
  // value if valid, else a previously probed value, else null.
  const resolveSize = useCallback(
    (download: DownloadModalDownload): number | null => {
      const cms = download.size
      if (cms != null && cms > 0) return cms
      const probed = probedSizes[download.url]
      return probed ?? null
    },
    [probedSizes],
  )

  // `selectedTier` is `null` until the user explicitly picks a tier, and
  // is reset to `null` on modal close (see handleOpenChange). The
  // displayed selection is derived purely: use the user's pick if it is
  // still valid against the current tiers, otherwise fall back to
  // Highest. This avoids `setState`-in-effect (banned by the React
  // Compiler rules) and side-steps the variant-swap clobbering bug —
  // the user's pick survives parent re-renders, and falls back
  // gracefully when the available tiers no longer include it.
  const defaultTier = tiers[0]?.tier ?? null
  const effectiveTier =
    selectedTier && tiers.some((t) => t.tier === selectedTier)
      ? selectedTier
      : defaultTier
  const selected = tiers.find((t) => t.tier === effectiveTier) ?? null
  const canDownload = tosAgreed && selected != null
  const durationLabel = formatDuration(durationSeconds)

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setTosAgreed(false)
        setSelectedTier(null)
        setDropdownOpen(false)
        setError(null)
        downloadInFlight.current = false
        onClose()
      }
    },
    [onClose],
  )

  // Lazy size probe: for any tier whose CMS-provided `size` is missing
  // or zero, HEAD the source URL via the same-origin proxy when the
  // modal opens. The CMS English variant ships with `size: 0` for all
  // qualities; without this the UI shows "(0.00 MB)" which is wrong.
  // Dedup uses `attemptedUrlsRef` (not `probedSizes`) so the effect
  // doesn't re-run on its own setState. Each URL is HEAD-probed once
  // per page-load lifetime.
  useEffect(() => {
    if (!open) return
    const attempted = attemptedUrlsRef.current
    const missingUrls = Array.from(
      new Set(
        tiers
          .map((t) => t.download)
          .filter((d) => !(d.size != null && d.size > 0))
          .map((d) => d.url)
          .filter((url) => !attempted.has(url)),
      ),
    )
    if (missingUrls.length === 0) return
    // Reserve slots synchronously so a re-open during the in-flight
    // batch doesn't trigger duplicate HEADs.
    for (const url of missingUrls) attempted.add(url)
    const controller = new AbortController()
    void Promise.all(
      missingUrls.map(async (url) => {
        const size = await fetchSizeFromProxy(url, controller.signal)
        return [url, size] as const
      }),
    )
      .then((results) => {
        if (controller.signal.aborted) return
        setProbedSizes((prev) => {
          const next = { ...prev }
          for (const [url, size] of results) next[url] = size
          return next
        })
      })
      .catch((err) => {
        // fetchSizeFromProxy catches internally so this is defense in
        // depth — any future throw inside `.then()` lands here rather
        // than as an unhandled rejection.
        console.error("[DownloadModal] size probe pipeline failed", err)
      })
    return () => controller.abort()
  }, [open, tiers])

  // Click-outside / Escape-first close for the custom dropdown. Without
  // this, clicking elsewhere in the modal leaves the listbox open
  // forever, and pressing Escape dismisses the entire dialog instead of
  // collapsing only the dropdown.
  useEffect(() => {
    if (!dropdownOpen) return
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) return
      if (
        triggerRef.current?.contains(target) ||
        listRef.current?.contains(target)
      ) {
        return
      }
      setDropdownOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Stop propagation so base-ui's dialog Escape handler doesn't
        // also fire and close the entire modal.
        event.stopPropagation()
        setDropdownOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true)
    document.addEventListener("keydown", handleKeyDown, true)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true)
      document.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [dropdownOpen])

  function buildFilename(sourceUrl: string, tier: Tier): string {
    // Strip query string before extracting the extension so a `?token=...`
    // CDN URL doesn't end up with `mp4?token=abc` as the ext.
    const path = sourceUrl.split("?")[0] ?? ""
    const lastDot = path.lastIndexOf(".")
    const lastSlash = path.lastIndexOf("/")
    // Only treat the last segment's `.ext` as an extension; otherwise a
    // URL like `https://stream.mux.com/abc` would emit `com/abc` as the
    // extension and embed a slash in the filename.
    const candidate =
      lastDot > lastSlash && lastDot < path.length - 1
        ? path.slice(lastDot + 1).toLowerCase()
        : ""
    const ext = SAFE_DOWNLOAD_EXTENSIONS.has(candidate) ? candidate : "mp4"

    const slug = (videoTitle ?? "video")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
    return `${slug || "video"}-${tier}.${ext}`
  }

  function handleDownload() {
    if (!selected) return
    if (downloadInFlight.current) return
    const sourceUrl = selected.download.url
    if (!isAllowedDownloadOrigin(sourceUrl)) {
      console.error(
        "[DownloadModal] Refusing to download from non-allowlisted origin",
        { url: sourceUrl },
      )
      setError("Download unavailable from this source")
      return
    }
    setError(null)
    downloadInFlight.current = true

    const filename = buildFilename(sourceUrl, selected.tier)

    // Route through our same-origin streaming proxy so the browser honors
    // the `download` attribute and `Content-Disposition: attachment`. A
    // direct cross-origin link gets navigated by the browser instead of
    // handed to the download manager.
    const proxy = `${DOWNLOAD_PROXY_PATH}?url=${encodeURIComponent(sourceUrl)}&filename=${encodeURIComponent(filename)}`

    const a = document.createElement("a")
    a.href = proxy
    a.download = filename
    a.rel = "noopener"
    document.body.appendChild(a)
    a.click()
    a.remove()

    // The browser's download manager has taken over — close the dialog so
    // the user can resume watching while the file streams down.
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="watch-download-modal"
        className="rounded-2xl border border-stone-700/50 bg-stone-900 p-0 text-stone-100 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Download video</DialogTitle>

        {/* Header: thumbnail + metadata */}
        <div className="flex flex-col gap-6 p-6 pb-4 sm:flex-row sm:items-start sm:gap-6">
          <div
            data-testid="watch-download-modal-poster"
            className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-stone-800 sm:w-56"
          >
            {posterUrl ? (
              <Image
                src={posterUrl}
                alt={videoTitle ?? "Video poster"}
                fill
                sizes="(min-width: 640px) 224px, 100vw"
                className="object-cover"
              />
            ) : null}
            {durationLabel ? (
              <div
                data-testid="watch-download-modal-duration"
                className="absolute right-2 bottom-2 flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 text-xs font-semibold text-stone-100"
              >
                <Play size={12} fill="currentColor" />
                <span>{durationLabel}</span>
              </div>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <span className="text-xs font-semibold tracking-[0.18em] text-stone-400 uppercase">
              Download Video
            </span>
            <h2
              data-testid="watch-download-modal-title"
              className="text-2xl font-bold text-stone-50 sm:text-3xl"
            >
              {videoTitle ?? ""}
            </h2>
            {languageName ? (
              <span
                data-testid="watch-download-modal-language"
                className="inline-flex w-fit items-center gap-2 rounded-full border border-stone-700/70 bg-stone-800/50 px-3 py-1.5 text-xs font-medium text-stone-100"
              >
                <Globe2 size={14} />
                <span>{languageName}</span>
              </span>
            ) : null}
          </div>
        </div>

        {/* Body: file size dropdown */}
        <div className="px-6 pb-4">
          {tiers.length === 0 ? (
            <p
              data-testid="watch-download-modal-empty"
              className="rounded-lg border border-stone-700/50 bg-stone-800/40 px-4 py-3 text-sm text-stone-400"
            >
              No downloads are available for this video.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <label
                htmlFor={dropdownId}
                className="text-sm font-semibold text-stone-100"
              >
                Select a file size
              </label>
              <div className="relative">
                <button
                  ref={triggerRef}
                  id={dropdownId}
                  type="button"
                  onClick={() => setDropdownOpen((v) => !v)}
                  data-testid="watch-download-modal-size-trigger"
                  data-open={dropdownOpen ? "true" : "false"}
                  aria-haspopup="listbox"
                  aria-expanded={dropdownOpen}
                  aria-controls={dropdownListId}
                  className="flex w-full items-center justify-between rounded-lg border border-stone-700/70 bg-stone-950/40 px-4 py-3 text-left text-sm font-medium text-stone-100 transition hover:bg-stone-800/40"
                >
                  <span>
                    {selected ? (
                      <>
                        <span className="font-semibold">{selected.label}</span>
                        <SizeLabel
                          bytes={resolveSize(selected.download)}
                          className="ml-1 text-stone-300"
                        />
                      </>
                    ) : (
                      "Select a file size"
                    )}
                  </span>
                  <ChevronDown
                    size={18}
                    className={cn(
                      "transition-transform",
                      dropdownOpen ? "rotate-180" : "",
                    )}
                  />
                </button>
                {dropdownOpen ? (
                  <ul
                    ref={listRef}
                    id={dropdownListId}
                    role="listbox"
                    aria-labelledby={dropdownId}
                    data-testid="watch-download-modal-size-list"
                    className="absolute z-50 mt-2 w-full overflow-hidden rounded-lg border border-stone-700/70 bg-stone-900 shadow-2xl"
                  >
                    {tiers.map((t) => {
                      const isSelected = effectiveTier === t.tier
                      return (
                        <li key={t.tier}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            data-testid="watch-download-modal-size-option"
                            data-tier={t.tier}
                            data-size-bytes={resolveSize(t.download) ?? ""}
                            onClick={() => {
                              setSelectedTier(t.tier)
                              setDropdownOpen(false)
                            }}
                            className={cn(
                              "flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition",
                              isSelected
                                ? "bg-red-600 text-white"
                                : "text-stone-100 hover:bg-stone-800",
                            )}
                          >
                            <Check
                              size={16}
                              className={
                                isSelected ? "opacity-100" : "opacity-0"
                              }
                            />
                            <span className="font-semibold">{t.label}</span>
                            <SizeLabel
                              bytes={resolveSize(t.download)}
                              className={cn(
                                "text-xs",
                                isSelected ? "text-white/80" : "text-stone-400",
                              )}
                            />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* Footer: terms checkbox + download button */}
        <div className="mx-6 mb-6 flex flex-col gap-3 rounded-lg border border-stone-700/50 bg-stone-950/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex cursor-pointer items-center gap-3 text-sm text-stone-100">
            <span className="relative inline-flex shrink-0 items-center justify-center">
              <input
                type="checkbox"
                checked={tosAgreed}
                onChange={(e) => setTosAgreed(e.target.checked)}
                data-testid="watch-download-modal-tos"
                className="peer size-4 cursor-pointer appearance-none rounded-full border-2 border-stone-500 bg-transparent transition-colors hover:border-stone-300 checked:border-red-600 checked:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
              />
              <Check
                size={10}
                strokeWidth={3}
                aria-hidden="true"
                className="pointer-events-none absolute text-white opacity-0 peer-checked:opacity-100"
              />
            </span>
            <span>
              I agree to the{" "}
              <a
                href={TERMS_OF_USE_URL}
                target="_blank"
                rel="noreferrer noopener"
                data-testid="watch-download-modal-tos-link"
                className="font-semibold text-red-500 underline-offset-4 hover:underline"
              >
                Terms of Use
              </a>
            </span>
          </label>
          <Button
            variant="pill"
            onClick={handleDownload}
            disabled={!canDownload}
            aria-label="Download"
            data-testid="watch-download-modal-confirm"
          >
            <DownloadIcon size={16} />
            <span>Download</span>
          </Button>
        </div>

        {error ? (
          <p
            data-testid="watch-download-modal-error"
            role="alert"
            className="px-6 pb-6 text-sm text-red-400"
          >
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
