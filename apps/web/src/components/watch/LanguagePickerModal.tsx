"use client"

import type { Route } from "next"
import { useRouter } from "next/navigation"
import type { RefObject } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Captions } from "lucide-react"

import type { MuxPlayerRef } from "@forge/video-player"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { LanguageCombobox } from "@/components/watch/LanguageCombobox"
import type { WatchSubtitle } from "@/lib/content"
import { deriveLanguageDisplay } from "@/lib/language-display"
import { writePreferredLanguageSlug } from "@/lib/language-preference-client"
import { isPlayableLanguageVariant } from "@/lib/playable-variant"
import { useIsFullscreen } from "@/lib/use-is-fullscreen"

export type LanguagePickerVariant = {
  documentId: string
  hls: string | null
  published: boolean | null
  language: {
    coreId?: string | null
    slug: string | null
    name: string | null
  } | null
}

export type LanguagePickerModalProps = {
  open: boolean
  variants: LanguagePickerVariant[]
  currentLanguageSlug: string
  videoSlug: string
  /** Read `currentTime` for the `?t=` clamp on language switch. */
  playerRef: RefObject<MuxPlayerRef | null>
  onClose: () => void
  /**
   * Surface that opened the picker. "video" appends `?t={currentTime}&
   * autoplay=1` so HeroPlayer resumes mid-stream with sound; "series"
   * navigates to the bare `/{slug}/{newLang}` because the series page
   * has no player and `autoplay=1` would mistakenly trigger trailer
   * autoplay on the destination. Defaults to "video" for back-compat.
   */
  kind?: "video" | "series"
  subtitles?: WatchSubtitle[]
  currentSubtitleEnabled?: boolean
  currentSubtitleSlug?: string | null
  onSubtitleChange?: (enabled: boolean, languageSlug: string | null) => void
}

// Safety cap on the in-flight navigation guard. router.push is fire-and-
// forget; if the navigation never lands (offline, abort, cookie-driven
// proxy redirect to a slug that doesn't match draftSlug), the modal-local
// guard would otherwise stay set and disable Apply for the rest of the
// session. After this timeout the guard releases so the user can retry.
const NAVIGATING_TIMEOUT_MS = 5000

