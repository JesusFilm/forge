"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowRight,
  Captions,
  Check,
  Globe,
  Languages,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react"
import { useTranslations } from "next-intl"
import type { ReactNode, RefObject } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"

import type { MuxPlayerRef } from "@forge/video-player"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { SpinnerIcon } from "@/components/ui/spinner"
import {
  LanguageCombobox,
  type LanguageComboboxOption,
} from "@/components/watch/LanguageCombobox"
import type { WatchLanguagePickerVariant, WatchSubtitle } from "@/lib/content"
import { deriveLanguageDisplay } from "@/lib/language-display"
import { writePreferredLanguageSlug } from "@/lib/language-preference-client"
import { isPlayableLanguageVariant } from "@/lib/playable-variant"
import {
  languagesIndexPath,
  languageVideosIndexPath,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchEpisodePath,
  watchVideoPath,
} from "@/lib/routes"
import { useIsFullscreen } from "@/lib/use-is-fullscreen"
import { WatchModalViewportCloseButton } from "./WatchModalViewportCloseButton"

export type LanguagePickerVariant = WatchLanguagePickerVariant

const MODAL_FOCUS_RING_CLASS =
  "focus-visible:border-stone-100/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-stone-100 focus-visible:outline-none"
const FIRST_STRONG_ISOLATE = "\u2068"
const POP_DIRECTIONAL_ISOLATE = "\u2069"

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

const TOOLTIP_LANGUAGES = [
  { key: "english", dir: "ltr" },
  { key: "mandarin", dir: "ltr" },
  { key: "hindi", dir: "ltr" },
  { key: "spanish", dir: "ltr" },
  { key: "arabic", dir: "rtl" },
] as const

type TooltipLanguageKey = (typeof TOOLTIP_LANGUAGES)[number]["key"]

const TOOLTIP_LANGUAGE_ALIASES: Record<TooltipLanguageKey, string[]> = {
  english: ["en", "english"],
  mandarin: ["zh", "chinese", "mandarin", "中文", "普通话"],
  hindi: ["hi", "hindi", "हिन्दी"],
  spanish: ["es", "spanish", "español"],
  arabic: ["ar", "arabic", "العربية", "عربي"],
}

const MULTILINGUAL_TOOLTIPS: Record<
  string,
  Record<TooltipLanguageKey, string>
> = {
  language: {
    english: "Language",
    mandarin: "语言",
    hindi: "भाषा",
    spanish: "Idioma",
    arabic: "اللغة",
  },
  subtitles: {
    english: "Subtitles",
    mandarin: "字幕",
    hindi: "उपशीर्षक",
    spanish: "Subtítulos",
    arabic: "الترجمة",
  },
  subtitlesOn: {
    english: "Turn subtitles on",
    mandarin: "打开字幕",
    hindi: "उपशीर्षक चालू करें",
    spanish: "Activar subtítulos",
    arabic: "شغّل الترجمة",
  },
  subtitlesOff: {
    english: "Turn subtitles off",
    mandarin: "关闭字幕",
    hindi: "उपशीर्षक बंद करें",
    spanish: "Desactivar subtítulos",
    arabic: "أوقف الترجمة",
  },
  subtitlesUnavailable: {
    english: "Subtitles unavailable",
    mandarin: "没有字幕",
    hindi: "उपशीर्षक उपलब्ध नहीं हैं",
    spanish: "Subtítulos no disponibles",
    arabic: "الترجمة غير متاحة",
  },
  requestSubtitles: {
    english: "Request subtitles",
    mandarin: "请求字幕",
    hindi: "उपशीर्षक का अनुरोध करें",
    spanish: "Solicitar subtítulos",
    arabic: "اطلب الترجمة",
  },
  close: {
    english: "Close",
    mandarin: "关闭",
    hindi: "बंद करें",
    spanish: "Cerrar",
    arabic: "إغلاق",
  },
  apply: {
    english: "Apply",
    mandarin: "应用",
    hindi: "लागू करें",
    spanish: "Aplicar",
    arabic: "تطبيق",
  },
}

type OpenCombobox = "language" | "subtitles" | null

function normalizedTooltipLanguage(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/_/g, "-") ?? null
}

function tooltipLanguageKeyForCurrentLanguage({
  bcp47,
  name,
  nativeName,
  slug,
}: {
  bcp47?: string | null
  name?: string | null
  nativeName?: string | null
  slug?: string | null
}): TooltipLanguageKey | null {
  const candidates = [slug, bcp47, bcp47?.split(/[-_]/)[0], name, nativeName]

  for (const candidate of candidates) {
    const normalized = normalizedTooltipLanguage(candidate)
    if (!normalized) continue

    for (const [languageKey, aliases] of Object.entries(
      TOOLTIP_LANGUAGE_ALIASES,
    ) as [TooltipLanguageKey, string[]][]) {
      if (
        aliases.some(
          (alias) => normalized === alias || normalized.startsWith(`${alias}-`),
        )
      ) {
        return languageKey
      }
    }
  }

  return null
}

