"use client"

import { useRouter } from "next/navigation"
import { Captions, Check, Languages, Sparkles, X } from "lucide-react"
import { useTranslations } from "next-intl"
import type { ReactNode, RefObject } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { MuxPlayerRef } from "@forge/video-player"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
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

const TOOLTIP_LANGUAGES = [
  { key: "english", dir: "ltr" },
  { key: "mandarin", dir: "ltr" },
  { key: "hindi", dir: "ltr" },
  { key: "spanish", dir: "ltr" },
  { key: "arabic", dir: "rtl" },
] as const

type TooltipLanguageKey = (typeof TOOLTIP_LANGUAGES)[number]["key"]

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

function tooltipPositionClass(side: "top" | "bottom") {
  return side === "bottom" ? "top-full mt-3" : "bottom-full mb-3"
}

function tooltipAlignClass(align: "start" | "center" | "end") {
  if (align === "start") return "left-0"
  if (align === "end") return "right-0"
  return "left-1/2 -translate-x-1/2"
}

function MultilingualTooltip({
  children,
  copy,
  testId,
  className = "",
  side = "top",
  align = "center",
}: {
  children: ReactNode
  copy: Record<TooltipLanguageKey, string>
  testId: string
  className?: string
  side?: "top" | "bottom"
  align?: "start" | "center" | "end"
}) {
  return (
    <div className={`group/tooltip relative inline-flex ${className}`}>
      {children}
      <div
        role="tooltip"
        data-testid={testId}
        className={`pointer-events-none absolute z-[80] w-max max-w-[min(22rem,80vw)] rounded-md border border-stone-600/70 bg-stone-950/95 px-3 py-2 text-left text-[11px] leading-4 font-semibold text-stone-100 opacity-0 shadow-2xl shadow-black/40 backdrop-blur-md transition-opacity duration-150 group-hover/tooltip:opacity-100 ${tooltipPositionClass(
          side,
        )} ${tooltipAlignClass(align)}`}
      >
        <div className="flex flex-col gap-1">
          {TOOLTIP_LANGUAGES.map((language) => (
            <div
              key={language.key}
              dir={language.dir}
              className="whitespace-nowrap"
            >
              <span>{copy[language.key]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

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
  const [openCombobox, setOpenCombobox] = useState<OpenCombobox>(null)
  const openComboboxRef = useRef<OpenCombobox>(null)
  const pointerStartedWithComboboxOpenRef = useRef(false)
  const escapeStartedWithComboboxOpenRef = useRef(false)

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
      setOpenComboboxState(null)
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
      // Validate both segments through the route builder's brand
      // constructors BEFORE persisting the preference cookie. If either
      // fails the slug regex, skip the whole branch — no cookie write, no
      // navigation — rather than poison the cookie then no-op (matches
      // SeriesPageClient's validate-before-write ordering). The rest of
      // handleApply (incl. onClose) still runs.
      const slug = tryAsContentSlug(videoSlug)
      const lang = tryAsLocaleSlug(draftSlug)
      if (slug && lang) {
        navigatingRef.current.inFlight = true
        setPendingNavTo(draftSlug)
        writePreferredLanguageSlug(draftSlug)
        if (kind === "series") {
          router.push(watchVideoPath(slug, lang))
        } else {
          const rawT = playerRef.current?.currentTime
          const t = typeof rawT === "number" && Number.isFinite(rawT) ? rawT : 0
          router.push(watchVideoPath(slug, lang, { t, autoplay: true }))
        }
      }
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

  const subtitleToggleTooltip =
    subtitleOptions.length === 0
      ? MULTILINGUAL_TOOLTIPS.subtitlesUnavailable
      : draftSubtitleEnabled
        ? MULTILINGUAL_TOOLTIPS.subtitlesOff
        : MULTILINGUAL_TOOLTIPS.subtitlesOn

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
            <MultilingualTooltip
              copy={MULTILINGUAL_TOOLTIPS.language}
              testId="watch-language-picker-tooltip-language"
              align="start"
              className="w-full"
            >
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                  <span
                    data-testid="watch-language-picker-language-icon"
                    className="flex size-10 shrink-0 items-center justify-center text-stone-200"
                  >
                    <Languages aria-hidden className="size-5" />
                  </span>
                  <h2 className="text-2xl font-semibold text-stone-100">
                    {t("languageHeading")}
                  </h2>
                </div>
                <span
                  data-testid="watch-language-picker-count"
                  className="text-lg font-normal text-stone-400"
                >
                  {t("languageCount", { count: options.length })}
                </span>
              </div>
            </MultilingualTooltip>
            <LanguageCombobox
              options={options}
              value={draftSlug}
              onChange={setDraftSlug}
              open={openCombobox === "language"}
              onOpenChange={(next) =>
                setOpenComboboxState(next ? "language" : null)
              }
              triggerWrapper={(trigger) => (
                <MultilingualTooltip
                  copy={MULTILINGUAL_TOOLTIPS.language}
                  testId="watch-language-picker-tooltip-language-select"
                  align="start"
                  className="w-full"
                >
                  {trigger}
                </MultilingualTooltip>
              )}
            />
          </div>

          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3">
              <MultilingualTooltip
                copy={MULTILINGUAL_TOOLTIPS.subtitles}
                testId="watch-language-picker-tooltip-subtitles"
                align="start"
                className="min-w-0 flex-1"
              >
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-3">
                    <span
                      data-testid="watch-language-picker-subtitles-icon"
                      className="flex size-10 shrink-0 items-center justify-center text-stone-200"
                    >
                      <Captions aria-hidden className="size-5" />
                    </span>
                    <h2 className="text-2xl font-semibold text-stone-100">
                      {t("subtitlesHeading")}
                    </h2>
                  </div>
                  <span
                    data-testid="watch-language-picker-subtitle-count"
                    className="text-lg font-normal text-stone-400"
                  >
                    {t("languageCount", { count: subtitleOptions.length })}
                  </span>
                </div>
              </MultilingualTooltip>
              <div className="flex items-center gap-4">
                {subtitleOptions.length === 0 ? (
                  <MultilingualTooltip
                    copy={MULTILINGUAL_TOOLTIPS.requestSubtitles}
                    testId="watch-language-picker-tooltip-request-subtitles"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      data-testid="watch-language-picker-request-ai-translation"
                      disabled={translationRequestSent}
                      onClick={() => setTranslationRequestSent(true)}
                      className="gap-2 cursor-pointer rounded-full border border-stone-400/50 bg-transparent px-4 py-2 text-xs font-bold tracking-wider text-stone-300 uppercase transition-colors duration-200 hover:border-stone-200 hover:bg-transparent hover:text-white disabled:cursor-default disabled:border-stone-500/35 disabled:text-stone-500 disabled:opacity-100"
                    >
                      <Sparkles
                        aria-hidden
                        data-testid="watch-language-picker-request-icon"
                        className="size-4"
                      />
                      <span>
                        {translationRequestSent
                          ? t("requestSent")
                          : t("translateWithAi")}
                      </span>
                    </Button>
                  </MultilingualTooltip>
                ) : null}
                <MultilingualTooltip
                  copy={subtitleToggleTooltip}
                  testId="watch-language-picker-tooltip-subtitles-toggle"
                  align="end"
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
                    disabled={subtitleOptions.length === 0}
                    onClick={() => setDraftSubtitleEnabled((value) => !value)}
                    className={`relative flex h-10 w-[72px] shrink-0 cursor-pointer items-center overflow-hidden rounded-full p-1 text-[11px] font-bold uppercase transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-100 disabled:cursor-not-allowed disabled:opacity-45 ${
                      draftSubtitleEnabled
                        ? "bg-stone-100 text-stone-950"
                        : "border border-stone-500/80 bg-stone-950/70 text-stone-300"
                    }`}
                  >
                    <span
                      data-testid="watch-language-picker-subtitles-toggle-state"
                      className={`pointer-events-none absolute top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center ${
                        draftSubtitleEnabled ? "left-1" : "right-1"
                      }`}
                    >
                      {draftSubtitleEnabled ? "I" : "O"}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`relative z-10 size-8 rounded-full shadow-sm transition-transform duration-200 ${
                        draftSubtitleEnabled
                          ? "translate-x-8 bg-stone-950"
                          : "translate-x-0 bg-stone-100"
                      }`}
                    />
                  </button>
                </MultilingualTooltip>
              </div>
            </div>
            {draftSubtitleEnabled && subtitleOptions.length > 0 ? (
              <LanguageCombobox
                options={subtitleOptions}
                value={draftSubtitleSlug ?? ""}
                onChange={setDraftSubtitleSlug}
                icon="subtitles"
                placeholder={t("noSubtitles")}
                open={openCombobox === "subtitles"}
                onOpenChange={(next) =>
                  setOpenComboboxState(next ? "subtitles" : null)
                }
                triggerWrapper={(trigger) => (
                  <MultilingualTooltip
                    copy={MULTILINGUAL_TOOLTIPS.subtitles}
                    testId="watch-language-picker-tooltip-subtitles-select"
                    align="start"
                    className="w-full"
                  >
                    {trigger}
                  </MultilingualTooltip>
                )}
              />
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-9 pt-6">
            <MultilingualTooltip
              copy={MULTILINGUAL_TOOLTIPS.close}
              testId="watch-language-picker-tooltip-close"
            >
              <Button
                variant="ghost"
                data-testid="watch-language-picker-close-action"
                onClick={onClose}
                className="gap-2 cursor-pointer rounded-full px-5 py-3.5 text-sm font-bold tracking-wider text-stone-400 uppercase transition-colors duration-200 hover:bg-transparent hover:text-stone-100"
              >
                <X
                  aria-hidden
                  data-testid="watch-language-picker-close-action-icon"
                  className="size-4"
                />
                <span>{t("close")}</span>
              </Button>
            </MultilingualTooltip>
            <MultilingualTooltip
              copy={MULTILINGUAL_TOOLTIPS.apply}
              testId="watch-language-picker-tooltip-apply"
              align="end"
            >
              <Button
                variant="pill"
                data-testid="watch-language-picker-apply"
                disabled={!isDirty || navigating}
                onClick={handleApply}
                className="gap-2 bg-stone-300 px-7 py-4 text-sm text-stone-950 hover:bg-white hover:text-stone-950 disabled:bg-stone-300 disabled:text-stone-950"
              >
                <Check
                  aria-hidden
                  data-testid="watch-language-picker-apply-icon"
                  className="size-4"
                />
                <span>{t("apply")}</span>
              </Button>
            </MultilingualTooltip>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
