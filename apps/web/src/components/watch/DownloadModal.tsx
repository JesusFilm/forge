"use client"

import {
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import Image from "next/image"
import {
  Check,
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
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"
import { TierListbox } from "@/components/watch/TierListbox"
import { cn } from "@/lib/utils"
import { resolveDownloadSessionAccess } from "@/components/watch/download-session-access"
import { redirectToAuth } from "@/components/watch/download-session-client"
import {
  buildDownloadFilename,
  buildDownloadProxyUrl,
  type DownloadSequence,
} from "@/components/watch/download-link"
import {
  bucketDownloads,
  type DownloadTier as Tier,
  type WatchDownloadOption,
} from "@/components/watch/download-options"
import {
  WATCH_MODAL_ACTION_WRAP_CLASS,
  WATCH_MODAL_FILM_WIDTH_CLASS,
  WATCH_MODAL_PAGE_SCROLL_CONTENT_CLASS,
  WATCH_MODAL_PAGE_SCROLL_VIEWPORT_CLASS,
} from "@/components/watch/watch-modal-presentation"
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
  downloadSequence?: DownloadSequence | null
  variantId: string
  videoSlug: string
  accountGateEnabled?: boolean
  authRequiredLoginUrl?: string | null
  onClose: () => void
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
  downloadSequence = null,
  variantId,
  videoSlug,
  accountGateEnabled = false,
  authRequiredLoginUrl = null,
  onClose,
}: DownloadModalProps) {
  const t = useTranslations("DownloadModal")
  const fileSizeLabel = t("fileSizeLabel")
  // One full sentence per locale, so translators can put the verb and the
  // linked phrase where their grammar needs them (verb-final languages lost
  // the verb when this was a prefix + link + suffix concatenation). The
  // checkbox's accessible name is the same sentence with the tag stripped.
  const termsAgreementLabel = t.markup("termsAgreement", {
    link: (chunks) => chunks,
  })
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
  const [error, setError] = useState<string | null>(null)
  const [localAuthLoginUrl, setLocalAuthLoginUrl] = useState<string | null>(
    null,
  )
  const [authChecking, setAuthChecking] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const termsTriggerRef = useRef<HTMLButtonElement>(null)
  const fileSizeLabelId = useId()
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

  const openTerms = useCallback(() => setTermsOpen(true), [])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setTosAgreed(false)
        setSelectedTier(null)
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
      sequence: downloadSequence,
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
      {/* The row wraps: at large text the fixed-width poster leaves the title
          column too narrow, so the title drops below the poster instead of
          running past the dialog edge. */}
      <div className="flex flex-col gap-6 sm:flex-row sm:flex-wrap sm:items-start sm:gap-6">
        <div
          data-testid="watch-download-modal-poster"
          className="relative aspect-video w-full shrink-0 overflow-hidden rounded-2xl bg-stone-800 sm:w-56 sm:max-w-full"
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
              className="absolute right-2 bottom-2 flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 text-sm sm:text-xs font-semibold text-stone-100"
            >
              <Play size={12} fill="currentColor" />
              <span>{durationLabel}</span>
            </div>
          ) : null}
        </div>

        <div className="flex min-w-[min(100%,12rem)] flex-1 flex-col gap-3">
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
              className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-base sm:text-sm font-semibold text-stone-100"
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
          className={`${WATCH_MODAL_PAGE_SCROLL_CONTENT_CLASS} ${WATCH_MODAL_FILM_WIDTH_CLASS} grid-cols-[minmax(0,1fr)] border-0 bg-transparent p-0 text-stone-100 ring-0`}
          overlayClassName="bg-black/85 supports-backdrop-filter:backdrop-blur-md"
          viewportClassName={WATCH_MODAL_PAGE_SCROLL_VIEWPORT_CLASS}
          showCloseButton={false}
        >
          <WatchModalViewportCloseButton
            open={open}
            onClose={() => handleOpenChange(false)}
            testId="watch-download-modal-close"
            renderInline
            inFlowBelowSm
          />
          <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>

          <div
            data-testid="watch-download-modal-content"
            className="flex flex-col gap-7"
          >
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
                  className="h-auto w-full cursor-pointer rounded-full border border-transparent px-7 py-4 text-base sm:text-sm font-bold tracking-wider text-stone-400 uppercase transition-colors duration-200 hover:border-white/30 hover:bg-transparent hover:text-stone-100 focus-visible:border-white/50 sm:w-auto"
                >
                  {t("keepWatching")}
                </Button>
              </div>

              <h3 className="text-lg font-semibold text-stone-50">
                {t("authRequiredTitle")}
              </h3>
              <p className="text-base sm:text-sm leading-6 text-stone-400">
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
        className={`${WATCH_MODAL_PAGE_SCROLL_CONTENT_CLASS} ${WATCH_MODAL_FILM_WIDTH_CLASS} grid-cols-[minmax(0,1fr)] border-0 bg-transparent p-0 text-stone-100 ring-0`}
        overlayClassName="bg-black/85 supports-backdrop-filter:backdrop-blur-md"
        viewportClassName={WATCH_MODAL_PAGE_SCROLL_VIEWPORT_CLASS}
        showCloseButton={false}
      >
        <WatchModalViewportCloseButton
          open={open}
          onClose={() => handleOpenChange(false)}
          testId="watch-download-modal-close"
          renderInline
          inFlowBelowSm
        />
        <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>

        <div
          data-testid="watch-download-modal-content"
          className="flex flex-col gap-7"
        >
          {modalHeader}

          {/* Body: file size dropdown */}
          <div>
            {tiers.length === 0 ? (
              <p
                data-testid="watch-download-modal-empty"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-base sm:text-sm font-semibold text-stone-400"
              >
                {t("noDownloads")}
              </p>
            ) : (
              <div className="-mx-2 flex flex-col gap-3 px-2">
                <span
                  id={fileSizeLabelId}
                  className="text-lg font-semibold text-stone-100"
                >
                  {fileSizeLabel}
                </span>
                {/* Reset the popup before Terms takes the top layer. The
                    selected quality remains owned by this modal. */}
                <TierListbox
                  key={termsOpen ? "terms-open" : "download"}
                  tiers={tiers.map((option) => option.tier)}
                  value={effectiveTier}
                  onChange={setSelectedTier}
                  getLabel={tierLabel}
                  placeholder={fileSizeLabel}
                  labelledBy={fileSizeLabelId}
                  testIdPrefix="watch-download-modal-size"
                />
              </div>
            )}
          </div>

          {error ? (
            <p
              data-testid="watch-download-modal-error"
              role="alert"
              className="text-base sm:text-sm font-semibold text-brand-red"
            >
              {error}
            </p>
          ) : null}

          <div
            data-testid="watch-download-modal-confirmation-row"
            className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-4"
          >
            {/* Not a <label>: the sentence contains the Terms button, and an
                interactive control must not be nested inside a label. The
                checkbox carries the sentence as its accessible name, and a
                click on the sentence's plain text still toggles it. */}
            <div className="flex min-w-[min(100%,12rem)] flex-1 items-start gap-3 text-base sm:text-sm font-normal text-stone-100">
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
              {/* Mouse convenience only; keyboard and assistive-technology
                  users operate the checkbox itself. */}
              <span
                data-testid="watch-download-modal-tos-label"
                className={selected == null ? undefined : "cursor-pointer"}
                onClick={(event) => {
                  // Clicks on the Terms button target the button, not this span.
                  if (event.target !== event.currentTarget || selected == null)
                    return
                  setTosAgreed((agreed) => !agreed)
                }}
              >
                {t.rich("termsAgreement", {
                  link: (chunks) => (
                    <button
                      ref={termsTriggerRef}
                      type="button"
                      onClick={openTerms}
                      data-testid="watch-download-modal-tos-trigger"
                      className="inline cursor-pointer align-baseline leading-inherit font-normal text-brand-red underline decoration-brand-red/40 underline-offset-2 hover:decoration-brand-red focus-visible:ring-2 focus-visible:ring-brand-red/50 focus-visible:outline-none"
                    >
                      {chunks}
                    </button>
                  ),
                })}
              </span>
            </div>

            {/* The row wraps: when the Terms sentence and both buttons do not
                fit side by side (a narrow dialog or large text), the buttons
                drop below the sentence instead of widening the dialog past
                the screen. The group wraps too, so on 320-360px phones the
                two buttons stack. At 200% text one button is wider than the
                dialog, so each label wraps as well (with the content's
                `minmax(0,1fr)` column). */}
            <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-3">
              <Button
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                className="h-auto max-w-full shrink cursor-pointer rounded-full px-5 py-3.5 text-center text-base sm:text-sm font-bold tracking-wider whitespace-normal text-stone-400 uppercase transition-colors duration-200 hover:bg-transparent hover:text-stone-100"
              >
                {t("close")}
              </Button>
              <Button
                variant="pill"
                onClick={handleDownload}
                disabled={!canDownload}
                aria-label={t("download")}
                data-testid="watch-download-modal-confirm"
                className={cn(
                  WATCH_MODAL_ACTION_WRAP_CLASS,
                  "px-[min(1.75rem,8.75vw)] py-4 text-base sm:text-sm",
                )}
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
        returnFocusRef={termsTriggerRef}
        onCancel={() => setTermsOpen(false)}
        onAccept={() => {
          setTosAgreed(true)
          setTermsOpen(false)
        }}
      />
    </Dialog>
  )
}

