"use client"

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import Image from "next/image"
import { Copy, Facebook } from "lucide-react"
import { useTranslations } from "next-intl"

// Inline X (formerly Twitter) glyph — lucide-react still ships the legacy
// blue-bird Twitter icon AND exports its own `XIcon` (the close-button "x"),
// so we use a brand-specific name to avoid both shadowing and confusion.
// The X brand mark is a single-path SVG so an inline component keeps the
// modal free of an extra dependency.
function XBrandIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2H21.5l-7.5 8.572L23 22h-6.86l-5.36-6.78L4.6 22H1.34l8.04-9.187L1 2h6.99l4.84 6.21L18.244 2zm-1.2 18h1.86L7.04 4H5.07l11.974 16z" />
    </svg>
  )
}

import { env } from "@/env"
import { markWatchUrlAsShared } from "@/lib/playback-discovery"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  buildEmbedSnippet,
  buildFbShareUrl,
  buildXShareUrl,
  resolveWatchShareUrl,
} from "@/lib/share"
import { cn } from "@/lib/utils"
import { WatchModalViewportCloseButton } from "./WatchModalViewportCloseButton"

// Optional fields here accept explicit `null` from the parent's `?? null`
// fallback chain in WatchPageClient (`video.title ?? null`). The effective
// type is `string | null | undefined` — callers may pass any of the three
// without forcing a `?? undefined` re-coercion at every call site.
export type ShareModalProps = {
  open: boolean
  videoSlug: string
  currentLanguageSlug: string
  videoTitle?: string | null
  videoDescription?: string | null
  posterUrl?: string | null
  /** Mux playback id — used to build a portable iframe embed via player.mux.com. */
  playbackId?: string | null
  onShareAction?: (
    detail: "link_copy" | "embed_copy" | "facebook_intent" | "x_intent",
  ) => void
  onClose: () => void
}

type ShareTab = "link" | "embed"
type CopyStatus = "idle" | "copied" | "failed"