export function LanguagePickerModal({
  open,
  variants,
  currentLanguageSlug,
  videoSlug,
  playerRef,
  onClose,
  kind = "video",
  subtitles = [],
  currentSubtitleEnabled = false,
  currentSubtitleSlug = null,
  onSubtitleChange,
}: LanguagePickerModalProps) {
  const router = useRouter()

  // Per row, deriveLanguageDisplay decides whether Strapi's `name` is a
  // formatted-up English (use it verbatim, e.g. "A-Hmao", "Achi, Rabinal")
  // or the native form (slug-derived English as primary, name as subtitle,
  // e.g. "Adygey" / "Адыгэбзэ", "French" / "Français"). Sort by the primary
  // so the list stays A→Z by English form.
  const options = useMemo(
    () =>
      variants
        .filter(isPlayableLanguageVariant)
        .map((v) => deriveLanguageDisplay(v.language.slug, v.language.name))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [variants],
  )

  const [draftSlug, setDraftSlug] = useState(currentLanguageSlug)
  const [draftSubtitleEnabled, setDraftSubtitleEnabled] = useState(
    currentSubtitleEnabled,
  )
  const [draftSubtitleSlug, setDraftSubtitleSlug] =
    useState(currentSubtitleSlug)

  const subtitleOptions = useMemo(
    () =>
      subtitles
        .map((s) => deriveLanguageDisplay(s.language.slug, s.language.name))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [subtitles],
  )

  // Track which slug we've dispatched a navigation toward. `navigating`
  // becomes false NATURALLY once the URL catches up — no setState in
  // effect required (React Compiler's anti-cascade rule is satisfied by
  // construction). Set to null to force-release on safety timeout.
  const [pendingNavTo, setPendingNavTo] = useState<string | null>(null)

  // Synchronous double-click guard. `pendingNavTo` state alone is async
  // (useState commit is post-render), so two clicks in the same microtask
  // both see `pendingNavTo === null` and dispatch two router.push calls.
  // The ref-wrapped object holds the synchronous truth for the gate. We
  // mutate `.inFlight` on the object rather than reassigning `.current` so
  // the React Compiler accepts the writes (`.current = X` is rejected
  // when the ref is also written from a useEffect).
  const navigatingRef = useRef<{ inFlight: boolean }>({ inFlight: false })

  // Reset the draft on the open false→true transition. Mirror
  // `currentLanguageSlug` into a ref via a commit-phase effect so the
  // open-effect (declared AFTER, runs AFTER per React effect ordering)
  // always reads the latest value even on a same-commit prop change.
  const currentLanguageSlugLatestRef = useRef(currentLanguageSlug)
  useEffect(() => {
    currentLanguageSlugLatestRef.current = currentLanguageSlug
  }, [currentLanguageSlug])
  const currentSubtitleEnabledRef = useRef(currentSubtitleEnabled)
  const currentSubtitleSlugRef = useRef(currentSubtitleSlug)
  useEffect(() => {
    currentSubtitleEnabledRef.current = currentSubtitleEnabled
    currentSubtitleSlugRef.current = currentSubtitleSlug
  }, [currentSubtitleEnabled, currentSubtitleSlug])
  useEffect(() => {
    if (open) {
      setDraftSlug(currentLanguageSlugLatestRef.current)
      setDraftSubtitleEnabled(currentSubtitleEnabledRef.current)
      setDraftSubtitleSlug(currentSubtitleSlugRef.current)
      navigatingRef.current.inFlight = false
      setPendingNavTo(null)
    }
  }, [open])

  const languageDirty = draftSlug !== currentLanguageSlug
  const subtitleDirty =
    draftSubtitleEnabled !== currentSubtitleEnabled ||
    draftSubtitleSlug !== currentSubtitleSlug
  const isDirty = languageDirty || subtitleDirty
  // Derived: navigating iff we dispatched and the URL hasn't caught up.
  // When currentLanguageSlug matches pendingNavTo, navigating flips to
  // false automatically on the next render — no setter call needed.
  const navigating =
    pendingNavTo !== null && currentLanguageSlug !== pendingNavTo

  // Release the sync guard once the URL catches up. The ref-mirror effect
  // is the only path that touches `.inFlight = false` outside the open
  // reset and timeout — fires once per slug change.
  useEffect(() => {
    navigatingRef.current.inFlight = false
  }, [currentLanguageSlug])

  // Safety timeout: if the navigation never lands (e.g. cookie-driven
  // proxy redirect to a slug that doesn't match draftSlug, or router.push
  // silently fails), release the guard and clear pendingNavTo so the user
  // can retry. Re-armed whenever a new navigation starts.
  useEffect(() => {
    if (pendingNavTo === null) return
    const timer = window.setTimeout(() => {
      navigatingRef.current.inFlight = false
      setPendingNavTo(null)
    }, NAVIGATING_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [pendingNavTo])

  const handleApply = useCallback(() => {
    if (!isDirty) return
    if (navigatingRef.current.inFlight) return
    if (!videoSlug) return

    if (subtitleDirty) {
      onSubtitleChange?.(draftSubtitleEnabled, draftSubtitleSlug)
    }

    if (languageDirty) {
      navigatingRef.current.inFlight = true
      setPendingNavTo(draftSlug)
      writePreferredLanguageSlug(draftSlug)
      let href: Route
      if (kind === "series") {
        href = `/${videoSlug}/${draftSlug}` as Route
      } else {
        const rawT = playerRef.current?.currentTime
        const t = Number.isFinite(rawT) ? rawT : 0
        href = `/${videoSlug}/${draftSlug}?t=${t}&autoplay=1` as Route
      }
      router.push(href)
    }

    onClose()
  }, [
    draftSlug,
    draftSubtitleEnabled,
    draftSubtitleSlug,
    isDirty,
    kind,
    languageDirty,
    onClose,
    onSubtitleChange,
    playerRef,
    router,
    subtitleDirty,
    videoSlug,
  ])

  function handleOpenChange(next: boolean) {
    if (!next) onClose()
  }

  // When the player is in fullscreen, portal the dialog INTO the
  // fullscreened element so the modal renders on top of the video.
  // Without this, base-ui's Dialog portals to <body> which is OUTSIDE
  // the fullscreen element — the browser hides it, focus lands in a
  // hidden subtree, and Escape closes the dialog instead of exiting
  // fullscreen. document.fullscreenElement is the canonical reference;
  // it stays null outside fullscreen, in which case DialogContent falls
  // back to its default <body> mount.
  const isFullscreen = useIsFullscreen()
  const portalContainer =
    isFullscreen && typeof document !== "undefined"
      ? ((document.fullscreenElement ??
          (
            document as Document & {
              webkitFullscreenElement?: Element | null
            }
          ).webkitFullscreenElement ??
          null) as HTMLElement | null)
      : null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="watch-language-picker-modal"
        className="rounded-2xl border border-stone-700/50 bg-stone-900 p-0 text-stone-100 sm:max-w-xl"
        overlayClassName="bg-black/75"
        showCloseButton={false}
        portalContainer={portalContainer}
      >
        <DialogTitle className="sr-only">
          Language{subtitles.length > 0 ? " & Subtitles" : ""}
        </DialogTitle>

        <div className="flex items-baseline justify-between gap-3 border-b border-stone-700/50 px-6 py-4">
          <h2 className="text-lg font-semibold text-stone-50">Language</h2>
          <span
            data-testid="watch-language-picker-count"
            className="text-sm text-stone-400"
          >
            {options.length} {options.length === 1 ? "language" : "languages"}
          </span>
        </div>

        <div className="px-6 py-6">
          <LanguageCombobox
            options={options}
            value={draftSlug}
            onChange={setDraftSlug}
          />
        </div>

        {subtitles.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-3 border-t border-stone-700/50 px-6 pt-5 pb-3">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-stone-50">
                  Subtitles
                </h2>
                <Switch
                  checked={draftSubtitleEnabled}
                  onCheckedChange={setDraftSubtitleEnabled}
                  aria-label="Subtitles"
                  data-testid="watch-subtitle-toggle"
                />
              </div>
              <span
                data-testid="watch-subtitle-count"
                className="text-sm text-stone-400"
              >
                {subtitles.length}{" "}
                {subtitles.length === 1 ? "language" : "languages"}
              </span>
            </div>

            <div
              className={`px-6 pb-6 ${!draftSubtitleEnabled ? "pointer-events-none opacity-50" : ""}`}
            >
              <LanguageCombobox
                options={subtitleOptions}
                value={draftSubtitleSlug ?? ""}
                onChange={setDraftSubtitleSlug}
                icon={Captions}
              />
            </div>
          </>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-stone-700/50 px-6 py-4">
          <Button
            variant="ghost"
            data-testid="watch-language-picker-close"
            onClick={onClose}
            className="cursor-pointer rounded-full px-5 py-3.5 text-xs font-bold tracking-wider text-stone-300 uppercase transition-colors duration-200 hover:bg-transparent hover:text-stone-100"
          >
            Close
          </Button>
          <Button
            variant="pill"
            data-testid="watch-language-picker-apply"
            disabled={!isDirty || navigating}
            onClick={handleApply}
          >
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
