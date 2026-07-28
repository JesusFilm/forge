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
import {
  TERMS_OF_USE_CANONICAL_URL,
  TERMS_OF_USE_PARAGRAPHS,
} from "@/lib/terms-of-use"
import { cn } from "@/lib/utils"
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"
import { resolveDownloadSessionAccess } from "@/components/watch/download-session-access"
import { redirectToAuth } from "@/components/watch/download-session-client"
import {
  buildDownloadFilename,
  buildDownloadProxyUrl,
} from "@/components/watch/download-link"
import {
  bucketDownloads,
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
  accountGateEnabled?: boolean
  authRequiredLoginUrl?: string | null
  onClose: () => void
}

const SIZE_DROPDOWN_ANIMATION_MS = 160

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
  accountGateEnabled = false,
  authRequiredLoginUrl = null,
  onClose,
}: DownloadModalProps) {
  const t = useTranslations("DownloadModal")
  const fileSizeLabel = t("fileSizeLabel")
  const termsAgreementLabel = `${t("termsAgreementPrefix")}${t(
    "termsOfUse",
  )}${t("termsAgreementSuffix")}`
  // Localized label for a quality tier. `bucketDownloads` carries an English
  // `label` for back-compat, but the rendered text is resolved here so it
  // translates.
  const tierLabel = (tier: Tier): string =>
    tier === "highest"
      ? t("tierHighest")
      : tier === "high"
        ? t("tierHigh")
        : t("tierLow")
  const [tosAgreed, setTosAgreed] = useState(false)
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
  const [termsOpen, setTermsOpen] = useState(false)
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
  const authRequired = accountGateEnabled && effectiveAuthLoginUrl != null
  const canDownload = tosAgreed && selected != null && !authChecking
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
        setTosAgreed(false)
        setSelectedTier(null)
        setDropdownOpen(false)
        setDropdownMounted(false)
        setDropdownRect(null)
        setError(null)
        setAuthChecking(false)
        setTermsOpen(false)
        downloadInFlight.current = false
        requestVersionRef.current += 1
        onClose()
      }
    },
    [onClose],
  )

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

    if (accountGateEnabled) {
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

    // Route through the same-origin resolver so the browser never sees raw CDN
    // URLs in markup. The resolver redirects to the media host so Web does not
    // carry the video stream.
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
        <DialogContent
          data-testid="watch-download-modal"
          className="w-full max-w-[min(90vw,608px)] border-0 bg-transparent p-0 text-stone-100 ring-0 sm:max-w-[608px]"
          overlayClassName="bg-black/85 supports-backdrop-filter:backdrop-blur-md"
          viewportClassName="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"
          showCloseButton={false}
        >
          <WatchModalViewportCloseButton
            open={open}
            onClose={() => handleOpenChange(false)}
            testId="watch-download-modal-close"
          />
          <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>

          <div className="flex max-h-[82vh] flex-col gap-7 overflow-y-auto pr-2 [scrollbar-color:theme(colors.stone.700)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-700 [&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-stone-600">
            {modalHeader}

            <div
              data-testid="watch-download-modal-auth-required"
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  variant="pill"
                  onClick={() =>
                    redirectToAuth(effectiveAuthLoginUrl, {
                      reopenDownload: true,
                    })
                  }
                  aria-label={t("signInToDownload")}
                  data-testid="watch-download-modal-sign-in"
                  className="w-full px-6 py-4 text-xs sm:w-auto sm:px-7 sm:text-sm"
                >
                  <LogIn size={16} aria-hidden />
                  <span>{t("signInToDownload")}</span>
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => handleOpenChange(false)}
                  data-testid="watch-download-modal-keep-watching"
                  className="h-auto w-full cursor-pointer rounded-full border border-transparent px-7 py-4 text-sm font-bold tracking-wider text-stone-400 uppercase transition-colors duration-200 hover:border-white/30 hover:bg-transparent hover:text-stone-100 focus-visible:border-white/50 sm:w-auto"
                >
                  {t("keepWatching")}
                </Button>
              </div>

              <h3 className="text-lg font-semibold text-stone-50">
                {t("authRequiredTitle")}
              </h3>
              <p className="text-sm leading-6 text-stone-400">
                {t("authRequiredBody")}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="watch-download-modal"
        className="w-full max-w-[min(90vw,608px)] border-0 bg-transparent p-0 text-stone-100 ring-0 sm:max-w-[608px]"
        overlayClassName="bg-black/85 supports-backdrop-filter:backdrop-blur-md"
        viewportClassName="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"
        showCloseButton={false}
      >
        <WatchModalViewportCloseButton
          open={open}
          onClose={() => handleOpenChange(false)}
          testId="watch-download-modal-close"
        />
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
                        <span className="font-semibold">
                          {tierLabel(selected.tier)}
                        </span>
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
                                    t.download.size != null &&
                                    t.download.size > 0
                                      ? t.download.size
                                      : ""
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

          <div
            data-testid="watch-download-modal-confirmation-row"
            className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <label className="flex cursor-pointer items-start gap-3 text-sm font-normal text-stone-100">
              <span className="relative mt-0.5 inline-flex shrink-0 items-center justify-center">
                <input
                  type="checkbox"
                  checked={tosAgreed}
                  disabled={selected == null}
                  onChange={(event) => setTosAgreed(event.target.checked)}
                  aria-label={termsAgreementLabel}
                  data-testid="watch-download-modal-tos"
                  className="peer size-4 cursor-pointer appearance-none rounded-[3px] border-2 border-stone-500 bg-transparent transition-colors hover:border-stone-300 checked:border-brand-red checked:bg-brand-red focus-visible:ring-2 focus-visible:ring-brand-red/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                />
                <Check
                  size={10}
                  strokeWidth={3}
                  aria-hidden="true"
                  className="pointer-events-none absolute text-white opacity-0 peer-checked:opacity-100"
                />
              </span>
              <span>
                {t("termsAgreementPrefix")}
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault()
                    setTermsOpen(true)
                  }}
                  data-testid="watch-download-modal-tos-trigger"
                  className="inline cursor-pointer align-baseline leading-inherit font-normal text-brand-red underline decoration-brand-red/40 underline-offset-2 hover:decoration-brand-red focus-visible:ring-2 focus-visible:ring-brand-red/50 focus-visible:outline-none"
                >
                  {t("termsOfUse")}
                </button>
                {t("termsAgreementSuffix")}
              </span>
            </label>

            <div className="flex shrink-0 items-center justify-end gap-3">
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
        </div>
      </DialogContent>

      <TermsOfUseDialog
        open={termsOpen}
        onCancel={() => setTermsOpen(false)}
        onAccept={() => {
          setTosAgreed(true)
          setTermsOpen(false)
        }}
      />
    </Dialog>
  )
}

