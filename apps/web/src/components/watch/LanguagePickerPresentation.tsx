"use client"

import Link from "next/link"
import {
  ArrowRight,
  Check,
  Globe,
  Languages,
  LoaderCircle,
  X,
} from "lucide-react"
import { useCallback, type ComponentProps, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { SpinnerIcon } from "@/components/ui/spinner"

type LinkHref = ComponentProps<typeof Link>["href"]

export const LANGUAGE_PICKER_FOCUS_RING_CLASS =
  "focus-visible:border-stone-100/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-stone-100 focus-visible:outline-none"

export const LANGUAGE_PICKER_VIEWPORT_CLASS =
  "fixed inset-0 z-50 flex overflow-x-hidden overflow-y-auto px-3 py-24"

export const LANGUAGE_PICKER_MODAL_CLASS =
  "m-auto w-full max-w-[608px] shrink-0 border-0 bg-transparent p-0 text-stone-100 ring-0"

const FIRST_STRONG_ISOLATE = "\u2068"
const POP_DIRECTIONAL_ISOLATE = "\u2069"

export function isolateLanguageName(value: string): string {
  return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`
}

const TOOLTIP_LANGUAGES = [
  { key: "english", dir: "ltr" },
  { key: "mandarin", dir: "ltr" },
  { key: "hindi", dir: "ltr" },
  { key: "spanish", dir: "ltr" },
  { key: "arabic", dir: "rtl" },
] as const

export type TooltipLanguageKey = (typeof TOOLTIP_LANGUAGES)[number]["key"]

const TOOLTIP_LANGUAGE_ALIASES: Record<TooltipLanguageKey, string[]> = {
  english: ["en", "english"],
  mandarin: ["zh", "chinese", "mandarin", "中文", "普通话"],
  hindi: ["hi", "hindi", "हिन्दी"],
  spanish: ["es", "spanish", "español"],
  arabic: ["ar", "arabic", "العربية", "عربي"],
}

export const MULTILINGUAL_TOOLTIPS: Record<
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

function normalizedTooltipLanguage(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/_/g, "-") ?? null
}

export function tooltipLanguageKeyForCurrentLanguage({
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

export function MultilingualTooltip({
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

export function MultilingualTooltipPanel({
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

type TooltipCallbacks = {
  onActivate: (copy: Record<TooltipLanguageKey, string>) => void
  onDeactivate: () => void
}

export function LanguagePickerHeader({
  allLanguagesHref,
  allLanguagesLabel,
  countLabel,
  heading,
  loading = false,
  testIdPrefix,
  ...tooltipCallbacks
}: TooltipCallbacks & {
  allLanguagesHref: LinkHref
  allLanguagesLabel: string
  countLabel?: string
  heading: string
  loading?: boolean
  testIdPrefix: string
}) {
  return (
    <MultilingualTooltip
      copy={MULTILINGUAL_TOOLTIPS.language}
      testId={`${testIdPrefix}-tooltip-language`}
      className="w-full"
      {...tooltipCallbacks}
    >
      <div
        data-testid={`${testIdPrefix}-language-header`}
        className="flex w-full min-w-0 flex-wrap items-center justify-between gap-1.5"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="flex items-center gap-2.5">
            <span
              data-testid={`${testIdPrefix}-language-icon`}
              className="flex size-8 shrink-0 items-center justify-center text-stone-200"
            >
              <Languages aria-hidden className="size-4" />
            </span>
            <h2 className="text-xl font-semibold text-stone-100">{heading}</h2>
          </div>
          {countLabel ? (
            <span
              data-testid={`${testIdPrefix}-count`}
              className="hidden text-xs font-normal text-stone-400 sm:inline sm:text-sm"
            >
              {countLabel}
            </span>
          ) : null}
          {loading ? (
            <LoaderCircle
              aria-hidden
              data-testid={`${testIdPrefix}-loading`}
              className="size-5 animate-spin text-stone-400"
            />
          ) : null}
        </div>
        <Link
          href={allLanguagesHref}
          prefetch={false}
          data-testid={`${testIdPrefix}-all-languages-link`}
          className={`ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.05] px-2 py-1.5 text-xs font-semibold text-stone-300 transition-colors duration-200 hover:border-white/25 hover:bg-white/[0.09] hover:text-white ${LANGUAGE_PICKER_FOCUS_RING_CLASS}`}
        >
          <Globe aria-hidden className="size-3.5" />
          <span>{allLanguagesLabel}</span>
        </Link>
      </div>
    </MultilingualTooltip>
  )
}

export function LanguagePickerComboboxFrame({
  children,
  testIdPrefix,
  ...tooltipCallbacks
}: TooltipCallbacks & { children: ReactNode; testIdPrefix: string }) {
  return (
    <MultilingualTooltip
      copy={MULTILINGUAL_TOOLTIPS.language}
      testId={`${testIdPrefix}-tooltip-language-select`}
      className="w-full"
      {...tooltipCallbacks}
    >
      {children}
    </MultilingualTooltip>
  )
}

export function LanguagePickerInventoryLink({
  href,
  label,
  testIdPrefix,
}: {
  href: LinkHref
  label: string
  testIdPrefix: string
}) {
  return (
    <div
      data-testid={`${testIdPrefix}-selected-language-action`}
      className="-mt-2 flex min-w-0 justify-start"
    >
      <Link
        href={href}
        prefetch={false}
        data-testid={`${testIdPrefix}-selected-language-link`}
        aria-label={label}
        className={`group inline-flex min-h-11 min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 py-2 text-sm font-medium text-stone-400 underline decoration-stone-500 underline-offset-4 transition-colors duration-200 hover:text-white hover:decoration-stone-200 ${LANGUAGE_PICKER_FOCUS_RING_CLASS}`}
      >
        <span className="truncate">{label}</span>
        <ArrowRight
          aria-hidden
          className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    </div>
  )
}

export function LanguagePickerActions({
  applyDisabled,
  applyLabel,
  closeDisabled = false,
  closeIconTestId,
  closeLabel,
  closeTestId,
  navigating,
  onApply,
  onClose,
  switchingLabel,
  testIdPrefix,
  applyIconTestId,
  ...tooltipCallbacks
}: TooltipCallbacks & {
  applyDisabled: boolean
  applyIconTestId?: string
  applyLabel: string
  closeDisabled?: boolean
  closeIconTestId?: string
  closeLabel: string
  closeTestId?: string
  navigating: boolean
  onApply: () => void
  onClose: () => void
  switchingLabel: string
  testIdPrefix: string
}) {
  return (
    <div
      data-testid={`${testIdPrefix}-actions`}
      className="flex flex-wrap items-center justify-end gap-x-6 gap-y-3 pt-3"
    >
      <MultilingualTooltip
        copy={MULTILINGUAL_TOOLTIPS.close}
        testId={`${testIdPrefix}-tooltip-close`}
        {...tooltipCallbacks}
      >
        <Button
          type="button"
          variant="ghost"
          data-testid={closeTestId ?? `${testIdPrefix}-close`}
          disabled={closeDisabled}
          onClick={onClose}
          className={`h-auto w-40 gap-1.5 cursor-pointer rounded-full px-5 py-3 text-xs font-bold tracking-wider text-stone-400 uppercase transition-colors duration-200 hover:bg-transparent hover:text-stone-100 ${LANGUAGE_PICKER_FOCUS_RING_CLASS}`}
        >
          <X aria-hidden data-testid={closeIconTestId} className="size-3.5" />
          <span>{closeLabel}</span>
        </Button>
      </MultilingualTooltip>
      <MultilingualTooltip
        copy={MULTILINGUAL_TOOLTIPS.apply}
        testId={`${testIdPrefix}-tooltip-apply`}
        {...tooltipCallbacks}
      >
        <Button
          type="button"
          variant="pill"
          data-testid={`${testIdPrefix}-apply`}
          disabled={applyDisabled}
          onClick={onApply}
          className={`inline-flex w-40 items-center justify-center gap-1.5 bg-stone-300 px-5 py-3 text-xs text-stone-950 hover:bg-white hover:text-stone-950 disabled:bg-stone-300 disabled:text-stone-950 ${LANGUAGE_PICKER_FOCUS_RING_CLASS}`}
        >
          {navigating ? (
            <SpinnerIcon aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <Check
              aria-hidden
              data-testid={applyIconTestId}
              className="size-3.5"
            />
          )}
          <span>{navigating ? switchingLabel : applyLabel}</span>
        </Button>
      </MultilingualTooltip>
    </div>
  )
}
