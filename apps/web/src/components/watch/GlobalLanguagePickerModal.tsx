"use client"

import { Check, Languages, LoaderCircle, RefreshCw } from "lucide-react"
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
import { WatchModalViewportCloseButton } from "@/components/watch/WatchModalViewportCloseButton"
import { writePreferredLanguageSlug } from "@/lib/language-preference-client"
import { isPotentialPublicWatchLanguageSlug } from "@/lib/locale"
import { loadGlobalWatchLanguageOptions } from "@/lib/watch-interaction-loader"
import {
  languageSwitcherTarget,
  type GlobalLanguageOption,
} from "@/lib/watch-language-switcher"

const MODAL_FOCUS_RING_CLASS =
  "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40 focus-visible:outline-none"

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
    if (!isPotentialPublicWatchLanguageSlug(option.slug)) continue
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
        name: option.englishName,
        nativeName: option.nativeName,
      })),
    [options],
  )
  const selectedOption = options.find((option) => option.slug === draftSlug)
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
      !isPotentialPublicWatchLanguageSlug(selectedOption.slug)
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
        viewportClassName="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"
        className="w-[min(608px,calc(100vw-1.5rem))] max-w-[608px] gap-8 border-white/10 bg-stone-950 p-6 text-stone-100 ring-white/10 sm:p-8"
      >
        <WatchModalViewportCloseButton
          open={open}
          onClose={requestClose}
          testId="global-language-picker-modal-close"
          ariaLabel={t("close")}
        />
        <DialogTitle className="flex items-center gap-3 text-xl font-semibold">
          <Languages aria-hidden className="size-5" />
          {t("dialogTitle")}
        </DialogTitle>

        <p
          aria-live="polite"
          aria-atomic="true"
          data-testid="global-language-picker-status"
          className="text-sm text-stone-400"
        >
          {status}
        </p>

        {loadState.status === "loading" ? (
          <div className="flex min-h-16 items-center justify-center">
            <LoaderCircle aria-hidden className="size-6 animate-spin" />
          </div>
        ) : null}

        {loadState.status === "empty" ? (
          <div
            data-testid="global-language-picker-empty"
            className="rounded-xl border border-white/10 bg-white/5 p-5 text-stone-300"
          >
            {t("languageCount", { count: 0 })}
          </div>
        ) : null}

        {loadState.status === "error" ? (
          <div
            data-testid="global-language-picker-error"
            className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 p-5 text-stone-300"
          >
            <span>{searchT("connectionHint")}</span>
            <Button
              type="button"
              variant="ghost"
              aria-label={searchT("retry")}
              title={searchT("retry")}
              data-testid="global-language-picker-retry"
              className={MODAL_FOCUS_RING_CLASS}
              onClick={() => {
                setLoadState({ status: "loading" })
                setLoadAttempt((attempt) => attempt + 1)
              }}
            >
              <RefreshCw aria-hidden className="size-4" />
              {searchT("retry")}
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
          />
        ) : null}

        <div className="flex flex-wrap justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            data-testid="global-language-picker-close"
            disabled={navigating}
            onClick={requestClose}
            className={`rounded-full px-5 py-3 text-xs font-bold tracking-wider text-stone-300 uppercase ${MODAL_FOCUS_RING_CLASS}`}
          >
            {t("close")}
          </Button>
          <Button
            type="button"
            variant="pill"
            data-testid="global-language-picker-apply"
            disabled={loadState.status !== "ready" || !changed || navigating}
            onClick={handleApply}
            className={MODAL_FOCUS_RING_CLASS}
          >
            {navigating ? (
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
            ) : (
              <Check aria-hidden className="size-4" />
            )}
            {navigating ? `${t("apply")}…` : t("apply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
