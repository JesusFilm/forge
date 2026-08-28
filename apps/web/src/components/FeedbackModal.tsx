"use client"

import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Crosshair,
  FileText,
  Film,
  Globe2,
  Heart,
  Lightbulb,
  Loader2,
  Monitor,
  Search,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react"
import { useTranslations } from "next-intl"
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  LanguageCombobox,
  type LanguageComboboxOption,
} from "@/components/watch/LanguageCombobox"
import {
  collectFeedbackDiagnostics,
  collectFeedbackPageContext,
  feedbackElementLabel,
  feedbackElementPath,
  feedbackElementRole,
  resolveFeedbackElementTarget,
  type FeedbackCategory,
  type FeedbackContentScope,
  type FeedbackDiagnostics,
  type FeedbackLanguageArea,
  type FeedbackPageContext,
  type FeedbackSelectedElement,
  type FeedbackSubmission,
} from "@/lib/feedback"
import { addFeedbackFollowUpEmail, submitFeedback } from "@/lib/feedback-action"
import { publicWatchAudioLanguageSlugForLocale } from "@/lib/locale"
import { loadGlobalWatchLanguageOptions } from "@/lib/watch-interaction-loader"
import {
  fetchWatchSearchSuggestions,
  type WatchSearchSuggestion,
} from "@/lib/watch-search-client"

const FEEDBACK_STEP_COUNT = 5
const FEEDBACK_SUBMISSION_TIMEOUT_MS = 15_000
const SUPPORT_FORM_URL = "https://www.jesusfilm.org/contact/"

// Typed failure reasons from the server actions (derived from the action
// return types so the switches below stay exhaustive-checkable), plus the
// client-local timeout the submission race can synthesize.
type FeedbackSubmitFailureReason =
  | Extract<Awaited<ReturnType<typeof submitFeedback>>, { ok: false }>["reason"]
  | "client_timeout"

type FeedbackFollowUpFailureReason = Extract<
  Awaited<ReturnType<typeof addFeedbackFollowUpEmail>>,
  { ok: false }
>["reason"]

// Client-side translation keys for submission failures, keyed by the typed
// `reason` on FeedbackActionResult (the server has no locale context, so its
// English `message` is never rendered). Unknown reasons get the generic copy.
function submissionErrorKey(reason: FeedbackSubmitFailureReason): string {
  switch (reason) {
    case "invalid":
      return "errors.invalid"
    case "rate_limited":
      return "errors.rateLimited"
    case "client_timeout":
      return "errors.timeout"
    case "delivery_failed":
      return "errors.sendFailed"
    default: {
      // Out-of-contract runtime values still fall back to the generic copy;
      // the never-assignment keeps the switch exhaustive at compile time.
      const exhausted: never = reason
      void exhausted
      return "errors.sendFailed"
    }
  }
}

// Same pattern for the follow-up email action. The client validates the email
// format before calling the action, so a server-side `invalid` in practice
// means the opaque receipt expired.
function followUpErrorKey(reason: FeedbackFollowUpFailureReason): string {
  switch (reason) {
    case "invalid":
      return "errors.followUpExpired"
    case "delivery_failed":
      return "errors.followUpFailed"
    default: {
      const exhausted: never = reason
      void exhausted
      return "errors.followUpFailed"
    }
  }
}

// Message-key names under the Feedback.steps namespace, one per wizard step.
const STEP_KEYS = ["type", "describe", "context", "point", "about"] as const

// The success screen's follow-up copy is keyed by the persisted category
// value; problem and confusing share the "problem" copy group.
function followUpCopyKey(
  category: FeedbackCategory | null,
): "idea" | "problem" | "other" {
  if (category === "idea") return "idea"
  if (category === "problem" || category === "confusing") return "problem"
  return "other"
}

type FeedbackModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onReady?: () => void
}

// Persisted `value` fields are wire/persisted enums — never localize them.
// Display strings resolve through t() inside the component.
type CategoryOption = {
  value: FeedbackCategory
  icon: typeof TriangleAlert
}

const CATEGORY_OPTIONS: CategoryOption[] = [
  { value: "problem", icon: TriangleAlert },
  { value: "confusing", icon: CircleHelp },
  { value: "idea", icon: Lightbulb },
  { value: "praise", icon: Heart },
]

const LANGUAGE_AREA_OPTIONS = [
  { value: "", labelKey: "none" },
  { value: "audio", labelKey: "audio" },
  { value: "subtitles", labelKey: "subtitles" },
  { value: "interface", labelKey: "interface" },
  { value: "title-description", labelKey: "titleDescription" },
  { value: "other", labelKey: "other" },
] as const

const CONTENT_SCOPE_OPTIONS = [
  { value: "", labelKey: "none" },
  { value: "current", labelKey: "current" },
  { value: "other", labelKey: "other" },
] as const

