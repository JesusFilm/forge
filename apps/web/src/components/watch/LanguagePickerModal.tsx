"use client"

import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import type { RefObject } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"

import type { MuxPlayerRef } from "@forge/video-player"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { SpinnerIcon } from "@/components/ui/spinner"
import { LanguageCombobox } from "@/components/watch/LanguageCombobox"
import type { WatchSubtitle } from "@/lib/content"
import { deriveLanguageDisplay } from "@/lib/language-display"
import { writePreferredLanguageSlug } from "@/lib/language-preference-client"
import { isPlayableLanguageVariant } from "@/lib/playable-variant"
import { tryAsContentSlug, tryAsLocaleSlug, watchVideoPath } from "@/lib/routes"
import { useIsFullscreen } from "@/lib/use-is-fullscreen"
import { WatchModalViewportCloseButton } from "./WatchModalViewportCloseButton"

export type LanguagePickerVariant = {
  documentId: string
  hls: string | null
  published: boolean | null
  language: {
    coreId?: string | null
    bcp47?: string | null
    slug: string | null
    name: string | null
    nativeName?: string | null
  } | null
  videoEdition?: {
    subtitles?:
      | {
          vttSrc?: string | null
          srtSrc?: string | null
          language?: {
            coreId?: string | null
            bcp47?: string | null
            slug: string | null
            name: string | null
          } | null
        }[]
      | null
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
  const t = useTranslations("LanguagePickerModal")
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
        .map((v) => {
          const display = deriveLanguageDisplay(
            v.language.slug,
            v.language.name,
          )
          return {
            ...display,
            nativeName: display.nativeName ?? v.language.nativeName ?? null,
            bcp47: v.language.bcp47 ?? null,
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [variants],
  )

  const [draftSlug, setDraftSlug] = useState(currentLanguageSlug)
  const [draftSubtitleEnabled, setDraftSubtitleEnabled] = useState(
    currentSubtitleEnabled,
  )
  const [draftSubtitleSlug, setDraftSubtitleSlug] = useState<string | null>(
    currentSubtitleSlug,
  )
  const [translationRequestSent, setTranslationRequestSent] = useState(false)

  const subtitleOptions = useMemo(
    () =>
      subtitles
        .map((s) => ({
          ...deriveLanguageDisplay(s.language.slug, s.language.name),
          nativeName: s.language.nativeName ?? null,
          bcp47: s.language.bcp47 ?? null,
        }))
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
      setTranslationRequestSent(false)
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

  const buildTargetPath = useCallback(
    (languageSlug: string) => {
      const slug = tryAsContentSlug(videoSlug)
      const lang = tryAsLocaleSlug(languageSlug)
      if (!slug || !lang) return null
      if (kind === "series") return watchVideoPath(slug, lang)

      const rawT = playerRef.current?.currentTime
      const t = typeof rawT === "number" && Number.isFinite(rawT) ? rawT : 0
      return watchVideoPath(slug, lang, { t, autoplay: true })
    },
    [kind, playerRef, videoSlug],
  )

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

  const lastPrefetchedPathRef = useRef<string | null>(null)
  useEffect(() => {
    if (!open) return
    if (!languageDirty) return
    const targetPath = buildTargetPath(draftSlug)
    if (!targetPath) return
    if (targetPath === lastPrefetchedPathRef.current) return

    lastPrefetchedPathRef.current = targetPath
    Promise.resolve(router.prefetch(targetPath)).catch(() => undefined)
  }, [buildTargetPath, draftSlug, languageDirty, open, router])

  const handleApply = useCallback(() => {
    if (!isDirty) return
    if (navigatingRef.current.inFlight) return
    if (!videoSlug) return

    if (subtitleDirty) {
      onSubtitleChange?.(draftSubtitleEnabled, draftSubtitleSlug)
    }

    if (languageDirty) {
      // Validate both segments through the route builder's brand
      // constructors BEFORE persisting the preference cookie. If either
      // fails the slug regex, skip the whole branch — no cookie write, no
      // navigation — rather than poison the cookie then no-op (matches
      // SeriesPageClient's validate-before-write ordering). The rest of
      // handleApply (incl. onClose) still runs.
      const targetPath = buildTargetPath(draftSlug)
      if (targetPath) {
        navigatingRef.current.inFlight = true
        // Commit the visible pending state before starting App Router
        // navigation. Otherwise React may batch the state update with
        // router.push, which is exactly the "nothing happened" feeling
        // this modal is meant to avoid on cold language routes.
        flushSync(() => setPendingNavTo(draftSlug))
        writePreferredLanguageSlug(draftSlug)
        router.push(targetPath)
        return
      }
    }

    onClose()
  }, [
    buildTargetPath,
    draftSlug,
    draftSubtitleEnabled,
    draftSubtitleSlug,
    isDirty,
    languageDirty,
    onClose,
    onSubtitleChange,
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
      <WatchModalViewportCloseButton
        open={open}
        onClose={onClose}
        testId="watch-language-picker-close"
        portalContainer={portalContainer}
      />
      <DialogContent
        data-testid="watch-language-picker-modal"
        className="w-full max-w-[min(90vw,608px)] border-0 bg-transparent p-0 text-stone-100 ring-0 sm:max-w-[608px]"
        overlayClassName="bg-black/85 supports-backdrop-filter:backdrop-blur-md"
        showCloseButton={false}
        portalContainer={portalContainer}
      >
        <DialogTitle className="sr-only">
          {subtitles.length > 0
            ? t("dialogTitleWithSubtitles")
            : t("dialogTitle")}
        </DialogTitle>

        <div className="flex flex-col gap-14">
          <div className="flex flex-col gap-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-2xl font-semibold text-stone-100">
                {t("languageHeading")}
              </h2>
              <span
                data-testid="watch-language-picker-count"
                className="text-lg font-normal text-stone-400"
              >
                {t("languageCount", { count: options.length })}
              </span>
            </div>
            <LanguageCombobox
              options={options}
              value={draftSlug}
              onChange={setDraftSlug}
            />
          </div>

          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-6">
                <h2 className="text-2xl font-semibold text-stone-100">
                  {t("subtitlesHeading")}
                </h2>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draftSubtitleEnabled}
                  data-testid="watch-language-picker-subtitles-toggle"
                  disabled={subtitleOptions.length === 0}
                  onClick={() => setDraftSubtitleEnabled((value) => !value)}
                  className="flex h-8 w-[58px] cursor-pointer items-center rounded-full bg-white p-1 transition disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span
                    className={`size-6 rounded-full bg-stone-950 transition-transform ${
                      draftSubtitleEnabled ? "translate-x-6" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center gap-4">
                {subtitleOptions.length === 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    data-testid="watch-language-picker-request-ai-translation"
                    disabled={translationRequestSent}
                    onClick={() => setTranslationRequestSent(true)}
                    className="cursor-pointer rounded-full border border-stone-400/50 bg-transparent px-4 py-2 text-xs font-bold tracking-wider text-stone-300 uppercase transition-colors duration-200 hover:border-stone-200 hover:bg-transparent hover:text-white disabled:cursor-default disabled:border-stone-500/35 disabled:text-stone-500 disabled:opacity-100"
                  >
                    {translationRequestSent
                      ? t("requestSent")
                      : t("translateWithAi")}
                  </Button>
                ) : null}
                <span
                  data-testid="watch-language-picker-subtitle-count"
                  className="text-lg font-normal text-stone-400"
                >
                  {t("languageCount", { count: subtitleOptions.length })}
                </span>
              </div>
            </div>
            <LanguageCombobox
              options={subtitleOptions}
              value={draftSubtitleSlug ?? ""}
              onChange={setDraftSubtitleSlug}
              icon="subtitles"
              disabled={!draftSubtitleEnabled || subtitleOptions.length === 0}
              placeholder={t("noSubtitles")}
            />
          </div>

          <div className="flex items-center justify-end gap-9 pt-6">
            <Button
              variant="ghost"
              data-testid="watch-language-picker-close-action"
              onClick={onClose}
              className="cursor-pointer rounded-full px-5 py-3.5 text-sm font-bold tracking-wider text-stone-400 uppercase transition-colors duration-200 hover:bg-transparent hover:text-stone-100"
            >
              {t("close")}
            </Button>
            <Button
              variant="pill"
              data-testid="watch-language-picker-apply"
              disabled={!isDirty || navigating}
              onClick={handleApply}
              className="inline-flex min-w-28 items-center justify-center gap-2 bg-stone-300 px-7 py-4 text-sm text-stone-950 hover:bg-white hover:text-stone-950 disabled:bg-stone-300 disabled:text-stone-950"
            >
              {navigating ? (
                <>
                  <SpinnerIcon className="size-4 animate-spin" />
                  {t("switching")}
                </>
              ) : (
                t("apply")
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