export function ShareModal({
  open,
  videoSlug,
  currentLanguageSlug,
  videoTitle,
  videoDescription,
  posterUrl,
  playbackId,
  onShareAction,
  onClose,
}: ShareModalProps) {
  const t = useTranslations("ShareModal")
  const [tab, setTab] = useState<ShareTab>("link")
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle")
  const embedRef = useRef<HTMLTextAreaElement | null>(null)
  const tabRefs = useRef<Record<ShareTab, HTMLButtonElement | null>>({
    link: null,
    embed: null,
  })
  const tabIdPrefix = useId()

  const canonicalShareableUrl = resolveWatchShareUrl({
    origin: env.NEXT_PUBLIC_CANONICAL_ORIGIN,
    videoSlug,
    languageSlug: currentLanguageSlug,
  })
  const shareableUrl = canonicalShareableUrl
    ? markWatchUrlAsShared(canonicalShareableUrl)
    : null
  // buildEmbedSnippet validates playbackId against PLAYBACK_ID_PATTERN before
  // interpolating into the iframe `src` and returns "" on null/invalid; the
  // Embed Code tab is also gated on `playbackId ?` below, so an invalid id
  // hides the tab entirely.
  const embedSnippet = buildEmbedSnippet(playbackId)

  const fbHref = shareableUrl ? buildFbShareUrl(shareableUrl) : null
  const xHref = shareableUrl
    ? buildXShareUrl(shareableUrl, videoTitle ?? undefined)
    : null

  const activeMode =
    tab === "embed" && embedSnippet
      ? "embed"
      : shareableUrl
        ? "link"
        : embedSnippet
          ? "embed"
          : null
  const isEmbed = activeMode === "embed"
  const currentValue =
    activeMode === "embed"
      ? embedSnippet
      : activeMode === "link"
        ? shareableUrl
        : null
  const copyLabel = isEmbed ? t("copyCode") : t("copyLink")
  const hasShareFormatTabs = Boolean(embedSnippet && shareableUrl)
  const linkTabId = `${tabIdPrefix}-link-tab`
  const embedTabId = `${tabIdPrefix}-embed-tab`
  const tabPanelId = `${tabIdPrefix}-panel`

  // Reset the "Copied" pill back to the default label after 2s so a second
  // click reads as a fresh copy. Cleanup clears the timer on unmount or when
  // copyStatus flips early (e.g. user switches tabs).
  useEffect(() => {
    if (copyStatus !== "copied") return
    const timer = window.setTimeout(() => {
      setCopyStatus("idle")
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [copyStatus])

  function handleOpenChange(next: boolean) {
    if (!next) {
      setTab("link")
      setCopyStatus("idle")
      onClose()
    }
  }

  function selectTab(next: ShareTab) {
    setTab(next)
    setCopyStatus("idle")
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const nextTab =
      event.key === "Home"
        ? "link"
        : event.key === "End"
          ? "embed"
          : event.key === "ArrowLeft" ||
              event.key === "ArrowUp" ||
              event.key === "ArrowRight" ||
              event.key === "ArrowDown"
            ? tab === "link"
              ? "embed"
              : "link"
            : null

    if (!nextTab) return

    event.preventDefault()
    selectTab(nextTab)
    // Keep focus with the selected tab so keyboard and assistive-technology
    // users receive the same active-tab state as pointer users.
    tabRefs.current[nextTab]?.focus()
  }

  async function copy(text: string, detail: "link_copy" | "embed_copy") {
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus("copied")
      onShareAction?.(detail)
    } catch {
      setCopyStatus("failed")
    }
  }

  // Auto-fit the embed textarea to its content so the full snippet is visible
  // without an inner scroll bar. Re-runs when the snippet changes (different
  // playbackId) and on viewport resize, since the textarea wraps differently
  // at different modal widths. `useLayoutEffect` runs before paint, so the
  // user never sees the rows-default height flash.
  //
  // Cap the auto-fit at 40% of the viewport so an extreme zoom or a malformed
  // snippet can't push the Copy Code button below the fold; switch the
  // textarea to inner-scroll once it would otherwise blow past the cap.
  useLayoutEffect(() => {
    if (!isEmbed) return
    const fit = () => {
      // Read the ref inside the closure rather than capturing it on the
      // outer effect run — concurrent rendering may swap the DOM node
      // underneath us between the effect setup and the resize callback.
      const el = embedRef.current
      if (!el) return
      el.style.height = "auto"
      const cap = window.innerHeight * 0.4
      const desired = el.scrollHeight
      if (desired > cap) {
        el.style.height = `${cap}px`
        el.style.overflowY = "auto"
      } else {
        el.style.height = `${desired}px`
        el.style.overflowY = "hidden"
      }
    }
    fit()
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [isEmbed, embedSnippet])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="watch-share-modal"
        className="w-full max-w-[min(90vw,608px)] border-0 bg-transparent p-0 text-stone-100 ring-0 sm:max-w-[608px]"
        overlayClassName="bg-black/85 supports-backdrop-filter:backdrop-blur-md"
        viewportClassName="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"
        showCloseButton={false}
      >
        <WatchModalViewportCloseButton
          open={open}
          onClose={() => handleOpenChange(false)}
          testId="watch-share-modal-close"
        />
        <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>

        <div className="flex max-h-[82vh] flex-col gap-6 overflow-y-auto pr-2 [scrollbar-color:theme(colors.stone.700)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-700 [&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-stone-600">
          <h2 className="text-2xl font-semibold text-stone-100">
            {t("heading")}
          </h2>

          <div className="flex flex-col gap-5 sm:flex-row sm:gap-6">
            <div
              data-testid="watch-share-modal-poster"
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
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {videoTitle ? (
                <h3
                  data-testid="watch-share-modal-title"
                  className="text-2xl leading-tight font-semibold text-stone-50 sm:text-3xl"
                >
                  {videoTitle}
                </h3>
              ) : null}
              {videoDescription ? (
                <p
                  data-testid="watch-share-modal-description"
                  className="line-clamp-4 text-base sm:text-sm leading-relaxed font-medium text-stone-300"
                >
                  {videoDescription}
                </p>
              ) : null}
            </div>
          </div>

          {fbHref && xHref ? (
            <div className="flex gap-3">
              <a
                href={fbHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${t("shareOnFacebook")} (opens in a new tab)`}
                data-testid="watch-share-modal-facebook"
                onClick={() => onShareAction?.("facebook_intent")}
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-[#1877F2] text-white transition hover:bg-[#0c63d4] focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
              >
                <Facebook size={18} fill="currentColor" stroke="none" />
              </a>
              <a
                href={xHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${t("shareOnX")} (opens in a new tab)`}
                data-testid="watch-share-modal-x"
                onClick={() => onShareAction?.("x_intent")}
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-black text-white transition hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
              >
                <XBrandIcon size={16} />
              </a>
            </div>
          ) : null}

          {/* Tab row only renders when there's a real choice to make
              (i.e., an embed snippet is available alongside the link).
              For series pages and any other share context with no
              playbackId, the link is the only mode — surfacing a single
              "Share Link" tab header alone reads as a meaningless
              non-choice, so we hide the whole tablist and let the link
              input flow directly under the social-share row. */}
          {hasShareFormatTabs ? (
            <div
              role="tablist"
              aria-label={t("shareFormat")}
              className="flex border-b border-white/10"
            >
              <button
                type="button"
                role="tab"
                id={linkTabId}
                aria-controls={tabPanelId}
                aria-selected={tab === "link"}
                tabIndex={tab === "link" ? 0 : -1}
                data-testid="watch-share-modal-tab-link"
                onClick={() => selectTab("link")}
                onKeyDown={handleTabKeyDown}
                ref={(element) => {
                  tabRefs.current.link = element
                }}
                className={cn(
                  "flex-1 cursor-pointer px-4 py-3 text-sm sm:text-xs font-semibold tracking-[0.18em] uppercase transition",
                  !isEmbed
                    ? "border-b-2 border-brand-red text-brand-red"
                    : "border-b-2 border-transparent text-stone-400 hover:text-stone-200",
                )}
              >
                {t("shareLinkTab")}
              </button>
              <button
                type="button"
                role="tab"
                id={embedTabId}
                aria-controls={tabPanelId}
                aria-selected={tab === "embed"}
                tabIndex={tab === "embed" ? 0 : -1}
                data-testid="watch-share-modal-tab-embed"
                onClick={() => selectTab("embed")}
                onKeyDown={handleTabKeyDown}
                ref={(element) => {
                  tabRefs.current.embed = element
                }}
                className={cn(
                  "flex-1 cursor-pointer px-4 py-3 text-sm sm:text-xs font-semibold tracking-[0.18em] uppercase transition",
                  isEmbed
                    ? "border-b-2 border-brand-red text-brand-red"
                    : "border-b-2 border-transparent text-stone-400 hover:text-stone-200",
                )}
              >
                {t("embedCodeTab")}
              </button>
            </div>
          ) : null}

          <p
            aria-atomic="true"
            aria-live="polite"
            className="sr-only"
            data-testid="watch-share-modal-copy-status"
            role="status"
          >
            {copyStatus === "copied"
              ? t("copied")
              : copyStatus === "failed"
                ? t("copyFailed")
                : ""}
          </p>

          <div
            aria-labelledby={
              hasShareFormatTabs
                ? isEmbed
                  ? embedTabId
                  : linkTabId
                : undefined
            }
            id={hasShareFormatTabs ? tabPanelId : undefined}
            role={hasShareFormatTabs ? "tabpanel" : undefined}
          >
            {copyStatus === "failed" ? (
              <p
                data-testid="watch-share-modal-link-fallback"
                className="mb-2 text-sm sm:text-xs font-semibold text-amber-400"
              >
                {t("copyFailed")}
              </p>
            ) : null}
            {activeMode === "embed" ? (
              <textarea
                ref={embedRef}
                data-testid="watch-share-modal-embed-input"
                readOnly
                aria-label={t("embedCodeTab")}
                // `rows={2}` is the minimum baseline; the auto-fit effect below
                // sets `style.height` to `scrollHeight` before paint so the full
                // snippet is visible without an inner scroll bar (capped at 40vh).
                rows={2}
                value={embedSnippet}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-5 py-4 font-mono text-sm sm:text-xs text-stone-100 focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:outline-none"
              />
            ) : activeMode === "link" ? (
              <input
                type="text"
                data-testid="watch-share-modal-link-input"
                readOnly
                aria-label={t("shareLinkTab")}
                value={currentValue ?? ""}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-base sm:text-sm font-semibold text-stone-100 focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:outline-none"
              />
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-5 pt-2">
            <Button
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              className="cursor-pointer rounded-full px-5 py-3.5 text-base sm:text-sm font-bold tracking-wider text-stone-400 uppercase transition-colors duration-200 hover:bg-transparent hover:text-stone-100"
            >
              {t("close")}
            </Button>
            {currentValue ? (
              <Button
                variant="pill"
                data-testid={
                  isEmbed
                    ? "watch-share-modal-embed-copy"
                    : "watch-share-modal-link-copy"
                }
                onClick={() =>
                  copy(currentValue, isEmbed ? "embed_copy" : "link_copy")
                }
                className="gap-2 px-7 py-4 text-base sm:text-sm"
              >
                <Copy size={16} />
                <span>{copyStatus === "copied" ? t("copied") : copyLabel}</span>
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