const TERMS_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Wraps Tab/Shift+Tab at the first/last control of the Terms layer, and pulls
// focus back in when it is somewhere else (for example on <body> after a click
// on non-focusable text).
function keepTabFocusInside(event: KeyboardEvent, section: HTMLElement | null) {
  if (section === null) return
  const focusable = Array.from(
    section.querySelectorAll<HTMLElement>(TERMS_FOCUSABLE_SELECTOR),
  )
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (first === undefined || last === undefined) {
    event.preventDefault()
    section.focus()
    return
  }
  const active = document.activeElement
  if (!section.contains(active)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  } else if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

type TermsOfUseDialogProps = {
  open: boolean
  onCancel: () => void
  onAccept: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
}

function TermsOfUseDialog({
  open,
  onCancel,
  onAccept,
  returnFocusRef,
}: TermsOfUseDialogProps) {
  const t = useTranslations("DownloadModal")
  const sectionRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // This layer is portaled outside the parent dialog, so nothing else moves
  // focus into it, back out, or keeps the page behind it from being tabbed
  // into. Focus its Close button on open and make everything else on the page
  // inert while it is open; on close, return to the link that opened it
  // unless the user moved focus elsewhere.
  useEffect(() => {
    if (!open) return
    const section = sectionRef.current
    const overlay = section?.parentElement
    const returnFocusTarget = returnFocusRef?.current
    const inertedSiblings: Element[] = []
    for (const sibling of Array.from(document.body.children)) {
      if (sibling === overlay || sibling.hasAttribute("inert")) continue
      sibling.setAttribute("inert", "")
      inertedSiblings.push(sibling)
    }
    closeButtonRef.current?.focus()
    return () => {
      for (const sibling of inertedSiblings) sibling.removeAttribute("inert")
      const active = document.activeElement
      if (
        active === null ||
        active === document.body ||
        section?.contains(active)
      ) {
        returnFocusTarget?.focus()
      }
    }
  }, [open, returnFocusRef])

  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        onCancel()
        return
      }
      if (event.key === "Tab") keepTabFocusInside(event, sectionRef.current)
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
      className="fixed inset-0 z-[70] flex overflow-x-hidden overflow-y-auto bg-black/60 p-4 supports-backdrop-filter:backdrop-blur-sm"
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
        ref={sectionRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="watch-download-modal-terms-title"
        tabIndex={-1}
        data-testid="watch-download-modal-terms-dialog"
        className="m-auto flex w-full shrink-0 flex-col gap-0 rounded-2xl border border-stone-700/60 bg-stone-900 p-0 text-stone-100 outline-none sm:max-w-2xl"
        onClick={stopNestedDialogEvent}
        onPointerDown={stopNestedDialogEvent}
      >
        <div className="flex items-start justify-between gap-3 px-[min(2rem,10vw)] pt-8 pb-4">
          <h2
            id="watch-download-modal-terms-title"
            data-testid="watch-download-modal-terms-title"
            className="min-w-0 text-2xl font-bold [overflow-wrap:anywhere] text-stone-50 sm:text-3xl"
          >
            {t("termsOfUse")}
          </h2>
          <button
            ref={closeButtonRef}
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
          className="space-y-4 pr-[min(1.5rem,7.5vw)] pb-6 pl-[min(2rem,10vw)] text-base sm:text-sm leading-relaxed [overflow-wrap:anywhere] text-stone-200"
        >
          {TERMS_OF_USE_PARAGRAPHS.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>

        <div
          data-testid="watch-download-modal-terms-footer"
          className="flex flex-col gap-4 border-t border-stone-700/50 px-[min(2rem,10vw)] py-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <p
            data-testid="watch-download-modal-terms-canonical-notice"
            className="max-w-lg text-sm sm:text-xs leading-relaxed text-stone-400"
          >
            We include these terms here to make them easy to review. You can
            always find the most current version at{" "}
            <a
              href={TERMS_OF_USE_CANONICAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="cursor-pointer [overflow-wrap:anywhere] text-stone-200 underline decoration-stone-500 underline-offset-2 hover:text-white hover:decoration-white"
            >
              {TERMS_OF_USE_CANONICAL_URL}
            </a>
            .
          </p>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              data-testid="watch-download-modal-terms-cancel"
              className="max-w-full cursor-pointer rounded-full bg-stone-700/60 px-[min(1.25rem,6.25vw)] py-2.5 text-base sm:text-sm font-medium [overflow-wrap:anywhere] text-stone-100 transition-colors hover:bg-stone-600 focus-visible:ring-2 focus-visible:ring-stone-400/50 focus-visible:outline-none"
            >
              {t("cancel")}
            </button>
            <Button
              variant="pill"
              onClick={onAccept}
              data-testid="watch-download-modal-terms-accept"
              className={cn(
                WATCH_MODAL_ACTION_WRAP_CLASS,
                "px-[min(1.25rem,6.25vw)]",
              )}
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
