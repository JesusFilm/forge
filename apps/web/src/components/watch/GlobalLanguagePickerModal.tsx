"use client"

import { LoaderCircle, RefreshCw } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react"
import { flushSync } from "react-dom"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { LanguageCombobox } from "@/components/watch/LanguageCombobox"
import {
  LANGUAGE_PICKER_FOCUS_RING_CLASS,
  LANGUAGE_PICKER_MODAL_CLASS,
  LANGUAGE_PICKER_VIEWPORT_CLASS,
  LanguagePickerActions,
  LanguagePickerComboboxFrame,
  LanguagePickerHeader,
  LanguagePickerInventoryLink,
  MultilingualTooltipPanel,
  tooltipLanguageKeyForCurrentLanguage,
  type TooltipLanguageKey,
} from "@/components/watch/LanguagePickerPresentation"
import { WatchModalViewportCloseButton } from "@/components/watch/WatchModalViewportCloseButton"
import { writePreferredLanguageSlug } from "@/lib/language-preference-client"
import { isPublicWatchLanguageSlug } from "@/lib/locale"
import { loadGlobalWatchLanguageOptions } from "@/lib/watch-interaction-loader"
import {
  languageVideosIndexPath,
  languagesIndexPath,
  localizedLanguagesPath,
  tryAsLocaleSlug,
} from "@/lib/routes"
import {
  languageSwitcherTarget,
  type GlobalLanguageOption,
} from "@/lib/watch-language-switcher"

const FIRST_STRONG_ISOLATE = "\u2068"
const POP_DIRECTIONAL_ISOLATE = "\u2069"

type LoadState =
  | { status: "loading" }
  | {
      status: "ready"
      options: GlobalLanguageOption[]
      currentLanguageSlug: string
    }
  | { status: "empty" }
  | { status: "error" }

export type GlobalLanguagePickerModalProps = {
  open: boolean
  pathname: string
  currentLanguageSlug: string
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
}

function validGlobalOptions(
  options: readonly GlobalLanguageOption[],
): GlobalLanguageOption[] {
  const bySlug = new Map<string, GlobalLanguageOption>()
  for (const option of options) {
    if (!isPublicWatchLanguageSlug(option.slug)) continue
    if (!bySlug.has(option.slug)) bySlug.set(option.slug, option)
  }
  return [...bySlug.values()]
}

function languagePickerStatus(
  loadState: LoadState,
  invalidSelection: boolean,
  pendingLanguageName: string | null,
  messages: {
    apply: string
    invalidSelection: string
    loading: string
    unavailable: string
    languageCount: (count: number) => string
  },
): string {
  if (invalidSelection) return messages.invalidSelection
  if (pendingLanguageName) return `${messages.apply}: ${pendingLanguageName}`

  switch (loadState.status) {
    case "loading":
      return messages.loading
    case "error":
      return messages.unavailable
    case "empty":
      return messages.languageCount(0)
    case "ready":
      return messages.languageCount(loadState.options.length)
  }
}

