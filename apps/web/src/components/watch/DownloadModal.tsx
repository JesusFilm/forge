"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Image from "next/image"
import {
  Check,
  ChevronDown,
  Download as DownloadIcon,
  Globe2,
  LogIn,
  Play,
  X as XIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { formatDuration as formatDurationShared } from "@/lib/format-duration"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"
import { resolveDownloadSessionAccess } from "@/components/watch/download-session-access"
import { redirectToAuth } from "@/components/watch/download-session-client"
import {
  buildDownloadFilename,
  buildDownloadProxyUrl,
  type DownloadProxyParams,
} from "@/components/watch/download-link"
import {
  bucketDownloads,
  formatDownloadSize,
  type DownloadTier as Tier,
  type WatchDownloadOption,
} from "@/components/watch/download-options"
import { WatchModalViewportCloseButton } from "./WatchModalViewportCloseButton"

export type DownloadModalDownload = WatchDownloadOption

export type DownloadModalProps = {
  open: boolean
  downloads: DownloadModalDownload[]
  videoTitle?: string | null
  posterUrl?: string | null
  /** Variant duration in seconds (used for the runtime overlay on the thumbnail). */
  durationSeconds?: number | null
  languageCode?: string | null
  languageName?: string | null
  languageSlug?: string | null
  variantId: string
  videoSlug: string
  authRequiredLoginUrl?: string | null
  onClose: () => void
}

const SIZE_DROPDOWN_ANIMATION_MS = 160

// Probe the same-origin download proxy for a `Content-Length` when the
// CMS-provided `size` is missing or zero. Returns null on any failure so
// the UI can fall back to rendering just the tier label.
async function fetchSizeFromProxy(
  params: DownloadProxyParams,
  signal: AbortSignal,
): Promise<number | null> {
  try {
    const res = await fetch(buildDownloadProxyUrl(params), {
      method: "HEAD",
      signal,
    })
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
  const label = formatDownloadSize(bytes)
  if (!label) return null
  return <span className={className}>({label})</span>
}

// Thin null-tolerant wrapper around the shared formatter. The download
// modal renders nothing when duration is missing or non-positive
// (previously returned `null`); preserving that semantic keeps the JSX
// checks (`durationLabel != null`) unchanged. Note: the shared
// formatter does NOT zero-pad the leading segment (`1:10`, not
// `01:10`) — that's a visible label format change for this modal
// matching the standard media-duration convention used elsewhere.
function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  return formatDurationShared(seconds)
}

export function DownloadModal({
  open,
  downloads,
  videoTitle,
  posterUrl,
  durationSeconds,
  languageCode,
  languageName,
  languageSlug,
  variantId,
  videoSlug,
  authRequiredLoginUrl = null,
  onClose,
}: DownloadModalProps) {
  const t = useTranslations("DownloadModal")
  const fileSizeLabel = t("fileSizeLabel")
  const tWatchModal = useTranslations("WatchModal")
  // Localized label for a quality tier. `bucketDownloads` carries an English
  // `label` for back-compat, but the rendered text is resolved here so it
  // translates.
  const tierLabel = (tier: Tier): string =>
    tier === "highest"
      ? t("tierHighest")
      : tier === "high"
        ? t("tierHigh")
        : t("tierLow")
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [dropdownMounted, setDropdownMounted] = useState(false)
  const [dropdownRect, setDropdownRect] = useState<{
    left: number
    top: number
    width: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [localAuthLoginUrl, setLocalAuthLoginUrl] = useState<string | null>(
    null,
  )
  const [authChecking, setAuthChecking] = useState(false)
  // Keyed by download id so raw CDN URLs never need to enter the client bundle.
  const [probedSizes, setProbedSizes] = useState<Record<string, number | null>>(
    {},
  )
  // Probe attempts (success OR failure) are tracked here so dedup is
  // decoupled from result state — using `probedSizes` for both would put
  // it in the probe effect's deps and cause an extra no-op effect run per
  // batch. Survives modal close/reopen so a rapid open-close-open cycle
  // doesn't re-issue HEAD requests for downloads we already tried.
  const attemptedDownloadIdsRef = useRef<Set<string>>(new Set())
  const dropdownId = useId()
  const dropdownListId = `${dropdownId}-list`
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  // Re-entry guard: blocks a double-click / stray pointer event from
  // queueing a second proxy request before the modal-close re-render
  // hides the button.
  const downloadInFlight = useRef<boolean>(false)
  const requestVersionRef = useRef(0)

  const tiers = useMemo(() => bucketDownloads(downloads), [downloads])

  // Resolves the effective size for a tier: prefer the CMS-provided
  // value if valid, else a previously probed value, else null.
  const resolveSize = useCallback(
    (download: DownloadModalDownload): number | null => {
      const cms = download.size
      if (cms != null && cms > 0) return cms
      const probed = probedSizes[download.documentId]
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
  const effectiveAuthLoginUrl = authRequiredLoginUrl ?? localAuthLoginUrl
  const authRequired = effectiveAuthLoginUrl != null
  const canDownload = selected != null && !authChecking
  const durationLabel = formatDuration(durationSeconds)

  const updateDropdownRect = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    setDropdownRect({
      left: rect.left,
      top: rect.bottom + 8,
      width: rect.width,
    })
  }, [])

  const closeDropdown = useCallback(() => {
    if (dropdownOpen) setDropdownMounted(true)
    setDropdownOpen(false)
  }, [dropdownOpen])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setSelectedTier(null)
        setDropdownOpen(false)
        setDropdownMounted(false)
        setDropdownRect(null)
        setError(null)
        setAuthChecking(false)
        downloadInFlight.current = false
        requestVersionRef.current += 1
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
    if (authRequired) return
    const attempted = attemptedDownloadIdsRef.current
    const missingDownloads = tiers
      .map((t) => t.download)
      .filter((d) => !(d.size != null && d.size > 0))
      .filter((download) => !attempted.has(download.documentId))
    if (missingDownloads.length === 0) return
    const uniqueDownloads = Array.from(
      new Map(
        missingDownloads.map((download) => [download.documentId, download]),
      ).values(),
    )
    // Reserve slots synchronously so a re-open during the in-flight
    // batch doesn't trigger duplicate HEADs.
    for (const download of uniqueDownloads) attempted.add(download.documentId)
    const controller = new AbortController()
    void Promise.all(
      uniqueDownloads.map(async (download) => {
        const size = await fetchSizeFromProxy(
          {
            downloadId: download.documentId,
            variantId,
            videoSlug,
          },
          controller.signal,
        )
        return [download.documentId, size] as const
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
  }, [authRequired, open, tiers, variantId, videoSlug])

  useEffect(() => {
    if (dropdownOpen) return
    if (!dropdownMounted) return
    const timeout = window.setTimeout(() => {
      setDropdownMounted(false)
      setDropdownRect(null)
    }, SIZE_DROPDOWN_ANIMATION_MS)
    return () => window.clearTimeout(timeout)
  }, [dropdownMounted, dropdownOpen])

  // Click-outside / Escape-first close for the custom dropdown. Without
  // this, clicking elsewhere in the modal leaves the listbox open
  // forever, and pressing Escape dismisses the entire dialog instead of
  // collapsing only the dropdown.
  useEffect(() => {
    if (!dropdownOpen) return
    updateDropdownRect()
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) return
      if (
        triggerRef.current?.contains(target) ||
        listRef.current?.contains(target)
      ) {
        return
      }
      closeDropdown()
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Stop propagation so base-ui's dialog Escape handler doesn't
        // also fire and close the entire modal.
        event.stopPropagation()
        closeDropdown()
        triggerRef.current?.focus()
      }
    }
    function handleViewportChange() {
      updateDropdownRect()
    }
    document.addEventListener("pointerdown", handlePointerDown, true)
    document.addEventListener("keydown", handleKeyDown, true)
    window.addEventListener("resize", handleViewportChange)
    window.addEventListener("scroll", handleViewportChange, true)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true)
      document.removeEventListener("keydown", handleKeyDown, true)
      window.removeEventListener("resize", handleViewportChange)
      window.removeEventListener("scroll", handleViewportChange, true)
    }
  }, [closeDropdown, dropdownOpen, updateDropdownRect])

  async function handleDownload() {
    if (!selected) return
    if (downloadInFlight.current) return
    const requestVersion = ++requestVersionRef.current
    setError(null)
    downloadInFlight.current = true
    setAuthChecking(true)

    const session = await resolveDownloadSessionAccess()
    if (requestVersionRef.current !== requestVersion) return
    if (!session.ok && session.reason === "session-unavailable") {
      downloadInFlight.current = false
      setAuthChecking(false)
      setError(t("errorSessionUnavailable"))
      return
    }
    if (!session.ok) {
      downloadInFlight.current = false
      setAuthChecking(false)
      setError(null)
      setLocalAuthLoginUrl(session.loginUrl)
      return
    }
    setAuthChecking(false)

    const filename = buildDownloadFilename({
      languageCode,
      languageName,
      languageSlug,
      renditionHeight: selected.download.height,
      tier: selected.tier,
      videoSlug,
      videoTitle,
    })

    // Route through our same-origin streaming proxy so the browser honors
    // the `download` attribute and `Content-Disposition: attachment`. A
    // direct cross-origin link gets navigated by the browser instead of
    // handed to the download manager.
    const proxy = buildDownloadProxyUrl({
      downloadId: selected.download.documentId,
      filename,
      variantId,
      videoSlug,
    })

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

  const modalHeader = (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end sm:hidden">
        <button
          type="button"
          aria-label={tWatchModal("close")}
          data-testid="watch-download-modal-mobile-close"
          onClick={() => handleOpenChange(false)}
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-transparent text-stone-300 transition hover:text-white focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none sm:hidden"
        >
          <XIcon aria-hidden className="h-6 w-6" />
        </button>
      </div>

      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-6">
        <div
          data-testid="watch-download-modal-poster"
          className="relative aspect-video w-full shrink-0 overflow-hidden rounded-2xl bg-stone-800 sm:w-56"
        >
          {posterUrl ? (
            <Image
              src={posterUrl}
              alt={videoTitle ?? t("posterAlt")}
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
          <span
            data-testid="watch-download-modal-eyebrow"
            className={WATCH_SECTION_EYEBROW_CLASS}
          >
            {t("eyebrow")}
          </span>
          <h2
            data-testid="watch-download-modal-title"
            className="text-2xl leading-tight font-semibold text-stone-50 sm:text-3xl"
          >
            {videoTitle ?? ""}
          </h2>
          {languageName ? (
            <span
              data-testid="watch-download-modal-language"
              className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-stone-100"
            >
              <Globe2 size={14} />
              <span>{languageName}</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )

  if (authRequired) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <WatchModalViewportCloseButton
          open={open}
          onClose={() => handleOpenChange(false)}
          testId="watch-download-modal-close"
          className="hidden sm:flex"
        />
        <DialogContent
          data-testid="watch-download-modal"
          className="w-full max-w-[min(90vw,608px)] border-0 bg-transparent p-0 text-stone-100 ring-0 sm:max-w-[608px]"
          overlayClassName="bg-black/85 supports-backdrop-filter:backdrop-blur-md"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>

          <div className="flex max-h-[82vh] flex-col gap-7 overflow-y-auto pr-2 [scrollbar-color:theme(colors.stone.700)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-700 [&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-stone-600">
            {modalHeader}

            <div
              data-testid="watch-download-modal-auth-required"
              className="rounded-2xl border border-white/10 bg-white/5 px-5 py-5"
            >
              <h3 className="text-lg font-semibold text-stone-50">
                {t("authRequiredTitle")}
              </h3>
              <p className="mt-2 text-sm leading-6 text-stone-300">
                {t("authRequiredBody")}
              </p>
            </div>

            <div className="flex items-center justify-end gap-5 pt-2">
              <Button
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                className="cursor-pointer rounded-full px-5 py-3.5 text-sm font-bold tracking-wider text-stone-400 uppercase transition-colors duration-200 hover:bg-transparent hover:text-stone-100"
              >
                {t("close")}
              </Button>
              <Button
                variant="pill"
                onClick={() =>
                  redirectToAuth(effectiveAuthLoginUrl, {
                    reopenDownload: true,
                  })
                }
                aria-label={t("signInToDownload")}
                data-testid="watch-download-modal-sign-in"
                className="px-7 py-4 text-sm"
              >
                <LogIn size={16} />
                <span>{t("signInToDownload")}</span>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <WatchModalViewportCloseButton
        open={open}
        onClose={() => handleOpenChange(false)}
        testId="watch-download-modal-close"
        className="hidden sm:flex"
      />
      <DialogContent
        data-testid="watch-download-modal"
        className="w-full max-w-[min(90vw,608px)] border-0 bg-transparent p-0 text-stone-100 ring-0 sm:max-w-[608px]"
        overlayClassName="bg-black/85 supports-backdrop-filter:backdrop-blur-md"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>

        <div className="flex max-h-[82vh] flex-col gap-7 overflow-y-auto pr-2 [scrollbar-color:theme(colors.stone.700)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-700 [&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-stone-600">
          {modalHeader}

          {/* Body: file size dropdown */}
          <div>
            {tiers.length === 0 ? (
              <p
                data-testid="watch-download-modal-empty"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-stone-400"
              >
                {t("noDownloads")}
              </p>
            ) : (
              <div className="-mx-2 flex flex-col gap-3 px-2">
                <label
                  htmlFor={dropdownId}
                  className="text-lg font-semibold text-stone-100"
                >
                  {fileSizeLabel}
                </label>
                <div className="relative">
                  <button
                    ref={triggerRef}
                    id={dropdownId}
                    type="button"
                    onClick={() => {
                      if (dropdownOpen) {
                        closeDropdown()
                        return
                      }
                      updateDropdownRect()
                      setDropdownMounted(false)
                      setDropdownOpen(true)
                    }}
                    data-testid="watch-download-modal-size-trigger"
                    data-open={dropdownOpen ? "true" : "false"}
                    aria-haspopup="listbox"
                    aria-expanded={dropdownOpen}
                    aria-controls={dropdownListId}
                    className="flex w-full cursor-pointer items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-left text-lg font-semibold text-stone-100 transition hover:bg-white/10"
                  >
                    <span>
                      {selected ? (
                        <>
                          <span className="font-semibold">
                            {tierLabel(selected.tier)}
                          </span>
                          <SizeLabel
                            bytes={resolveSize(selected.download)}
                            className="ml-1 text-stone-300"
                          />
                        </>
                      ) : (
                        fileSizeLabel
                      )}
                    </span>
                    <ChevronDown
                      size={20}
                      className={cn(
                        "transition-transform",
                        dropdownOpen ? "rotate-180" : "",
                      )}
                    />
                  </button>
                  {(dropdownOpen || dropdownMounted) &&
                  dropdownRect != null &&
                  typeof document !== "undefined"
                    ? createPortal(
                        <ul
                          ref={listRef}
                          id={dropdownListId}
                          role="listbox"
                          aria-labelledby={dropdownId}
                          data-testid="watch-download-modal-size-list"
                          data-open={dropdownOpen ? "true" : "false"}
                          className={cn(
                            "fixed z-[1000] max-h-72 origin-top overflow-y-auto rounded-2xl border border-white/10 bg-stone-950/95 shadow-2xl backdrop-blur-md transition-[opacity,transform] duration-150 ease-out",
                            dropdownOpen
                              ? "translate-y-0 scale-100 opacity-100"
                              : "pointer-events-none -translate-y-1 scale-[0.98] opacity-0",
                          )}
                          style={{
                            left: dropdownRect.left,
                            top: dropdownRect.top,
                            width: dropdownRect.width,
                          }}
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
                                  data-size-bytes={
                                    resolveSize(t.download) ?? ""
                                  }
                                  onClick={() => {
                                    setSelectedTier(t.tier)
                                    closeDropdown()
                                  }}
                                  className={cn(
                                    "flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left text-sm transition",
                                    isSelected
                                      ? "bg-brand-red text-white"
                                      : "text-stone-100 hover:bg-white/10",
                                  )}
                                >
                                  <Check
                                    size={16}
                                    className={
                                      isSelected ? "opacity-100" : "opacity-0"
                                    }
                                  />
                                  <span className="font-semibold">
                                    {tierLabel(t.tier)}
                                  </span>
                                  <SizeLabel
                                    bytes={resolveSize(t.download)}
                                    className={cn(
                                      "text-xs",
                                      isSelected
                                        ? "text-white/80"
                                        : "text-stone-400",
                                    )}
                                  />
                                </button>
                              </li>
                            )
                          })}
                        </ul>,
                        document.body,
                      )
                    : null}
                </div>
              </div>
            )}
          </div>

          {error ? (
            <p
              data-testid="watch-download-modal-error"
              role="alert"
              className="text-sm font-semibold text-brand-red"
            >
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-5 pt-2">
            <Button
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              className="cursor-pointer rounded-full px-5 py-3.5 text-sm font-bold tracking-wider text-stone-400 uppercase transition-colors duration-200 hover:bg-transparent hover:text-stone-100"
            >
              {t("close")}
            </Button>
            <Button
              variant="pill"
              onClick={handleDownload}
              disabled={!canDownload}
              aria-label={t("download")}
              data-testid="watch-download-modal-confirm"
              className="px-7 py-4 text-sm"
            >
              <DownloadIcon size={16} />
              <span>{authChecking ? t("checking") : t("download")}</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