function ThemedSelect<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const selected = options[selectedIndex]

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", closeOnOutsideClick)
    return () => document.removeEventListener("mousedown", closeOnOutsideClick)
  }, [open])

  function choose(index: number) {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    setActiveIndex(index)
    setOpen(false)
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") {
      setOpen(false)
      return
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => {
        const direction = event.key === "ArrowDown" ? 1 : -1
        return (current + direction + options.length) % options.length
      })
      return
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault()
      setOpen(true)
      setActiveIndex(event.key === "Home" ? 0 : options.length - 1)
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      if (open) choose(activeIndex)
      else setOpen(true)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open ? `${listId}-option-${activeIndex}` : undefined
        }
        data-testid={`${id}-trigger`}
        onClick={() => {
          if (!open) setActiveIndex(selectedIndex)
          setOpen((current) => !current)
        }}
        onKeyDown={handleKeyDown}
        className="flex h-11 w-full cursor-pointer items-center justify-between rounded-xl border border-white/15 bg-white/[0.035] px-4 text-left text-base sm:text-sm text-white transition hover:border-white/30 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none"
      >
        <span className="truncate">{selected?.label}</span>
        <ChevronDown
          aria-hidden
          className={`size-4 shrink-0 text-stone-400 transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute top-full right-0 left-0 z-40 mt-2 max-h-72 overflow-y-auto rounded-xl border border-white/15 bg-stone-950/95 p-1.5 shadow-2xl backdrop-blur-md"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value
            const isActive = index === activeIndex
            return (
              <li key={option.value || "none"}>
                <button
                  id={`${listId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-value={option.value}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(index)}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left text-base sm:text-sm transition focus-visible:outline-none ${
                    isSelected
                      ? "bg-brand-red text-white"
                      : isActive
                        ? "bg-white/10 text-white"
                        : "text-stone-200 hover:bg-white/[0.07]"
                  }`}
                >
                  <Check
                    aria-hidden
                    className={`size-4 shrink-0 ${isSelected ? "opacity-100" : "opacity-0"}`}
                  />
                  <span>{option.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-2 block text-base sm:text-sm font-semibold text-stone-100">
      {children}
    </span>
  )
}

function inputClassName(hasError = false) {
  return `h-11 w-full rounded-xl border bg-white/[0.035] px-4 text-base sm:text-sm text-white transition placeholder:text-stone-600 focus-visible:ring-2 focus-visible:outline-none ${
    hasError
      ? "border-brand-red/80 focus-visible:ring-brand-red/40"
      : "border-white/15 hover:border-white/25 focus-visible:border-white/35 focus-visible:ring-white/20"
  }`
}

function ElementPicker({
  onCancel,
  onSelect,
}: {
  onCancel: () => void
  onSelect: (element: FeedbackSelectedElement) => void
}) {
  const t = useTranslations("Feedback")
  const hoveredRef = useRef<HTMLElement | null>(null)
  const [outline, setOutline] = useState<DOMRect | null>(null)
  const [label, setLabel] = useState("")

  useEffect(() => {
    function updateTarget(target: EventTarget | null) {
      const element = resolveFeedbackElementTarget(target)
      if (!element) {
        hoveredRef.current = null
        setOutline(null)
        setLabel("")
        return
      }
      hoveredRef.current = element
      setOutline(element.getBoundingClientRect())
      setLabel(feedbackElementLabel(element))
    }

    function selectCurrent() {
      const element = hoveredRef.current
      if (!element) return
      onSelect({
        label: feedbackElementLabel(element),
        role: feedbackElementRole(element),
        path: feedbackElementPath(element),
      })
    }

    function handlePointerMove(event: PointerEvent) {
      updateTarget(event.target)
    }

    function handleClick(event: MouseEvent) {
      const element = resolveFeedbackElementTarget(event.target)
      if (!element) return
      event.preventDefault()
      event.stopImmediatePropagation()
      hoveredRef.current = element
      selectCurrent()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        onCancel()
      } else if (event.key === "Enter" && hoveredRef.current) {
        event.preventDefault()
        selectCurrent()
      }
    }

    document.addEventListener("pointermove", handlePointerMove, true)
    document.addEventListener("click", handleClick, true)
    document.addEventListener("keydown", handleKeyDown, true)
    return () => {
      document.removeEventListener("pointermove", handlePointerMove, true)
      document.removeEventListener("click", handleClick, true)
      document.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [onCancel, onSelect])

  return (
    <div
      data-feedback-ignore
      data-testid="feedback-element-picker"
      className="pointer-events-none fixed inset-0 z-[90]"
    >
      {outline ? (
        <div
          aria-hidden
          className="fixed rounded-md border-2 border-brand-red bg-brand-red/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.42),0_0_24px_rgba(239,51,64,0.45)]"
          style={{
            top: outline.top - 4,
            left: outline.left - 4,
            width: outline.width + 8,
            height: outline.height + 8,
          }}
        />
      ) : null}
      <div className="pointer-events-auto fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] mx-auto flex max-w-xl items-center gap-3 rounded-2xl border border-white/15 bg-stone-950/95 p-3 text-stone-100 shadow-2xl backdrop-blur-md">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-red/15 text-brand-red">
          <Crosshair aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base sm:text-sm font-semibold">
            {t("picker.title")}
          </p>
          <p className="truncate text-sm sm:text-xs text-stone-400">
            {label || t("picker.hint")}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full px-4 text-base sm:text-sm font-semibold text-stone-200 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
        >
          <X aria-hidden className="size-4" />
          {t("picker.cancel")}
        </button>
      </div>
    </div>
  )
}

export function FeedbackModal({
  open,
  onOpenChange,
  onReady,
}: FeedbackModalProps) {
  const t = useTranslations("Feedback")
  const [step, setStep] = useState(1)
  const [category, setCategory] = useState<FeedbackCategory | null>(null)
  const [message, setMessage] = useState("")
  const [languageArea, setLanguageArea] = useState<FeedbackLanguageArea | "">(
    "",
  )
  const [languageSlug, setLanguageSlug] = useState("")
  const [customLanguageName, setCustomLanguageName] = useState("")
  const [useCustomLanguage, setUseCustomLanguage] = useState(false)
  const [languageOptions, setLanguageOptions] = useState<
    LanguageComboboxOption[]
  >([])
  const [languageOptionsState, setLanguageOptionsState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle")
  const [languageLoadAttempt, setLanguageLoadAttempt] = useState(0)
  const [contentScope, setContentScope] = useState<FeedbackContentScope | "">(
    "",
  )
  const [contentQuery, setContentQuery] = useState("")
  const [contentResults, setContentResults] = useState<WatchSearchSuggestion[]>(
    [],
  )
  const [selectedContent, setSelectedContent] =
    useState<WatchSearchSuggestion | null>(null)
  const [contentSearchState, setContentSearchState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [website, setWebsite] = useState("")
  const [page, setPage] = useState<FeedbackPageContext | null>(null)
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false)
  const [diagnostics, setDiagnostics] = useState<FeedbackDiagnostics | null>(
    null,
  )
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selectingElement, setSelectingElement] = useState(false)
  const [selectedElement, setSelectedElement] =
    useState<FeedbackSelectedElement | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submittedWithEmail, setSubmittedWithEmail] = useState(false)
  const [submissionReceipt, setSubmissionReceipt] = useState("")
  const [followUpEmail, setFollowUpEmail] = useState("")
  const [followUpSubmitting, setFollowUpSubmitting] = useState(false)
  const [followUpAdded, setFollowUpAdded] = useState(false)
  const [followUpError, setFollowUpError] = useState("")
  const [error, setError] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const formRef = useRef<HTMLFormElement>(null)
  const stepHeadingRef = useRef<HTMLHeadingElement>(null)

  const categoryOption = useMemo(
    () =>
      CATEGORY_OPTIONS.find((option) => option.value === category) ??
      CATEGORY_OPTIONS[0],
    [category],
  )
  // Memoized so per-keystroke re-renders don't re-run the t() lookups.
  const currentStepCopy = useMemo(() => {
    if (step === 2) {
      return {
        title: t(`categories.${categoryOption.value}.prompt`),
        helper: t(`categories.${categoryOption.value}.helper`),
      }
    }
    const stepKey = STEP_KEYS[step - 1] ?? "type"
    return {
      title: t(`steps.${stepKey}.title`),
      helper: t(`steps.${stepKey}.helper`),
    }
  }, [categoryOption.value, step, t])
  const languageAreaOptions = useMemo(
    () =>
      LANGUAGE_AREA_OPTIONS.map((option) => ({
        value: option.value,
        label: t(`languageAreas.${option.labelKey}`),
      })),
    [t],
  )
  const contentScopeOptions = useMemo(
    () =>
      CONTENT_SCOPE_OPTIONS.map((option) => ({
        value: option.value,
        label: t(`contentScopes.${option.labelKey}`),
      })),
    [t],
  )
  // Explicit label map: an unmapped future FeedbackDiagnostics field is a
  // compile error. <dd> values stay raw (they are persisted to Linear).
  const diagnosticsLabels = useMemo(
    () =>
      ({
        browser: t("diagnostics.labels.browser"),
        operatingSystem: t("diagnostics.labels.operatingSystem"),
        device: t("diagnostics.labels.device"),
        viewport: t("diagnostics.labels.viewport"),
        timeZone: t("diagnostics.labels.timeZone"),
        appVersion: t("diagnostics.labels.appVersion"),
      }) satisfies Record<keyof FeedbackDiagnostics, string>,
    [t],
  )
  const selectedLanguage = useMemo(
    () =>
      languageOptions.find((option) => option.slug === languageSlug) ?? null,
    [languageOptions, languageSlug],
  )
  const contentSearchLanguageSlug =
    languageSlug ||
    publicWatchAudioLanguageSlugForLocale(page?.locale ?? "en") ||
    "english"
  useEffect(() => {
    onReady?.()
  }, [onReady])

  useEffect(() => {
    if (!open) return
    setStep(1)
    setPage(collectFeedbackPageContext())
  }, [open])

  useEffect(() => {
    if (!open) return
    if (formRef.current) formRef.current.scrollTop = 0
    if (step > 1) stepHeadingRef.current?.focus()
  }, [open, step])

  useEffect(() => {
    if (!includeDiagnostics) {
      setDiagnostics(null)
      return
    }
    setDiagnostics(collectFeedbackDiagnostics())
  }, [includeDiagnostics])

  useEffect(() => {
    if (!open || !languageArea) return
    let active = true
    setLanguageOptionsState("loading")
    void loadGlobalWatchLanguageOptions()
      .then((options) => {
        if (!active) return
        const nextOptions = options.map((option) => ({
          slug: option.slug,
          searchAliasSlug: option.aliasOwnerSlug,
          name: option.englishName,
          nativeName: option.nativeName,
        }))
        setLanguageOptions(nextOptions)
        setLanguageOptionsState("ready")
        setLanguageSlug((current) => {
          if (nextOptions.some((option) => option.slug === current)) {
            return current
          }
          const pageLanguage = publicWatchAudioLanguageSlugForLocale(
            page?.locale ?? "en",
          )
          return (
            nextOptions.find((option) => option.slug === pageLanguage)?.slug ??
            nextOptions[0]?.slug ??
            ""
          )
        })
      })
      .catch(() => {
        if (active) setLanguageOptionsState("error")
      })
    return () => {
      active = false
    }
  }, [languageArea, languageLoadAttempt, open, page?.locale])

  useEffect(() => {
    if (contentScope !== "other") {
      setContentResults([])
      setContentSearchState("idle")
      return
    }
    const query = contentQuery.trim()
    if (query.length < 2 || selectedContent) {
      setContentResults([])
      setContentSearchState("idle")
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setContentSearchState("loading")
      void fetchWatchSearchSuggestions({
        query,
        languageSlug: contentSearchLanguageSlug,
        signal: controller.signal,
      })
        .then((suggestions) => {
          if (controller.signal.aborted) return
          setContentResults(
            suggestions.filter((suggestion) => suggestion.kind === "content"),
          )
          setContentSearchState("ready")
        })
        .catch(() => {
          if (!controller.signal.aborted) setContentSearchState("error")
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [contentQuery, contentScope, contentSearchLanguageSlug, selectedContent])

  function validateStep(targetStep: number): boolean {
    const next: Record<string, string> = {}
    if (targetStep === 1 && !category) {
      next.category = t("validation.category")
    }
    if (targetStep === 2 && message.trim().length < 10) {
      next.message = t("validation.message")
    }
    if (targetStep === 5 && !name.trim()) next.name = t("validation.name")
    if (
      targetStep === 5 &&
      email.trim() &&
      !/^\S+@\S+\.\S+$/.test(email.trim())
    ) {
      next.email = t("validation.email")
    }
    setFieldErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (step < FEEDBACK_STEP_COUNT) {
      if (validateStep(step)) setStep((current) => current + 1)
      else if (step === 2) {
        document.getElementById("feedback-message")?.focus()
      }
      return
    }
    if (!validateStep(5) || !page) {
      document
        .getElementById(name.trim() ? "feedback-email" : "feedback-name")
        ?.focus()
      return
    }
    if (!category) {
      setFieldErrors({ category: t("validation.category") })
      setStep(1)
      return
    }

    const payload: FeedbackSubmission = {
      category,
      message: message.trim(),
      name: name.trim(),
      page,
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(languageArea
        ? {
            languageIssue: {
              area: languageArea,
              language:
                (useCustomLanguage || languageOptionsState === "error"
                  ? customLanguageName.trim()
                  : selectedLanguage?.name) || "Not specified",
            },
          }
        : {}),
      ...(contentScope
        ? {
            content:
              contentScope === "current"
                ? { scope: contentScope, title: page.title, url: page.url }
                : {
                    scope: contentScope,
                    title:
                      selectedContent?.title ||
                      contentQuery.trim() ||
                      "Not specified",
                    ...(selectedContent?.id ? { id: selectedContent.id } : {}),
                    ...(selectedContent?.slug
                      ? { slug: selectedContent.slug }
                      : {}),
                    ...(selectedContent?.label
                      ? { label: selectedContent.label }
                      : {}),
                  },
          }
        : {}),
      ...(selectedElement ? { selectedElement } : {}),
      ...(includeDiagnostics && diagnostics ? { diagnostics } : {}),
      ...(website ? { website } : {}),
    }

    setSubmitting(true)
    setError("")
    let timeoutId: number | undefined
    try {
      const result = await Promise.race([
        submitFeedback(payload),
        new Promise<{ ok: false; reason: "client_timeout" }>((resolve) => {
          timeoutId = window.setTimeout(
            () => resolve({ ok: false, reason: "client_timeout" }),
            FEEDBACK_SUBMISSION_TIMEOUT_MS,
          )
        }),
      ])
      if (result.ok) {
        setSubmittedWithEmail(Boolean(email.trim()))
        setSubmissionReceipt(result.receipt ?? "")
        setSubmitted(true)
      }
      // Render locale-aware copy keyed by the typed reason; the server's
      // `message` string is English-only and is deliberately not rendered.
      else setError(t(submissionErrorKey(result.reason)))
    } catch {
      setError(t("errors.sendFailed"))
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      setSubmitting(false)
    }
  }

  async function handleFollowUpEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedEmail = followUpEmail.trim()
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setFollowUpError(t("validation.email"))
      return
    }
    if (!submissionReceipt) {
      setFollowUpError(t("errors.followUpFailed"))
      return
    }

    setFollowUpSubmitting(true)
    setFollowUpError("")
    try {
      const result = await addFeedbackFollowUpEmail({
        email: normalizedEmail,
        receipt: submissionReceipt,
      })
      if (result.ok) setFollowUpAdded(true)
      // Reason-keyed translation; the server's English `message` string is
      // deliberately never rendered.
      else setFollowUpError(t(followUpErrorKey(result.reason)))
    } catch {
      setFollowUpError(t("errors.followUpFailed"))
    } finally {
      setFollowUpSubmitting(false)
    }
  }

  function close() {
    if (submitting || followUpSubmitting) return
    onOpenChange(false)
  }

  function handleSelectedElement(element: FeedbackSelectedElement) {
    setSelectedElement(element)
    setSelectingElement(false)
  }

  if (selectingElement) {
    return (
      <ElementPicker
        onCancel={() => setSelectingElement(false)}
        onSelect={handleSelectedElement}
      />
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && (submitting || followUpSubmitting)) return
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        data-feedback-ignore
        data-testid="feedback-modal"
        overlayClassName="z-[70] bg-black/85 supports-backdrop-filter:backdrop-blur-md"
        viewportClassName="fixed inset-0 z-[71] flex overflow-x-hidden overflow-y-auto px-3 py-16 sm:py-24"
        showCloseButton={false}
        className="m-auto w-full max-w-[800px] shrink-0 overflow-visible rounded-none border-0 bg-transparent p-0 text-stone-100 ring-0"
      >
        <button
          type="button"
          aria-label={t("closeForm")}
          data-testid="feedback-modal-close"
          onClick={close}
          disabled={submitting || followUpSubmitting}
          className="fixed top-[max(0.75rem,env(safe-area-inset-top,0px))] right-[max(0.75rem,env(safe-area-inset-right,0px))] z-50 grid size-11 cursor-pointer place-items-center rounded-full text-stone-400 transition hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none sm:top-5 sm:right-5"
        >
          <X aria-hidden className="size-5" />
        </button>

        {submitted ? (
          <div className="grid w-full place-items-center px-3 py-10 text-center sm:px-12 sm:py-16">
            <div className="w-full max-w-md">
              <span className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-500/12 text-emerald-400 ring-1 ring-emerald-400/25">
                <CheckCircle2 aria-hidden className="size-8" />
              </span>
              <DialogTitle className="mt-6 text-3xl font-semibold text-white">
                {t("success.title")}
              </DialogTitle>
              {/* `sm:text-base` is load-bearing: DialogDescription's phone tier is
                  `text-base sm:text-sm`, and overriding only the base size would
                  leave that `sm:` rule live and shrink this to 14px on desktop. */}
              <DialogDescription className="mt-3 text-base leading-relaxed text-stone-300 sm:text-base">
                {t("success.description")}{" "}
                {submittedWithEmail || followUpAdded
                  ? t(
                      `success.followUp.${followUpCopyKey(category)}.confirmation`,
                    )
                  : t(
                      `success.followUp.${followUpCopyKey(category)}.invitation`,
                    )}
              </DialogDescription>
              {!submittedWithEmail && !followUpAdded ? (
                <form
                  data-testid="feedback-follow-up-email-form"
                  noValidate
                  onSubmit={handleFollowUpEmail}
                  className="mt-7 text-left"
                >
                  <label
                    htmlFor="feedback-follow-up-email"
                    className="mb-2 block text-base sm:text-sm font-semibold text-stone-100"
                  >
                    {t("fields.email.label")}{" "}
                    <span className="font-normal text-stone-500">
                      {t("fields.optional")}
                    </span>
                  </label>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <input
                      id="feedback-follow-up-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={followUpEmail}
                      maxLength={254}
                      aria-invalid={Boolean(followUpError)}
                      onChange={(event) => {
                        setFollowUpEmail(event.target.value)
                        if (followUpError) setFollowUpError("")
                      }}
                      placeholder={t("success.followUp.emailPlaceholder")}
                      className={inputClassName(Boolean(followUpError))}
                    />
                    <button
                      type="submit"
                      disabled={followUpSubmitting}
                      className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-brand-red px-6 text-base sm:text-sm font-semibold text-white transition hover:bg-brand-red/90 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      {followUpSubmitting ? (
                        <Loader2 aria-hidden className="size-4 animate-spin" />
                      ) : null}
                      {followUpSubmitting
                        ? t("success.followUp.adding")
                        : t("success.followUp.addEmail")}
                    </button>
                  </div>
                  {followUpError ? (
                    <p
                      role="alert"
                      className="mt-2 text-sm sm:text-xs leading-relaxed text-red-200"
                    >
                      {followUpError}{" "}
                      <a
                        href={SUPPORT_FORM_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold underline underline-offset-4 hover:text-white"
                      >
                        {t("errors.openSupportForm")}
                      </a>
                    </p>
                  ) : null}
                </form>
              ) : null}
              <button
                type="button"
                onClick={close}
                className="mt-7 h-11 cursor-pointer rounded-full border border-white/15 px-7 text-base sm:text-sm font-semibold text-stone-200 transition hover:border-white/30 hover:bg-white/[0.05] hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
              >
                {t("success.done")}
              </button>
            </div>
          </div>
        ) : (
          <form
            ref={formRef}
            noValidate
            onSubmit={handleSubmit}
            className="w-full overflow-visible px-2 py-2 sm:px-10 sm:py-4"
          >
            <header className="pr-12 sm:pr-14">
              <DialogTitle className="text-3xl leading-tight font-semibold text-white sm:text-[2rem]">
                {t("header.title")}
              </DialogTitle>
              <DialogDescription className="mt-1.5 text-sm leading-relaxed text-stone-300 sm:text-base">
                {t("header.description")}
              </DialogDescription>
              <div
                className="mt-5 flex items-center gap-3"
                aria-label={t("steps.progressLabel", {
                  step,
                  count: FEEDBACK_STEP_COUNT,
                })}
              >
                <span className="shrink-0 text-sm sm:text-xs font-semibold text-stone-400">
                  {step} / {FEEDBACK_STEP_COUNT}
                </span>
                <div className="grid flex-1 grid-cols-5 gap-1.5" aria-hidden>
                  {Array.from({ length: FEEDBACK_STEP_COUNT }, (_, index) => (
                    <span
                      key={index}
                      className={`h-1 rounded-full transition-colors ${
                        index < step ? "bg-brand-red" : "bg-white/10"
                      }`}
                    />
                  ))}
                </div>
              </div>
              <h3
                ref={stepHeadingRef}
                tabIndex={-1}
                className="mt-5 text-xl font-semibold text-white focus:outline-none"
              >
                {currentStepCopy?.title}
              </h3>
              <p className="mt-1 text-base sm:text-sm text-stone-400">
                {currentStepCopy?.helper}
              </p>
            </header>

            {step === 1 ? (
              <fieldset className="mt-6" data-testid="feedback-step-1">
                <legend className="sr-only">{t("categories.legend")}</legend>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
                  {CATEGORY_OPTIONS.map((option) => {
                    const Icon = option.icon
                    const selected = category === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        data-testid={`feedback-category-${option.value}`}
                        onClick={() => {
                          setCategory(option.value)
                          setFieldErrors((current) => {
                            if (!current.category) return current
                            const next = { ...current }
                            delete next.category
                            return next
                          })
                        }}
                        className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border px-3 py-4 text-base sm:text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none sm:min-h-28 ${
                          selected
                            ? "border-brand-red bg-brand-red/[0.06] text-brand-red shadow-[0_0_0_1px_rgba(239,51,64,0.12)]"
                            : "border-white/15 bg-white/[0.025] text-stone-300 hover:border-white/30 hover:bg-white/[0.05] hover:text-white"
                        }`}
                      >
                        <Icon aria-hidden className="size-7" />
                        {t(`categories.${option.value}.label`)}
                      </button>
                    )
                  })}
                </div>
                {fieldErrors.category ? (
                  <p
                    role="alert"
                    className="mt-3 text-base sm:text-sm text-brand-red"
                  >
                    {fieldErrors.category}
                  </p>
                ) : null}
              </fieldset>
            ) : null}

            {step === 2 ? (
              <div className="mt-6" data-testid="feedback-step-2">
                <label htmlFor="feedback-message">
                  <FieldLabel>
                    {t("fields.details.label")}{" "}
                    <span className="text-brand-red" aria-hidden>
                      *
                    </span>
                  </FieldLabel>
                </label>
                <div
                  className={`overflow-hidden rounded-xl border bg-white/[0.025] transition focus-within:ring-2 ${
                    fieldErrors.message
                      ? "border-brand-red/80 focus-within:ring-brand-red/40"
                      : "border-white/15 focus-within:border-white/30 focus-within:ring-white/20"
                  }`}
                >
                  <textarea
                    id="feedback-message"
                    value={message}
                    maxLength={1000}
                    aria-invalid={Boolean(fieldErrors.message)}
                    aria-describedby={
                      fieldErrors.message ? "feedback-message-error" : undefined
                    }
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder={t("fields.details.placeholder")}
                    className="min-h-28 w-full resize-y bg-transparent px-4 py-3 text-base sm:text-sm leading-relaxed text-white placeholder:text-stone-600 focus:outline-none sm:min-h-[6.5rem]"
                  />
                  <div className="flex min-h-9 items-center border-t border-white/8 px-4 text-sm sm:text-xs text-stone-500">
                    {fieldErrors.message ? (
                      <span
                        id="feedback-message-error"
                        role="alert"
                        className="text-brand-red"
                      >
                        {fieldErrors.message}
                      </span>
                    ) : null}
                    <span className="ml-auto tabular-nums">
                      {message.length} / 1000
                    </span>
                  </div>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div
                className="mt-5 grid gap-4 sm:grid-cols-2"
                data-testid="feedback-step-3"
              >
                <div>
                  <label htmlFor="feedback-language-area">
                    <FieldLabel>{t("fields.languageArea.label")}</FieldLabel>
                  </label>
                  <ThemedSelect
                    id="feedback-language-area"
                    label={t("fields.languageArea.label")}
                    value={languageArea}
                    options={languageAreaOptions}
                    onChange={(value) => {
                      setLanguageArea(value)
                      if (!value) {
                        setLanguageSlug("")
                        setCustomLanguageName("")
                        setUseCustomLanguage(false)
                      }
                    }}
                  />
                  {languageArea ? (
                    <div className="mt-3">
                      <span className="mb-1.5 block text-sm sm:text-xs font-medium text-stone-400">
                        {t("fields.affectedLanguage.label")}
                      </span>
                      {languageOptionsState === "error" || useCustomLanguage ? (
                        <input
                          type="text"
                          value={customLanguageName}
                          maxLength={100}
                          autoFocus
                          placeholder={t("fields.affectedLanguage.placeholder")}
                          aria-label={t("fields.affectedLanguage.label")}
                          onChange={(event) => {
                            setCustomLanguageName(event.target.value)
                            setUseCustomLanguage(true)
                          }}
                          className={inputClassName()}
                        />
                      ) : (
                        <LanguageCombobox
                          options={languageOptions}
                          value={languageSlug}
                          onChange={(value) => {
                            setLanguageSlug(value)
                            setUseCustomLanguage(false)
                          }}
                          disabled={languageOptionsState !== "ready"}
                          placeholder={
                            languageOptionsState === "loading"
                              ? t("languagePicker.loading")
                              : t("languagePicker.select")
                          }
                          compact
                          triggerClassName="!h-11 !min-h-11 !rounded-xl !px-3"
                        />
                      )}
                      <div className="mt-2 flex items-center justify-between gap-3 text-sm sm:text-xs">
                        <span className="text-stone-500">
                          {languageOptionsState === "error"
                            ? t("languagePicker.unavailable")
                            : t("languagePicker.cantFind")}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (languageOptionsState === "error") {
                              setLanguageLoadAttempt((attempt) => attempt + 1)
                            } else {
                              setUseCustomLanguage((current) => !current)
                            }
                          }}
                          className="shrink-0 cursor-pointer font-semibold text-stone-300 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none"
                        >
                          {languageOptionsState === "error"
                            ? t("languagePicker.retryList")
                            : useCustomLanguage
                              ? t("languagePicker.chooseFromList")
                              : t("languagePicker.enterManually")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div>
                  <label htmlFor="feedback-content-scope">
                    <FieldLabel>{t("fields.contentScope.label")}</FieldLabel>
                  </label>
                  <ThemedSelect
                    id="feedback-content-scope"
                    label={t("fields.contentScope.label")}
                    value={contentScope}
                    options={contentScopeOptions}
                    onChange={(value) => {
                      setContentScope(value)
                      setSelectedContent(null)
                      setContentQuery("")
                      setContentResults([])
                    }}
                  />
                  {contentScope === "current" && page ? (
                    <p className="mt-2 truncate text-sm sm:text-xs text-stone-500">
                      {page.title}
                    </p>
                  ) : null}
                  {contentScope === "other" ? (
                    <div className="relative mt-3">
                      <label htmlFor="feedback-content-title">
                        <span className="mb-1.5 block text-sm sm:text-xs font-medium text-stone-400">
                          {t("fields.contentSearch.label")}
                        </span>
                      </label>
                      {selectedContent ? (
                        <div className="flex h-11 items-center gap-2 rounded-xl border border-brand-red/35 bg-brand-red/[0.06] px-3">
                          <Film
                            aria-hidden
                            className="size-4 shrink-0 text-brand-red"
                          />
                          <span className="min-w-0 flex-1 truncate text-base sm:text-sm font-medium text-stone-100">
                            {selectedContent.title}
                          </span>
                          {selectedContent.label ? (
                            <span className="hidden shrink-0 text-xs font-semibold tracking-wide text-stone-500 uppercase sm:inline sm:text-[10px]">
                              {selectedContent.label.replaceAll("_", " ")}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            aria-label={t("contentSearch.clearSelected")}
                            onClick={() => {
                              setSelectedContent(null)
                              setContentQuery("")
                            }}
                            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-stone-400 hover:bg-white/10 hover:text-white"
                          >
                            <X aria-hidden className="size-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="relative">
                          <Search
                            aria-hidden
                            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-500"
                          />
                          <input
                            id="feedback-content-title"
                            type="search"
                            value={contentQuery}
                            maxLength={200}
                            autoComplete="off"
                            placeholder={t("fields.contentSearch.placeholder")}
                            aria-autocomplete="list"
                            aria-controls="feedback-content-results"
                            onChange={(event) => {
                              setContentQuery(event.target.value)
                              setSelectedContent(null)
                            }}
                            className={`${inputClassName()} pl-9`}
                          />
                        </div>
                      )}
                      {!selectedContent && contentSearchState === "loading" ? (
                        <p className="mt-2 text-sm sm:text-xs text-stone-500">
                          {t("contentSearch.searching")}
                        </p>
                      ) : null}
                      {!selectedContent && contentSearchState === "error" ? (
                        <p className="mt-2 text-sm sm:text-xs text-stone-400">
                          {t("contentSearch.error")}
                        </p>
                      ) : null}
                      {!selectedContent &&
                      contentSearchState === "ready" &&
                      contentResults.length === 0 ? (
                        <p className="mt-2 text-sm sm:text-xs text-stone-500">
                          {t("contentSearch.noMatch")}
                        </p>
                      ) : null}
                      {!selectedContent && contentResults.length > 0 ? (
                        <ul
                          id="feedback-content-results"
                          className="absolute top-full right-0 left-0 z-20 mt-2 max-h-60 overflow-y-auto rounded-xl border border-white/15 bg-stone-900 p-1.5 shadow-2xl"
                        >
                          {contentResults.map((result) => (
                            <li key={`${result.id}:${result.slug}`}>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedContent(result)
                                  setContentQuery(result.title)
                                  setContentResults([])
                                }}
                                className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-white/[0.07] focus-visible:bg-white/[0.07] focus-visible:outline-none"
                              >
                                <Film
                                  aria-hidden
                                  className="size-4 shrink-0 text-stone-400"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-base sm:text-sm font-medium text-stone-100">
                                    {result.title}
                                  </span>
                                  <span className="block truncate text-xs text-stone-500 sm:text-[11px]">
                                    {result.label
                                      ? result.label.replaceAll("_", " ")
                                      : t("contentSearch.mediaFallback")}
                                    {result.description
                                      ? ` · ${result.description}`
                                      : ""}
                                  </span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {step === 5 ? (
              <div
                className="mt-5 grid gap-4 sm:grid-cols-2"
                data-testid="feedback-step-5"
              >
                <label>
                  <FieldLabel>
                    {t("fields.name.label")}{" "}
                    <span className="text-brand-red">*</span>
                  </FieldLabel>
                  <input
                    id="feedback-name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    maxLength={100}
                    aria-invalid={Boolean(fieldErrors.name)}
                    onChange={(event) => setName(event.target.value)}
                    className={inputClassName(Boolean(fieldErrors.name))}
                  />
                  {fieldErrors.name ? (
                    <span
                      role="alert"
                      className="mt-1.5 block text-sm sm:text-xs text-brand-red"
                    >
                      {fieldErrors.name}
                    </span>
                  ) : null}
                </label>
                <div>
                  <label htmlFor="feedback-email">
                    <FieldLabel>
                      {t("fields.email.label")}{" "}
                      <span className="font-normal text-stone-500">
                        {t("fields.optional")}
                      </span>
                    </FieldLabel>
                  </label>
                  <input
                    id="feedback-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    maxLength={254}
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby="feedback-email-helper"
                    onChange={(event) => setEmail(event.target.value)}
                    className={inputClassName(Boolean(fieldErrors.email))}
                  />
                  {fieldErrors.email ? (
                    <span
                      role="alert"
                      className="mt-1.5 block text-sm sm:text-xs text-brand-red"
                    >
                      {fieldErrors.email}
                    </span>
                  ) : null}
                  <p
                    id="feedback-email-helper"
                    className="mt-1.5 text-sm sm:text-xs leading-relaxed text-stone-500"
                  >
                    {t("fields.email.helper")}
                  </p>
                </div>
              </div>
            ) : null}

            <label className="sr-only" aria-hidden>
              Website
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </label>

            {step === 4 ? (
              <div data-testid="feedback-step-4">
                {page ? (
                  <div
                    data-testid="feedback-page-context"
                    className="mt-5 flex min-h-11 items-center gap-3 overflow-hidden rounded-xl border border-white/10 bg-white/[0.025] px-3 text-sm sm:text-xs text-stone-400"
                  >
                    <FileText aria-hidden className="size-4 shrink-0" />
                    <span className="max-w-44 truncate text-stone-300">
                      {page.title}
                    </span>
                    <span
                      aria-hidden
                      className="h-4 w-px shrink-0 bg-white/10"
                    />
                    <Globe2 aria-hidden className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{page.url}</span>
                    <span
                      aria-hidden
                      className="hidden h-4 w-px shrink-0 bg-white/10 sm:block"
                    />
                    <span className="hidden shrink-0 sm:inline">
                      {page.locale}
                    </span>
                    <Monitor
                      aria-hidden
                      className="hidden size-4 shrink-0 sm:block"
                    />
                  </div>
                ) : null}

                <button
                  type="button"
                  data-testid="feedback-select-element"
                  onClick={() => setSelectingElement(true)}
                  className="mt-3 flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl border border-white/15 bg-white/[0.02] px-4 text-left transition hover:border-white/30 hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none"
                >
                  <Crosshair
                    aria-hidden
                    className="size-5 shrink-0 text-stone-200"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base sm:text-sm font-semibold text-stone-100">
                      {selectedElement
                        ? selectedElement.label
                        : t("picker.mark")}
                      {!selectedElement ? (
                        <span className="ml-2 font-normal text-stone-500">
                          {t("fields.optional")}
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-sm sm:text-xs text-stone-500">
                      {selectedElement
                        ? // {role} stays the raw English DOM tag/role token.
                          t("picker.selected", { role: selectedElement.role })
                        : t("picker.markHint")}
                    </span>
                  </span>
                  <ChevronDown
                    aria-hidden
                    className="size-4 shrink-0 -rotate-90 text-stone-500"
                  />
                </button>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="mt-4 rounded-xl border border-transparent px-1">
                <div className="flex items-start gap-3">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-xl p-1 focus-within:ring-2 focus-within:ring-brand-red/40">
                    <span className="relative mt-0.5 grid size-5 shrink-0 place-items-center">
                      <input
                        type="checkbox"
                        checked={includeDiagnostics}
                        onChange={(event) =>
                          setIncludeDiagnostics(event.target.checked)
                        }
                        className="peer size-5 cursor-pointer appearance-none rounded-[5px] border border-white/25 bg-white/5 checked:border-brand-red checked:bg-brand-red focus-visible:outline-none"
                      />
                      <Check
                        aria-hidden
                        className="pointer-events-none absolute size-3.5 text-white opacity-0 peer-checked:opacity-100"
                      />
                    </span>
                    <ShieldCheck
                      aria-hidden
                      className="mt-0.5 size-5 shrink-0 text-stone-400"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-base sm:text-sm font-semibold text-stone-100">
                        {t("diagnostics.include")}
                      </span>
                      <span className="mt-0.5 block text-sm sm:text-xs leading-relaxed text-stone-500">
                        {t("diagnostics.description")}
                      </span>
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={!diagnostics}
                    aria-expanded={detailsOpen}
                    onClick={() => setDetailsOpen((current) => !current)}
                    className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 text-sm sm:text-xs font-semibold text-stone-300 hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {t("diagnostics.viewDetails")}
                    <ChevronDown
                      aria-hidden
                      className={`size-3.5 transition ${detailsOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                </div>
                {detailsOpen && diagnostics ? (
                  <dl className="mt-3 grid gap-x-5 gap-y-2 rounded-xl bg-white/[0.03] p-3 text-sm sm:text-xs sm:grid-cols-2">
                    {Object.entries(diagnostics).map(([key, value]) => (
                      <div key={key} className="min-w-0">
                        <dt className="capitalize text-stone-500">
                          {diagnosticsLabels[key as keyof FeedbackDiagnostics]}
                        </dt>
                        <dd className="truncate text-stone-300">{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <div
                role="alert"
                className="mt-5 rounded-xl border border-brand-red/30 bg-brand-red/[0.08] px-4 py-3 text-base sm:text-sm text-red-100"
              >
                <p>{error}</p>
                <a
                  data-testid="feedback-support-form-link"
                  href={SUPPORT_FORM_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full border border-red-200/25 px-4 font-semibold text-white transition hover:border-red-100/45 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
                >
                  {t("errors.openSupportForm")}
                  <ArrowUpRight aria-hidden className="size-4" />
                </a>
              </div>
            ) : null}

            <footer className="mt-6">
              <div
                className={`grid gap-3 ${step > 1 ? "grid-cols-[minmax(0,0.45fr)_minmax(0,1fr)]" : "grid-cols-1"}`}
              >
                {step > 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setFieldErrors({})
                      setStep((current) => Math.max(1, current - 1))
                    }}
                    disabled={submitting}
                    className="h-11 cursor-pointer rounded-full border border-white/15 px-5 text-base sm:text-sm font-semibold text-stone-200 hover:border-white/30 hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none disabled:opacity-50"
                  >
                    {t("nav.back")}
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={submitting || !page}
                  className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-brand-red px-6 text-base sm:text-sm font-semibold text-white shadow-[0_12px_28px_rgba(239,51,64,0.2)] transition hover:bg-brand-red/90 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {submitting ? (
                    <Loader2 aria-hidden className="size-4 animate-spin" />
                  ) : null}
                  {submitting
                    ? t("nav.sending")
                    : step === FEEDBACK_STEP_COUNT
                      ? t("nav.send")
                      : step === 4 && !selectedElement
                        ? t("nav.skip")
                        : t("nav.continue")}
                </button>
              </div>
              <p className="mt-3 flex items-center justify-center gap-2 text-center text-sm sm:text-xs text-stone-500">
                <ShieldCheck aria-hidden className="size-4 shrink-0" />
                {t("footer.reviewed")}
              </p>
            </footer>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