export function GlobalLanguagePickerModal({
  open,
  pathname,
  currentLanguageSlug,
  onClose,
  returnFocusRef,
}: GlobalLanguagePickerModalProps) {
  const t = useTranslations("LanguagePickerModal")
  const searchT = useTranslations("SearchOverlay")
  const router = useRouter()
  const modalRef = useRef<HTMLDivElement>(null)
  const navigatingRef = useRef(false)
  const prefetchedTargetsRef = useRef(new Set<string>())
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" })
  const [draftSlug, setDraftSlug] = useState(currentLanguageSlug)
  const [invalidSelection, setInvalidSelection] = useState(false)
  const [pendingLanguageName, setPendingLanguageName] = useState<string | null>(
    null,
  )
  const [activeTooltipCopy, setActiveTooltipCopy] = useState<Record<
    TooltipLanguageKey,
    string
  > | null>(null)

  useEffect(() => {
    if (!open) return
    const returnFocusTarget = returnFocusRef?.current
    return () => returnFocusTarget?.focus()
  }, [open, returnFocusRef])

  useEffect(() => {
    if (!open) return
    let active = true

    void loadGlobalWatchLanguageOptions()
      .then((loadedOptions) => {
        if (!active) return
        const options = validGlobalOptions(loadedOptions)
        const resolvedCurrentLanguageSlug = options.some(
          (option) => option.slug === currentLanguageSlug,
        )
          ? currentLanguageSlug
          : (options.find((option) => option.slug === "english")?.slug ??
            options[0]?.slug)
        if (resolvedCurrentLanguageSlug) {
          setDraftSlug(resolvedCurrentLanguageSlug)
        }
        setLoadState(
          options.length > 0 && resolvedCurrentLanguageSlug
            ? {
                status: "ready",
                options,
                currentLanguageSlug: resolvedCurrentLanguageSlug,
              }
            : { status: "empty" },
        )
      })
      .catch(() => {
        if (active) setLoadState({ status: "error" })
      })

    return () => {
      active = false
    }
  }, [currentLanguageSlug, loadAttempt, open])

  useEffect(() => {
    if (!open) return
    if (loadState.status === "ready") {
      modalRef.current
        ?.querySelector<HTMLElement>(
          '[data-testid="global-language-picker-select"], [data-testid="language-combobox-trigger"]',
        )
        ?.focus()
      return
    }
    modalRef.current?.focus()
  }, [loadState.status, open])

  const options = useMemo(
    () => (loadState.status === "ready" ? loadState.options : []),
    [loadState],
  )
  const comboboxOptions = useMemo(
    () =>
      options.map((option) => ({
        slug: option.slug,
        searchAliasSlug: option.aliasOwnerSlug,
        name: option.englishName,
        nativeName: option.nativeName,
      })),
    [options],
  )
  const selectedOption = options.find((option) => option.slug === draftSlug)
  const excludedTooltipLanguage = tooltipLanguageKeyForCurrentLanguage({
    name: selectedOption?.englishName,
    nativeName: selectedOption?.nativeName,
    slug: selectedOption?.slug ?? draftSlug,
  })
  const appliedLanguageSlug = tryAsLocaleSlug(
    loadState.status === "ready"
      ? loadState.currentLanguageSlug
      : currentLanguageSlug,
  )
  const allLanguagesPath =
    appliedLanguageSlug && appliedLanguageSlug !== "english"
      ? localizedLanguagesPath(appliedLanguageSlug)
      : languagesIndexPath()
  const draftLocaleSlug = tryAsLocaleSlug(draftSlug)
  const draftLanguageInventoryPath = draftLocaleSlug
    ? languageVideosIndexPath(draftLocaleSlug)
    : null
  const draftLanguageInventoryName =
    selectedOption?.nativeName?.trim() ||
    selectedOption?.englishName ||
    draftSlug
  const draftLanguageInventoryLabel = t("seeAllVideosInLanguage", {
    language: `${FIRST_STRONG_ISOLATE}${draftLanguageInventoryName}${POP_DIRECTIONAL_ISOLATE}`,
  })
  const selectedTarget = selectedOption
    ? languageSwitcherTarget(pathname, selectedOption.slug)
    : null
  const changed =
    loadState.status === "ready" && draftSlug !== loadState.currentLanguageSlug
  const navigating = pendingLanguageName !== null

  useEffect(() => {
    if (!open || !changed || !selectedTarget || navigating) return
    const target = selectedTarget.toString()
    if (prefetchedTargetsRef.current.has(target)) return
    prefetchedTargetsRef.current.add(target)
    try {
      void Promise.resolve(router.prefetch(selectedTarget)).catch(() => {})
    } catch {
      // Prefetch is an optional acceleration layer; navigation remains valid.
    }
  }, [changed, navigating, open, router, selectedTarget])

  const requestClose = useCallback(() => {
    if (navigatingRef.current) return
    onClose()
  }, [onClose])

  const handleApply = useCallback(() => {
    if (navigatingRef.current || !changed) return
    if (
      !selectedOption ||
      !selectedTarget ||
      !isPublicWatchLanguageSlug(selectedOption.slug)
    ) {
      setInvalidSelection(true)
      return
    }

    navigatingRef.current = true
    flushSync(() => {
      setInvalidSelection(false)
      setPendingLanguageName(selectedOption.englishName)
    })
    writePreferredLanguageSlug(selectedOption.slug)
    router.push(selectedTarget)
  }, [changed, router, selectedOption, selectedTarget])

  const status = languagePickerStatus(
    loadState,
    invalidSelection,
    pendingLanguageName,
    {
      apply: t("apply"),
      invalidSelection: searchT("tryDifferentKeywordsOrLanguage"),
      loading: searchT("loading"),
      unavailable: searchT("connectionHint"),
      languageCount: (count) => t("languageCount", { count }),
    },
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) requestClose()
      }}
    >
      <DialogContent
        ref={modalRef}
        data-testid="global-language-picker-modal"
        aria-modal="true"
        initialFocus={false}
        finalFocus={returnFocusRef}
        showCloseButton={false}
        overlayClassName="bg-black/85 supports-backdrop-filter:backdrop-blur-md"
        viewportClassName={LANGUAGE_PICKER_VIEWPORT_CLASS}
        className={LANGUAGE_PICKER_MODAL_CLASS}
      >
        <WatchModalViewportCloseButton
          open={open}
          onClose={requestClose}
          testId="global-language-picker-modal-close"
          ariaLabel={t("close")}
        />
        <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>

        <p
          aria-live="polite"
          aria-atomic="true"
          data-testid="global-language-picker-status"
          className="sr-only"
        >
          {status}
        </p>

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
              loading={loadState.status === "loading"}
              testIdPrefix="global-language-picker"
              onActivate={setActiveTooltipCopy}
              onDeactivate={() => setActiveTooltipCopy(null)}
            />

            {loadState.status === "loading" ? (
              <div className="flex min-h-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                <LoaderCircle
                  aria-hidden
                  className="size-6 animate-spin text-stone-400"
                />
              </div>
            ) : null}

            {loadState.status === "empty" ? (
              <div
                data-testid="global-language-picker-empty"
                className="rounded-2xl border border-white/10 bg-white/5 p-5 text-stone-300"
              >
                {t("languageCount", { count: 0 })}
              </div>
            ) : null}

            {loadState.status === "error" ? (
              <div
                data-testid="global-language-picker-error"
                className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-stone-300"
              >
                <span>{searchT("connectionHint")}</span>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={searchT("retry")}
                  title={searchT("retry")}
                  data-testid="global-language-picker-retry"
                  className={`size-10 rounded-full p-0 text-stone-300 hover:bg-white/10 hover:text-white ${LANGUAGE_PICKER_FOCUS_RING_CLASS}`}
                  onClick={() => {
                    setLoadState({ status: "loading" })
                    setLoadAttempt((attempt) => attempt + 1)
                  }}
                >
                  <RefreshCw aria-hidden className="size-4" />
                </Button>
              </div>
            ) : null}

            {loadState.status === "ready" ? (
              <LanguageCombobox
                options={comboboxOptions}
                value={draftSlug}
                onChange={(slug) => {
                  setInvalidSelection(false)
                  setDraftSlug(slug)
                }}
                disabled={navigating}
                placeholder={t("languageHeading")}
                compact
                triggerWrapper={(trigger) => (
                  <LanguagePickerComboboxFrame
                    testIdPrefix="global-language-picker"
                    onActivate={setActiveTooltipCopy}
                    onDeactivate={() => setActiveTooltipCopy(null)}
                  >
                    {trigger}
                  </LanguagePickerComboboxFrame>
                )}
              />
            ) : null}

            {loadState.status === "ready" && draftLanguageInventoryPath ? (
              <LanguagePickerInventoryLink
                href={draftLanguageInventoryPath}
                label={draftLanguageInventoryLabel}
                testIdPrefix="global-language-picker"
              />
            ) : null}
          </div>

          <LanguagePickerActions
            applyDisabled={
              loadState.status !== "ready" || !changed || navigating
            }
            applyLabel={t("apply")}
            closeDisabled={navigating}
            closeLabel={t("close")}
            navigating={navigating}
            onApply={handleApply}
            onClose={requestClose}
            switchingLabel={t("switching")}
            testIdPrefix="global-language-picker"
            onActivate={setActiveTooltipCopy}
            onDeactivate={() => setActiveTooltipCopy(null)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