type TermsOfUseDialogProps = {
  open: boolean
  onCancel: () => void
  onAccept: () => void
}

function TermsOfUseDialog({ open, onCancel, onAccept }: TermsOfUseDialogProps) {
  const t = useTranslations("DownloadModal")

  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }
    }

    document.addEventListener("keydown", handleKeyDown, true)
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [onCancel, open])

  if (!open || typeof document === "undefined") return null

  function stopNestedDialogEvent(event: { stopPropagation: () => void }) {
    event.stopPropagation()
  }

  return createPortal(
    <div
      aria-hidden="false"
      data-testid="watch-download-modal-terms-overlay"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 supports-backdrop-filter:backdrop-blur-sm"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }}
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="watch-download-modal-terms-title"
        data-testid="watch-download-modal-terms-dialog"
        className="flex max-h-[85vh] flex-col gap-0 rounded-2xl border border-stone-700/60 bg-stone-900 p-0 text-stone-100 sm:max-w-2xl"
        onClick={stopNestedDialogEvent}
        onPointerDown={stopNestedDialogEvent}
      >
        <div className="flex items-start justify-between px-8 pt-8 pb-4">
          <h2
            id="watch-download-modal-terms-title"
            data-testid="watch-download-modal-terms-title"
            className="text-2xl font-bold text-stone-50 sm:text-3xl"
          >
            {t("termsOfUse")}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("closeTermsOfUse")}
            data-testid="watch-download-modal-terms-close"
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-stone-700/60 text-stone-200 transition-colors hover:bg-stone-600 focus-visible:ring-2 focus-visible:ring-brand-red/50 focus-visible:outline-none"
          >
            <XIcon size={16} />
          </button>
        </div>

        <div
          data-testid="watch-download-modal-terms-body"
          className="flex-1 space-y-4 overflow-y-auto pr-6 pb-6 pl-8 text-sm leading-relaxed text-stone-200 [scrollbar-color:theme(colors.stone.700)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-700 [&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-stone-600"
        >
          {TERMS_OF_USE_PARAGRAPHS.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>

        <div
          data-testid="watch-download-modal-terms-footer"
          className="flex flex-col gap-4 border-t border-stone-700/50 px-8 py-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <p
            data-testid="watch-download-modal-terms-canonical-notice"
            className="max-w-lg text-xs leading-relaxed text-stone-400"
          >
            We include these terms here to make them easy to review. You can
            always find the most current version at{" "}
            <a
              href={TERMS_OF_USE_CANONICAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="cursor-pointer text-stone-200 underline decoration-stone-500 underline-offset-2 hover:text-white hover:decoration-white"
            >
              {TERMS_OF_USE_CANONICAL_URL}
            </a>
            .
          </p>
          <div className="flex shrink-0 items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              data-testid="watch-download-modal-terms-cancel"
              className="cursor-pointer rounded-full bg-stone-700/60 px-5 py-2.5 text-sm font-medium text-stone-100 transition-colors hover:bg-stone-600 focus-visible:ring-2 focus-visible:ring-stone-400/50 focus-visible:outline-none"
            >
              {t("cancel")}
            </button>
            <Button
              variant="pill"
              onClick={onAccept}
              data-testid="watch-download-modal-terms-accept"
            >
              {t("accept")}
            </Button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}