function MultilingualTooltip({
  children,
  copy,
  testId,
  className = "",
  onActivate,
  onDeactivate,
}: {
  children: ReactNode
  copy: Record<TooltipLanguageKey, string>
  testId: string
  className?: string
  onActivate: (copy: Record<TooltipLanguageKey, string>) => void
  onDeactivate: () => void
}) {
  const activate = useCallback(() => onActivate(copy), [copy, onActivate])
  const deactivate = useCallback(() => onDeactivate(), [onDeactivate])

  return (
    <div
      data-testid={testId}
      onMouseEnter={activate}
      onMouseLeave={deactivate}
      onPointerEnter={activate}
      className={`inline-flex ${className}`}
    >
      {children}
    </div>
  )
}

function MultilingualTooltipPanel({
  copy,
  excludedLanguage,
}: {
  copy: Record<TooltipLanguageKey, string> | null
  excludedLanguage: TooltipLanguageKey | null
}) {
  const visible = copy !== null
  const tooltipCopy = copy ?? MULTILINGUAL_TOOLTIPS.language
  const tooltipLanguages = excludedLanguage
    ? TOOLTIP_LANGUAGES.filter((language) => language.key !== excludedLanguage)
    : TOOLTIP_LANGUAGES

  return (
    <div
      role="tooltip"
      aria-hidden={visible ? undefined : true}
      data-testid="watch-language-picker-tooltip-panel"
      className={`pointer-events-none absolute inset-x-0 bottom-full z-20 mb-6 flex min-h-12 w-full items-start gap-2.5 py-1 text-sm leading-5 font-semibold text-stone-200 transition-[opacity,translate] duration-300 ease-out ${
        visible ? "translate-y-0 opacity-75" : "translate-y-2 opacity-0"
      }`}
    >
      <span
        aria-hidden
        data-testid="watch-language-picker-tooltip-globe-icon"
        className="flex h-5 w-8 shrink-0 items-center justify-center text-stone-300"
      >
        <Globe aria-hidden className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        {tooltipLanguages.map((language, index) => (
          <span
            key={language.key}
            className="inline-flex items-center gap-2 whitespace-nowrap"
          >
            {index > 0 ? (
              <span
                aria-hidden
                className="size-1 shrink-0 rounded-full bg-stone-500/80"
              />
            ) : null}
            <span dir={language.dir}>{tooltipCopy[language.key]}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

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
    language: `${FIRST_STRONG_ISOLATE}${draftLanguageInventoryName}${POP_DIRECTIONAL_ISOLATE}`,
  })
  const draftLanguageInventoryPath = useMemo(() => {
    const slug = tryAsLocaleSlug(draftSlug)
    return slug ? languageVideosIndexPath(slug) : null
  }, [draftSlug])
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
        className="m-auto w-full max-w-[608px] shrink-0 border-0 bg-transparent p-0 text-stone-100 ring-0"
        overlayClassName="bg-black/85 supports-backdrop-filter:backdrop-blur-md"
        showCloseButton={false}
        portalContainer={portalContainer}
        viewportClassName="fixed inset-0 z-50 flex overflow-x-hidden overflow-y-auto px-3 py-24"
      >
        <WatchModalViewportCloseButton
          open={open}
          onClose={onClose}
          testId="watch-language-picker-close"
          portalContainer={portalContainer}
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
            <MultilingualTooltip
              copy={MULTILINGUAL_TOOLTIPS.language}
              testId="watch-language-picker-tooltip-language"
              className="w-full"
              onActivate={setActiveTooltipCopy}
              onDeactivate={clearActiveTooltip}
            >
              <div
                data-testid="watch-language-picker-language-header"
                className="flex w-full min-w-0 flex-wrap items-center justify-between gap-1.5"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <div className="flex items-center gap-2.5">
                    <span
                      data-testid="watch-language-picker-language-icon"
                      className="flex size-8 shrink-0 items-center justify-center text-stone-200"
                    >
                      <Languages aria-hidden className="size-4" />
                    </span>
                    <h2 className="text-xl font-semibold text-stone-100">
                      {t("languageHeading")}
                    </h2>
                  </div>
                  <span
                    data-testid="watch-language-picker-count"
                    className="hidden text-xs font-normal text-stone-400 sm:inline sm:text-sm"
                  >
                    {t("languageCount", { count: options.length })}
                  </span>
                  {languageOptionsLoading ? (
                    <LoaderCircle
                      aria-hidden
                      data-testid="watch-language-picker-loading"
                      className="size-5 animate-spin text-stone-400"
                    />
                  ) : null}
                </div>
                <Link
                  href={languagesIndexPath()}
                  prefetch={false}
                  data-testid="watch-language-picker-all-languages-link"
                  className={`ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.05] px-2 py-1.5 text-xs font-semibold text-stone-300 transition-colors duration-200 hover:border-white/25 hover:bg-white/[0.09] hover:text-white ${MODAL_FOCUS_RING_CLASS}`}
                >
                  <Globe aria-hidden className="size-3.5" />
                  <span>{t("seeAllLanguages")}</span>
                </Link>
              </div>
            </MultilingualTooltip>
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
                  className={`size-10 rounded-full p-0 text-stone-300 hover:bg-white/10 hover:text-white ${MODAL_FOCUS_RING_CLASS}`}
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
                  <MultilingualTooltip
                    copy={MULTILINGUAL_TOOLTIPS.language}
                    testId="watch-language-picker-tooltip-language-select"
                    className="w-full"
                    onActivate={setActiveTooltipCopy}
                    onDeactivate={clearActiveTooltip}
                  >
                    {trigger}
                  </MultilingualTooltip>
                )}
              />
            )}
            {draftLanguageInventoryPath ? (
              <div
                data-testid="watch-language-picker-selected-language-action"
                className="-mt-2 flex min-w-0 justify-start"
              >
                <Link
                  href={draftLanguageInventoryPath}
                  prefetch={false}
                  data-testid="watch-language-picker-selected-language-link"
                  aria-label={draftLanguageInventoryLabel}
                  className={`group inline-flex min-h-11 min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 py-2 text-sm font-medium text-stone-400 underline decoration-stone-500 underline-offset-4 transition-colors duration-200 hover:text-white hover:decoration-stone-200 ${MODAL_FOCUS_RING_CLASS}`}
                >
                  <span className="truncate">
                    {draftLanguageInventoryLabel}
                  </span>
                  <ArrowRight
                    aria-hidden
                    className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </div>
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
                  className={`relative flex h-9 w-16 shrink-0 cursor-pointer items-center overflow-hidden rounded-full p-1 text-[10px] font-bold uppercase transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-45 ${MODAL_FOCUS_RING_CLASS} ${
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
                    className={`min-w-0 max-w-full flex-1 shrink gap-1.5 cursor-pointer rounded-full border border-stone-400/50 bg-transparent px-3 py-1.5 text-center text-[11px] leading-4 font-bold tracking-wider whitespace-normal text-stone-300 uppercase transition-colors duration-200 hover:border-stone-200 hover:bg-transparent hover:text-white disabled:cursor-default disabled:border-stone-500/35 disabled:text-stone-500 disabled:opacity-100 sm:flex-none ${MODAL_FOCUS_RING_CLASS}`}
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
                className="text-sm leading-6 text-stone-400"
              >
                {subtitleUnavailableLabel}
              </p>
            ) : null}
          </div>

          <div
            data-testid="watch-language-picker-actions"
            className="flex flex-wrap items-center justify-end gap-x-6 gap-y-3 pt-3"
          >
            <MultilingualTooltip
              copy={MULTILINGUAL_TOOLTIPS.close}
              testId="watch-language-picker-tooltip-close"
              onActivate={setActiveTooltipCopy}
              onDeactivate={clearActiveTooltip}
            >
              <Button
                variant="ghost"
                data-testid="watch-language-picker-close-action"
                onClick={onClose}
                className={`h-auto w-40 gap-1.5 cursor-pointer rounded-full px-5 py-3 text-xs font-bold tracking-wider text-stone-400 uppercase transition-colors duration-200 hover:bg-transparent hover:text-stone-100 ${MODAL_FOCUS_RING_CLASS}`}
              >
                <X
                  aria-hidden
                  data-testid="watch-language-picker-close-action-icon"
                  className="size-3.5"
                />
                <span>{t("close")}</span>
              </Button>
            </MultilingualTooltip>
            <MultilingualTooltip
              copy={MULTILINGUAL_TOOLTIPS.apply}
              testId="watch-language-picker-tooltip-apply"
              onActivate={setActiveTooltipCopy}
              onDeactivate={clearActiveTooltip}
            >
              <Button
                variant="pill"
                data-testid="watch-language-picker-apply"
                disabled={!isDirty || navigating || subtitleSelectionRequired}
                onClick={handleApply}
                className={`inline-flex w-40 items-center justify-center gap-1.5 bg-stone-300 px-5 py-3 text-xs text-stone-950 hover:bg-white hover:text-stone-950 disabled:bg-stone-300 disabled:text-stone-950 ${MODAL_FOCUS_RING_CLASS}`}
              >
                {navigating ? (
                  <>
                    <SpinnerIcon
                      aria-hidden
                      className="size-3.5 animate-spin"
                    />
                    <span>{t("switching")}</span>
                  </>
                ) : (
                  <>
                    <Check
                      aria-hidden
                      data-testid="watch-language-picker-apply-icon"
                      className="size-3.5"
                    />
                    <span>{t("apply")}</span>
                  </>
                )}
              </Button>
            </MultilingualTooltip>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
