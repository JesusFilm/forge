"use client"

import { useRouter } from "next/navigation"
import { Captions, Check, Languages, RefreshCw, Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"
import type { RefObject } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"

import type { MuxPlayerRef } from "@forge/video-player"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  LanguageCombobox,
  type LanguageComboboxOption,
} from "@/components/watch/LanguageCombobox"
import {
  LANGUAGE_PICKER_FOCUS_RING_CLASS,
  LANGUAGE_PICKER_MODAL_CLASS,
  LANGUAGE_PICKER_VIEWPORT_CLASS,
  MULTILINGUAL_TOOLTIPS,
  LanguagePickerActions,
  LanguagePickerComboboxFrame,
  LanguagePickerHeader,
  LanguagePickerInventoryLink,
  MultilingualTooltip,
  MultilingualTooltipPanel,
  isolateLanguageName,
  tooltipLanguageKeyForCurrentLanguage,
  type TooltipLanguageKey,
} from "@/components/watch/LanguagePickerPresentation"
import type { WatchLanguagePickerVariant, WatchSubtitle } from "@/lib/content"
import { deriveLanguageDisplay } from "@/lib/language-display"
import { writePreferredLanguageSlug } from "@/lib/language-preference-client"
import { isPlayableLanguageVariant } from "@/lib/playable-variant"
import {
  languagesIndexPath,
  languageVideosIndexPath,
  localizedLanguagesPath,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchEpisodePath,
  watchVideoPath,
} from "@/lib/routes"
import { useIsFullscreen } from "@/lib/use-is-fullscreen"
import { WatchModalViewportCloseButton } from "./WatchModalViewportCloseButton"

export type LanguagePickerVariant = WatchLanguagePickerVariant

export type LanguagePickerModalProps = {
  open: boolean
  variants: LanguagePickerVariant[]
  currentLanguageSlug: string
  collectionSlug?: string | null
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
  languageOptionsLoading?: boolean
  languageOptionsError?: boolean
  onRetryLanguageOptions?: () => void
}

type OpenCombobox = "language" | "subtitles" | null

export function LanguagePickerModal({
  open,
  variants,
  currentLanguageSlug,
  collectionSlug = null,
  videoSlug,
  playerRef,
  onClose,
  kind = "video",
  subtitles = [],
  currentSubtitleEnabled = false,
  currentSubtitleSlug = null,
  onSubtitleChange,
  languageOptionsLoading = false,
  languageOptionsError = false,
  onRetryLanguageOptions,
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
  const [openCombobox, setOpenCombobox] = useState<OpenCombobox>(null)
  const [activeTooltipCopy, setActiveTooltipCopy] = useState<Record<
    TooltipLanguageKey,
    string
  > | null>(null)
  const openComboboxRef = useRef<OpenCombobox>(null)
  const pointerStartedWithComboboxOpenRef = useRef(false)
  const escapeStartedWithComboboxOpenRef = useRef(false)

  const clearActiveTooltip = useCallback(() => {
    setActiveTooltipCopy(null)
  }, [])

  const draftLanguageOption = useMemo(
    () => options.find((option) => option.slug === draftSlug) ?? null,
    [draftSlug, options],
  )
  const draftLanguageDisplay = useMemo(
    () => draftLanguageOption ?? deriveLanguageDisplay(draftSlug, null),
    [draftLanguageOption, draftSlug],
  )
  const draftLanguageInventoryName =
    draftLanguageOption?.nativeName?.trim() || draftLanguageDisplay.name
  const draftLanguageInventoryLabel = t("seeAllVideosInLanguage", {
    language: isolateLanguageName(draftLanguageInventoryName),
  })
  const draftLanguageInventoryPath = useMemo(() => {
    const slug = tryAsLocaleSlug(draftSlug)
    return slug ? languageVideosIndexPath(slug) : null
  }, [draftSlug])
  const appliedLanguageSlug = tryAsLocaleSlug(currentLanguageSlug)
  const allLanguagesPath =
    appliedLanguageSlug && appliedLanguageSlug !== "english"
      ? localizedLanguagesPath(appliedLanguageSlug)
      : languagesIndexPath()
  const excludedTooltipLanguage = useMemo(
    () =>
      tooltipLanguageKeyForCurrentLanguage({
        bcp47: draftLanguageOption?.bcp47,
        name: draftLanguageOption?.name,
        nativeName: draftLanguageOption?.nativeName,
        slug: draftSlug,
      }),
    [draftLanguageOption, draftSlug],
  )

  const setOpenComboboxState = useCallback((next: OpenCombobox) => {
    openComboboxRef.current = next
    setOpenCombobox(next)
  }, [])

  useEffect(() => {
    function rememberComboboxStateAtPointerStart() {
      pointerStartedWithComboboxOpenRef.current =
        openComboboxRef.current !== null
    }
    function closeComboboxBeforeDialogEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return

      escapeStartedWithComboboxOpenRef.current =
        openComboboxRef.current !== null
      if (!escapeStartedWithComboboxOpenRef.current) return

      event.preventDefault()
      event.stopPropagation()
      setOpenComboboxState(null)
    }

    document.addEventListener(
      "pointerdown",
      rememberComboboxStateAtPointerStart,
      true,
    )
    document.addEventListener(
      "mousedown",
      rememberComboboxStateAtPointerStart,
      true,
    )
    document.addEventListener("keydown", closeComboboxBeforeDialogEscape, true)
    return () => {
      document.removeEventListener(
        "pointerdown",
        rememberComboboxStateAtPointerStart,
        true,
      )
      document.removeEventListener(
        "mousedown",
        rememberComboboxStateAtPointerStart,
        true,
      )
      document.removeEventListener(
        "keydown",
        closeComboboxBeforeDialogEscape,
        true,
      )
    }
  }, [setOpenComboboxState])

  const allSubtitleOptions = useMemo(
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
  const sameLanguageSubtitleOptions = useMemo(
    () =>
      allSubtitleOptions.filter((option) =>
        currentLanguageSlug ? option.slug === currentLanguageSlug : true,
      ),
    [allSubtitleOptions, currentLanguageSlug],
  )
  const translatedSubtitleOptions = useMemo(
    () =>
      allSubtitleOptions.filter(
        (option) => !currentLanguageSlug || option.slug !== currentLanguageSlug,
      ),
    [allSubtitleOptions, currentLanguageSlug],
  )
  const currentLanguageDisplay = useMemo(
    () => deriveLanguageDisplay(currentLanguageSlug, null),
    [currentLanguageSlug],
  )
  const currentLanguageOption = useMemo(
    () => options.find((option) => option.slug === currentLanguageSlug) ?? null,
    [currentLanguageSlug, options],
  )
  const currentLanguageUnavailableSubtitleOption =
    useMemo<LanguageComboboxOption | null>(() => {
      if (!currentLanguageSlug) return null
      if (allSubtitleOptions.length === 0) return null
      if (sameLanguageSubtitleOptions.length > 0) return null

      return {
        slug: currentLanguageSlug,
        name: currentLanguageDisplay.name,
        nativeName:
          currentLanguageOption?.nativeName ??
          currentLanguageDisplay.nativeName ??
          null,
        bcp47: currentLanguageOption?.bcp47 ?? null,
        disabled: true,
        chipLabel: t("notAvailable"),
      }
    }, [
      allSubtitleOptions.length,
      currentLanguageDisplay.name,
      currentLanguageDisplay.nativeName,
      currentLanguageOption,
      currentLanguageSlug,
      sameLanguageSubtitleOptions.length,
      t,
    ])
  const subtitleOptions = useMemo(
    () => [
      ...(currentLanguageUnavailableSubtitleOption
        ? [currentLanguageUnavailableSubtitleOption]
        : []),
      ...sameLanguageSubtitleOptions,
      ...translatedSubtitleOptions,
    ],
    [
      currentLanguageUnavailableSubtitleOption,
      sameLanguageSubtitleOptions,
      translatedSubtitleOptions,
    ],
  )
  const hasSelectableSubtitleOptions = allSubtitleOptions.length > 0

  // Track which slug we've dispatched a navigation toward. `navigating`
  // becomes false NATURALLY once the URL catches up — no setState in
  // effect required (React Compiler's anti-cascade rule is satisfied by
  // construction). Keep this set while unresolved so the primary action
  // never reverts to "Apply" before a slow route commit lands.
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
      setOpenComboboxState(null)
      setActiveTooltipCopy(null)
      pointerStartedWithComboboxOpenRef.current = false
      escapeStartedWithComboboxOpenRef.current = false
      navigatingRef.current.inFlight = false
      setPendingNavTo(null)
    }
  }, [open, setOpenComboboxState])

  const languageDirty = draftSlug !== currentLanguageSlug
  const subtitleDirty =
    draftSubtitleEnabled !== currentSubtitleEnabled ||
    draftSubtitleSlug !== currentSubtitleSlug
  const isDirty = languageDirty || subtitleDirty
  const subtitleSelectionRequired =
    draftSubtitleEnabled && hasSelectableSubtitleOptions && !draftSubtitleSlug
  const subtitleUnavailableLabel = currentLanguageDisplay.name
    ? `${t("noSubtitles")} (${currentLanguageDisplay.name})`
    : t("noSubtitles")
  const subtitlePlaceholder = currentLanguageUnavailableSubtitleOption
    ? t("noLanguageSubtitles", {
        language: currentLanguageUnavailableSubtitleOption.name,
      })
    : t("noSubtitles")
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
      const collection = collectionSlug
        ? tryAsContentSlug(collectionSlug)
        : null
      return collection
        ? watchEpisodePath(collection, slug, lang, { t, autoplay: true })
        : watchVideoPath(slug, lang, { t, autoplay: true })
    },
    [collectionSlug, kind, playerRef, videoSlug],
  )

  // Release the sync guard once the URL catches up. The ref-mirror effect
  // is the only path that touches `.inFlight = false` outside the open
  // reset — fires once per slug change.
  useEffect(() => {
    navigatingRef.current.inFlight = false
  }, [currentLanguageSlug])

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
    if (subtitleSelectionRequired) return
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
    subtitleSelectionRequired,
    subtitleDirty,
    videoSlug,
  ])

  function handleOpenChange(next: boolean) {
    if (!next) {
      if (
        openComboboxRef.current !== null ||
        pointerStartedWithComboboxOpenRef.current ||
        escapeStartedWithComboboxOpenRef.current
      ) {
        setOpenComboboxState(null)
        pointerStartedWithComboboxOpenRef.current = false
        escapeStartedWithComboboxOpenRef.current = false
        return
      }
      onClose()
    }
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

  const subtitleToggleTooltip = !hasSelectableSubtitleOptions
    ? MULTILINGUAL_TOOLTIPS.subtitlesUnavailable
    : draftSubtitleEnabled
      ? MULTILINGUAL_TOOLTIPS.subtitlesOff
      : MULTILINGUAL_TOOLTIPS.subtitlesOn

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="watch-language-picker-modal"
        className={LANGUAGE_PICKER_MODAL_CLASS}
        overlayClassName="bg-black/85 supports-backdrop-filter:backdrop-blur-md"
        showCloseButton={false}
        portalContainer={portalContainer}
        viewportClassName={LANGUAGE_PICKER_VIEWPORT_CLASS}
      >
        <WatchModalViewportCloseButton
          open={open}
          onClose={onClose}
          testId="watch-language-picker-close"
          renderInline
        />
        <DialogTitle className="sr-only">
          {subtitles.length > 0
            ? t("dialogTitleWithSubtitles")
            : t("dialogTitle")}
        </DialogTitle>

        <div className="relative flex w-full flex-col gap-10">
          <MultilingualTooltipPanel
            copy={activeTooltipCopy}
            excludedLanguage={excludedTooltipLanguage}
          />
          <div className="flex flex-col gap-4">
            <LanguagePickerHeader
              allLanguagesHref={allLanguagesPath}
              allLanguagesLabel={t("seeAllLanguages")}
              countLabel={t("languageCount", { count: options.length })}
              heading={t("languageHeading")}
              loading={languageOptionsLoading}
              testIdPrefix="watch-language-picker"
              onActivate={setActiveTooltipCopy}
              onDeactivate={clearActiveTooltip}
            />
            {languageOptionsError ? (
              <div
                data-testid="watch-language-picker-load-error"
                className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-3"
              >
                <span className="flex items-center gap-3 text-base font-semibold text-stone-400">
                  <Languages aria-hidden className="size-5" />
                  {t("languageHeading")}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t("retryLoadingLanguages")}
                  title={t("retryLoadingLanguages")}
                  data-testid="watch-language-picker-retry-languages"
                  onClick={onRetryLanguageOptions}
                  className={`size-10 rounded-full p-0 text-stone-300 hover:bg-white/10 hover:text-white ${LANGUAGE_PICKER_FOCUS_RING_CLASS}`}
                >
                  <RefreshCw aria-hidden className="size-4" />
                </Button>
              </div>
            ) : (
              <LanguageCombobox
                options={options}
                value={draftSlug}
                onChange={setDraftSlug}
                disabled={languageOptionsLoading}
                placeholder={t("languageHeading")}
                compact
                open={openCombobox === "language"}
                onOpenChange={(next) =>
                  setOpenComboboxState(next ? "language" : null)
                }
                popoverPortalContainer={portalContainer}
                triggerWrapper={(trigger) => (
                  <LanguagePickerComboboxFrame
                    testIdPrefix="watch-language-picker"
                    onActivate={setActiveTooltipCopy}
                    onDeactivate={clearActiveTooltip}
                  >
                    {trigger}
                  </LanguagePickerComboboxFrame>
                )}
              />
            )}
            {draftLanguageInventoryPath ? (
              <LanguagePickerInventoryLink
                href={draftLanguageInventoryPath}
                label={draftLanguageInventoryLabel}
                testIdPrefix="watch-language-picker"
              />
            ) : null}
          </div>

          <div className="flex flex-col gap-4">
            <div
              data-testid="watch-language-picker-subtitles-header"
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
            >
              <MultilingualTooltip
                copy={MULTILINGUAL_TOOLTIPS.subtitles}
                testId="watch-language-picker-tooltip-subtitles"
                className="col-start-1 row-start-1 min-w-0"
                onActivate={setActiveTooltipCopy}
                onDeactivate={clearActiveTooltip}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    data-testid="watch-language-picker-subtitles-icon"
                    className="flex size-8 shrink-0 items-center justify-center text-stone-200"
                  >
                    <Captions aria-hidden className="size-4" />
                  </span>
                  <div
                    data-testid="watch-language-picker-subtitles-copy"
                    className="flex min-w-0 flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:gap-3"
                  >
                    <h2 className="min-w-0 break-words text-xl font-semibold text-stone-100">
                      {t("subtitlesHeading")}
                    </h2>
                    <span
                      data-testid="watch-language-picker-subtitle-count"
                      className="text-xs font-normal text-stone-400 sm:text-sm"
                    >
                      {t("languageCount", {
                        count: allSubtitleOptions.length,
                      })}
                    </span>
                  </div>
                </div>
              </MultilingualTooltip>
              <MultilingualTooltip
                copy={subtitleToggleTooltip}
                testId="watch-language-picker-tooltip-subtitles-toggle"
                className="col-start-2 row-start-1"
                onActivate={setActiveTooltipCopy}
                onDeactivate={clearActiveTooltip}
              >
                <button
                  type="button"
                  role="switch"
                  aria-label={`${t("subtitlesHeading")} ${
                    draftSubtitleEnabled ? t("toggleOn") : t("toggleOff")
                  }`}
                  aria-checked={draftSubtitleEnabled}
                  data-state={draftSubtitleEnabled ? "on" : "off"}
                  data-testid="watch-language-picker-subtitles-toggle"
                  disabled={!hasSelectableSubtitleOptions}
                  onClick={() => setDraftSubtitleEnabled((value) => !value)}
                  className={`relative flex h-9 w-16 shrink-0 cursor-pointer items-center overflow-hidden rounded-full p-1 text-xs font-bold uppercase sm:text-[10px] transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-45 ${LANGUAGE_PICKER_FOCUS_RING_CLASS} ${
                    draftSubtitleEnabled
                      ? "bg-stone-100 text-stone-950"
                      : "border border-stone-500/80 bg-stone-950/70 text-stone-300"
                  }`}
                >
                  <span
                    data-testid="watch-language-picker-subtitles-toggle-state"
                    className={`pointer-events-none absolute top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center ${
                      draftSubtitleEnabled ? "left-1" : "right-1"
                    }`}
                  >
                    {draftSubtitleEnabled ? "I" : "O"}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`relative z-10 size-7 rounded-full shadow-sm transition-transform duration-200 ${
                      draftSubtitleEnabled
                        ? "translate-x-7 bg-stone-950"
                        : "translate-x-0 bg-stone-100"
                    }`}
                  />
                </button>
              </MultilingualTooltip>
              {sameLanguageSubtitleOptions.length === 0 ? (
                <MultilingualTooltip
                  copy={MULTILINGUAL_TOOLTIPS.requestSubtitles}
                  testId="watch-language-picker-tooltip-request-subtitles"
                  className="col-span-2 row-start-2 min-w-0 max-w-full justify-self-end sm:col-span-1 sm:col-start-3 sm:row-start-1"
                  onActivate={setActiveTooltipCopy}
                  onDeactivate={clearActiveTooltip}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    data-testid="watch-language-picker-request-ai-translation"
                    disabled={translationRequestSent}
                    onClick={() => setTranslationRequestSent(true)}
                    className={`min-w-0 max-w-full flex-1 shrink gap-1.5 cursor-pointer rounded-full border border-stone-400/50 bg-transparent px-3 py-1.5 text-center text-xs leading-4 font-bold tracking-wider sm:text-[11px] whitespace-normal text-stone-300 uppercase transition-colors duration-200 hover:border-stone-200 hover:bg-transparent hover:text-white disabled:cursor-default disabled:border-stone-500/35 disabled:text-stone-500 disabled:opacity-100 sm:flex-none ${LANGUAGE_PICKER_FOCUS_RING_CLASS}`}
                  >
                    {translationRequestSent ? (
                      <Check
                        aria-hidden
                        data-testid="watch-language-picker-request-sent-icon"
                        className="size-3.5 text-emerald-400"
                      />
                    ) : (
                      <Sparkles
                        aria-hidden
                        data-testid="watch-language-picker-request-icon"
                        className="size-3.5"
                      />
                    )}
                    <span>
                      {translationRequestSent
                        ? t("requestSent")
                        : t("translateWithAi")}
                    </span>
                  </Button>
                </MultilingualTooltip>
              ) : null}
            </div>
            {draftSubtitleEnabled && subtitleOptions.length > 0 ? (
              <LanguageCombobox
                options={subtitleOptions}
                value={draftSubtitleSlug ?? ""}
                onChange={setDraftSubtitleSlug}
                icon="subtitles"
                placeholder={subtitlePlaceholder}
                compact
                open={openCombobox === "subtitles"}
                onOpenChange={(next) =>
                  setOpenComboboxState(next ? "subtitles" : null)
                }
                popoverPortalContainer={portalContainer}
                triggerWrapper={(trigger) => (
                  <MultilingualTooltip
                    copy={MULTILINGUAL_TOOLTIPS.subtitles}
                    testId="watch-language-picker-tooltip-subtitles-select"
                    className="w-full"
                    onActivate={setActiveTooltipCopy}
                    onDeactivate={clearActiveTooltip}
                  >
                    {trigger}
                  </MultilingualTooltip>
                )}
              />
            ) : null}
            {!hasSelectableSubtitleOptions ? (
              <p
                data-testid="watch-language-picker-subtitles-unavailable"
                className="text-base sm:text-sm leading-6 text-stone-400"
              >
                {subtitleUnavailableLabel}
              </p>
            ) : null}
          </div>

          <LanguagePickerActions
            applyDisabled={!isDirty || navigating || subtitleSelectionRequired}
            applyIconTestId="watch-language-picker-apply-icon"
            applyLabel={t("apply")}
            closeIconTestId="watch-language-picker-close-action-icon"
            closeLabel={t("close")}
            closeTestId="watch-language-picker-close-action"
            navigating={navigating}
            onApply={handleApply}
            onClose={onClose}
            switchingLabel={t("switching")}
            testIdPrefix="watch-language-picker"
            onActivate={setActiveTooltipCopy}
            onDeactivate={clearActiveTooltip}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
