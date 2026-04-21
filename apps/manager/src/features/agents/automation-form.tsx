"use client"

import { useMemo, useState, type FormEvent } from "react"
import type { LucideIcon } from "lucide-react"
import {
  Bot,
  Captions,
  ChevronLeft,
  ChevronRight,
  Languages,
  Megaphone,
  Mic2,
  Minus,
  Plus,
  RefreshCw,
  Rocket,
  Share2,
  Sparkles,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  SegmentedControl,
  SegmentedControlButton,
} from "@/components/ui/segmented-control"
import {
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperTitle,
  StepperTrigger,
} from "@/components/ui/stepper"
import { cn } from "@/lib/utils"
import {
  AUTOMATION_REFRESH_MODE_LABELS,
  AUTOMATION_TEMPLATE_LABELS,
  templateRequiresTargetLanguages,
  type AutomationDraft,
  type AutomationSchedule,
  type AutomationTemplate,
} from "./automation-contract"

export type LanguageOption = {
  coreId: string
  name: string
}

type SchedulePreset = AutomationSchedule["kind"]

type AvailableAutomationRecipe = {
  id: string
  title: string
  description: string
  icon: LucideIcon
  tone: string
  template: AutomationTemplate
  defaultCap: number
  defaultName: string
  defaultSchedule: SchedulePreset
  defaultRefreshMode: AutomationDraft["refreshMode"]
}

type UpcomingAutomationRecipe = {
  id: string
  title: string
  description: string
  icon: LucideIcon
  tone: string
}

const AVAILABLE_AUTOMATION_RECIPES: AvailableAutomationRecipe[] = [
  {
    id: "transcribe-videos",
    title: "Transcribe missing subtitles",
    description:
      "Create source subtitles for videos that still need transcript coverage.",
    icon: Captions,
    tone: "subtitles",
    template: "source_subtitles_missing",
    defaultName: "Transcribe videos with missing subtitles",
    defaultRefreshMode: "missing_only",
    defaultSchedule: "hourly",
    defaultCap: 6,
  },
  {
    id: "translate-subtitles",
    title: "Translate missing subtitles",
    description:
      "Fill target-language subtitle gaps for the language you choose below.",
    icon: Languages,
    tone: "translation",
    template: "target_subtitles_missing",
    defaultName: "Translate missing subtitles",
    defaultRefreshMode: "missing_only",
    defaultSchedule: "hourly",
    defaultCap: 4,
  },
  {
    id: "generate-meta",
    title: "Generate missing meta information",
    description:
      "Backfill titles, summaries, and taxonomy metadata for incomplete videos.",
    icon: Sparkles,
    tone: "metadata",
    template: "metadata_missing",
    defaultName: "Generate missing meta information for videos",
    defaultRefreshMode: "refresh_ai_generated",
    defaultSchedule: "daily",
    defaultCap: 8,
  },
]

const UPCOMING_AUTOMATION_RECIPES: UpcomingAutomationRecipe[] = [
  {
    id: "voice-over-dubbing",
    title: "Voice-over dubbing",
    description:
      "Queue multilingual voice-over passes once translation workflows are ready.",
    icon: Mic2,
    tone: "voice",
  },
  {
    id: "sharing-graph",
    title: "Fix social media sharing graph",
    description:
      "Repair missing preview images, titles, and share metadata before publishing.",
    icon: Share2,
    tone: "sharing",
  },
  {
    id: "improve-social",
    title: "Improve social media",
    description:
      "Generate social-ready copy, hooks, and packaging suggestions for each release.",
    icon: Megaphone,
    tone: "social",
  },
]

const AUTOMATION_RECIPES = [
  ...AVAILABLE_AUTOMATION_RECIPES.map((recipe) => ({
    ...recipe,
    status: "available" as const,
  })),
  ...UPCOMING_AUTOMATION_RECIPES.map((recipe) => ({
    ...recipe,
    status: "coming-soon" as const,
  })),
]

const SCHEDULE_OPTIONS: Array<{
  detail: string
  label: string
  value: SchedulePreset
}> = [
  { value: "every_minute", label: "Live", detail: "Every minute" },
  { value: "hourly", label: "Hourly", detail: "At minute 00" },
  { value: "daily", label: "Daily", detail: "9:00 AM" },
  { value: "weekly", label: "Weekly", detail: "Monday" },
]

const REFRESH_OPTIONS: Array<{
  description: string
  label: string
  value: AutomationDraft["refreshMode"]
}> = [
  {
    value: "missing_only",
    label: "Only missing",
    description: "Skip videos that already have generated output.",
  },
  {
    value: "refresh_ai_generated",
    label: "Refresh AI output",
    description: "Revisit AI-generated artifacts when the automation runs.",
  },
]

function buildSchedule(kind: SchedulePreset): AutomationSchedule {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  if (kind === "hourly") return { kind: "hourly", minute: 0, timezone }
  if (kind === "daily") return { kind: "daily", hour: 9, minute: 0, timezone }
  if (kind === "weekly") {
    return { kind: "weekly", weekday: "mon", hour: 9, minute: 0, timezone }
  }
  return { kind: "every_minute", timezone }
}

function getScheduleLabel(kind: SchedulePreset): string {
  return (
    SCHEDULE_OPTIONS.find((option) => option.value === kind)?.detail ?? "Custom"
  )
}

export function AutomationForm({
  languageOptions,
  onCreate,
  onCancel,
  onCreated,
}: {
  languageOptions: LanguageOption[]
  onCreate: (draft: AutomationDraft) => Promise<void>
  onCancel?: () => void
  onCreated?: () => void
}) {
  const [activeStep, setActiveStep] = useState(0)
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [template, setTemplate] = useState<AutomationTemplate>(
    "source_subtitles_missing",
  )
  const [refreshMode, setRefreshMode] =
    useState<AutomationDraft["refreshMode"]>("missing_only")
  const [schedule, setSchedule] = useState<AutomationSchedule>(() =>
    buildSchedule("hourly"),
  )
  const [targetLanguageIds, setTargetLanguageIds] = useState<string[]>([])
  const [maxVideosPerRun, setMaxVideosPerRun] = useState(6)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedRecipe = useMemo(
    () =>
      AVAILABLE_AUTOMATION_RECIPES.find(
        (recipe) => recipe.id === selectedRecipeId,
      ) ?? null,
    [selectedRecipeId],
  )
  const needsLanguages = selectedRecipe
    ? templateRequiresTargetLanguages(template)
    : false
  const hasRequiredLanguageSelection =
    !selectedRecipe || !needsLanguages || targetLanguageIds.length === 1
  const selectedLanguageId = targetLanguageIds[0] ?? ""
  const selectedLanguageName =
    languageOptions.find((language) => language.coreId === selectedLanguageId)
      ?.name ?? null
  const SelectedRecipeIcon = selectedRecipe?.icon
  const isReadyToLaunch =
    Boolean(selectedRecipe) &&
    name.trim().length > 0 &&
    hasRequiredLanguageSelection

  const stepItems = [
    {
      label: "Choose automation",
      shortLabel: "Choose",
      hint: "Pick the workflow you want to automate.",
    },
    {
      label: "Tune rules",
      shortLabel: "Rules",
      hint: "Adjust cadence, scope, and refresh behavior.",
    },
    {
      label: "Launch",
      shortLabel: "Launch",
      hint: "Review the plan and create the automation.",
    },
  ]

  function canNavigateToStep(stepIndex: number) {
    if (stepIndex === 0) return true
    if (stepIndex === 1) return Boolean(selectedRecipe)
    return Boolean(selectedRecipe) && isReadyToLaunch
  }

  function getStepStatus(stepIndex: number) {
    if (stepIndex === activeStep) return "current"
    if (stepIndex === 0 && selectedRecipe && activeStep > 0) return "complete"
    if (stepIndex === 1 && isReadyToLaunch && activeStep > 1) return "complete"
    return "upcoming"
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedRecipe) {
      setError("Choose an automation before creating it.")
      return
    }

    setIsSubmitting(true)
    setError(null)
    let didCreate = false

    try {
      await onCreate({
        name,
        template,
        refreshMode,
        schedule,
        targetLanguageIds: needsLanguages ? targetLanguageIds : [],
        maxVideosPerRun,
      })
      didCreate = true
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Automation was not created.",
      )
    } finally {
      setIsSubmitting(false)
    }

    if (didCreate) {
      onCreated?.()
    }
  }

  function applyRecipe(recipe: AvailableAutomationRecipe) {
    setSelectedRecipeId(recipe.id)
    setName(recipe.defaultName)
    setTemplate(recipe.template)
    setRefreshMode(recipe.defaultRefreshMode)
    setSchedule(buildSchedule(recipe.defaultSchedule))
    setMaxVideosPerRun(recipe.defaultCap)
    if (!templateRequiresTargetLanguages(recipe.template)) {
      setTargetLanguageIds([])
    }
    setError(null)
    setActiveStep(1)
  }

  function handleNextStep() {
    if (activeStep === 0 && selectedRecipe) {
      setActiveStep(1)
      return
    }

    if (activeStep === 1 && selectedRecipe) {
      setActiveStep(2)
    }
  }

  function renderRecipeStep() {
    return (
      <section
        className="space-y-8 px-6 py-6 sm:px-8 sm:py-8"
        aria-labelledby="agents-recipe-title"
      >
        <div className="space-y-3">
          <h4
            id="agents-recipe-title"
            className="text-[clamp(2rem,4.5vw,3rem)] font-semibold leading-[1.02] tracking-[-0.04em] text-foreground"
          >
            Choose the workflow to automate
          </h4>
          <p className="max-w-3xl text-[1.125rem] leading-8 tracking-[-0.02em] text-muted-foreground sm:text-[1.25rem]">
            Start from a ready-made playbook, then move into the setup details
            for the one you want to launch.
          </p>
        </div>

        <div className="grid gap-4">
          {AUTOMATION_RECIPES.map((recipe) => {
            const Icon = recipe.icon
            const isSelected =
              recipe.status === "available" && recipe.id === selectedRecipeId
            const isAvailable = recipe.status === "available"

            return (
              <button
                key={recipe.id}
                type="button"
                className={cn(
                  "group flex w-full items-start gap-4 rounded-[2rem] border border-border bg-card px-5 py-5 text-left shadow-[0_1px_2px_rgba(8,8,8,0.04)] transition-[border-color,background-color,box-shadow,transform] duration-200 hover:border-foreground/20 hover:bg-accent/40",
                  isSelected &&
                    "border-foreground bg-secondary/55 shadow-[0_16px_40px_rgba(8,8,8,0.08)]",
                  !isAvailable &&
                    "cursor-not-allowed opacity-72 hover:border-border hover:bg-card",
                )}
                disabled={!isAvailable}
                aria-pressed={isSelected}
                onClick={() => {
                  if (isAvailable) {
                    applyRecipe(recipe)
                  }
                }}
              >
                <span
                  className={cn(
                    "mt-1 inline-flex size-11 shrink-0 items-center justify-center text-foreground",
                    !isAvailable && "text-muted-foreground",
                  )}
                >
                  <Icon size={22} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <strong className="min-w-0 flex-1 text-[1.6rem] leading-[1.08] font-semibold tracking-[-0.035em] text-foreground">
                      {recipe.title}
                    </strong>
                    {!isAvailable ? (
                      <Badge variant="pending" className="shrink-0">
                        Coming soon
                      </Badge>
                    ) : null}
                  </div>
                  <p className="max-w-3xl text-[1.05rem] leading-7 tracking-[-0.015em] text-muted-foreground sm:text-[1.125rem]">
                    {recipe.description}
                  </p>
                </div>
                {isAvailable ? (
                  <ChevronRight
                    className="mt-1 size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5"
                    size={16}
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            )
          })}
        </div>
      </section>
    )
  }

  function renderConfigStep() {
    return (
      <section
        className="space-y-8 px-6 py-6 sm:px-8 sm:py-8"
        aria-labelledby="agents-config-title"
      >
        <div className="space-y-3">
          <h4
            id="agents-config-title"
            className="text-[clamp(2rem,4.5vw,3rem)] font-semibold leading-[1.02] tracking-[-0.04em] text-foreground"
          >
            Tune the rules
          </h4>
          <p className="max-w-3xl text-[1.125rem] leading-8 tracking-[-0.02em] text-muted-foreground sm:text-[1.25rem]">
            Shape how often the automation runs and how aggressively it
            refreshes existing output.
          </p>
        </div>

        {selectedRecipe ? (
          <>
            <div className="flex flex-wrap items-start gap-4 rounded-[2rem] border border-border bg-card px-5 py-5 shadow-[0_1px_2px_rgba(8,8,8,0.04)]">
              <span className="mt-1 inline-flex size-11 shrink-0 items-center justify-center text-foreground">
                {SelectedRecipeIcon ? (
                  <SelectedRecipeIcon size={22} aria-hidden="true" />
                ) : null}
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <strong className="block text-[1.45rem] leading-[1.08] font-semibold tracking-[-0.03em] text-foreground">
                  {selectedRecipe.title}
                </strong>
                <p className="text-[1rem] leading-7 tracking-[-0.015em] text-muted-foreground sm:text-[1.0625rem]">
                  {selectedRecipe.description}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-full px-3"
                onClick={() => setActiveStep(0)}
              >
                Change
              </Button>
            </div>

            <div className="space-y-8">
              <label className="block space-y-3">
                <span className="block text-[0.95rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Automation name
                </span>
                <Input
                  className="h-14 rounded-[1.5rem] text-[1.125rem]"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>

              <fieldset className="space-y-3">
                <legend className="text-[0.95rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Refresh behavior
                </legend>
                <SegmentedControl className="flex w-full flex-col sm:flex-row">
                  {REFRESH_OPTIONS.map((option) => {
                    const isSelected = refreshMode === option.value

                    return (
                      <SegmentedControlButton
                        key={option.value}
                        type="button"
                        active={isSelected}
                        aria-pressed={isSelected}
                        className="min-h-[5.5rem] flex-1 flex-col items-start gap-2 px-5 py-4 text-left"
                        onClick={() => setRefreshMode(option.value)}
                      >
                        <strong className="text-[1.1rem] leading-6 font-semibold tracking-[-0.02em]">
                          {option.label}
                        </strong>
                        <small className="block whitespace-normal text-[0.95rem] leading-6 text-muted-foreground">
                          {option.description}
                        </small>
                      </SegmentedControlButton>
                    )
                  })}
                </SegmentedControl>
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="text-[0.95rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Run cadence
                </legend>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {SCHEDULE_OPTIONS.map((option) => {
                    const isSelected = schedule.kind === option.value

                    return (
                      <Button
                        key={option.value}
                        type="button"
                        variant={isSelected ? "primary" : "outline"}
                        size="lg"
                        aria-pressed={isSelected}
                        className="h-auto min-h-[5.25rem] flex-col items-start gap-1 rounded-[1.5rem] px-5 py-4 text-left"
                        onClick={() => setSchedule(buildSchedule(option.value))}
                      >
                        <strong className="text-[1.05rem] leading-6 font-semibold tracking-[-0.02em]">
                          {option.label}
                        </strong>
                        <small
                          className={cn(
                            "text-[0.95rem] leading-6",
                            isSelected
                              ? "text-white/78"
                              : "text-muted-foreground",
                          )}
                        >
                          {option.detail}
                        </small>
                      </Button>
                    )
                  })}
                </div>
              </fieldset>

              {needsLanguages ? (
                <fieldset className="space-y-3">
                  <legend className="text-[0.95rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Target language
                  </legend>
                  <p className="text-[0.95rem] leading-6 text-muted-foreground">
                    Choose one language for the subtitle translation run.
                  </p>
                  {languageOptions.length === 0 ? (
                    <p className="text-[0.95rem] text-muted-foreground">
                      No languages loaded yet.
                    </p>
                  ) : (
                    <div
                      className="flex flex-wrap gap-3"
                      role="radiogroup"
                      aria-label="Target language"
                    >
                      {languageOptions.map((language) => {
                        const isSelected =
                          selectedLanguageId === language.coreId

                        return (
                          <Button
                            key={language.coreId}
                            type="button"
                            variant={isSelected ? "primary" : "outline"}
                            size="md"
                            aria-pressed={isSelected}
                            onClick={() =>
                              setTargetLanguageIds([language.coreId])
                            }
                          >
                            {language.name}
                          </Button>
                        )
                      })}
                    </div>
                  )}
                </fieldset>
              ) : null}

              <fieldset className="space-y-3">
                <legend className="text-[0.95rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Cap per run
                </legend>
                <p className="text-[0.95rem] leading-6 text-muted-foreground">
                  Keep each automation predictable by limiting how many videos
                  it can enqueue at once.
                </p>
                <div
                  className="flex items-center gap-3 rounded-[1.75rem] border border-border bg-secondary/30 p-3"
                  role="group"
                  aria-label="Videos per run"
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 rounded-[1.25rem]"
                    disabled={maxVideosPerRun <= 1}
                    onClick={() =>
                      setMaxVideosPerRun((current) => Math.max(1, current - 1))
                    }
                  >
                    <Minus size={16} aria-hidden="true" />
                  </Button>
                  <div className="flex-1 rounded-[1.5rem] border border-border bg-card px-5 py-4 text-center shadow-[0_1px_2px_rgba(8,8,8,0.04)]">
                    <strong className="block text-[2rem] leading-none font-semibold tracking-[-0.04em] text-foreground">
                      {maxVideosPerRun}
                    </strong>
                    <small className="mt-2 block text-[0.95rem] leading-5 text-muted-foreground">
                      videos per run
                    </small>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 rounded-[1.25rem]"
                    disabled={maxVideosPerRun >= 100}
                    onClick={() =>
                      setMaxVideosPerRun((current) =>
                        Math.min(100, current + 1),
                      )
                    }
                  >
                    <Plus size={16} aria-hidden="true" />
                  </Button>
                </div>
              </fieldset>
            </div>
          </>
        ) : (
          <div className="rounded-[2rem] border border-border bg-secondary/30 px-6 py-8 text-center">
            <Bot size={20} aria-hidden="true" />
            <strong className="mt-4 block text-[1.35rem] font-semibold tracking-[-0.03em] text-foreground">
              Select an automation to unlock cadence, scope, and launch
              settings.
            </strong>
            <p className="mx-auto mt-3 max-w-2xl text-[1rem] leading-7 text-muted-foreground">
              Live recipes can be launched today. Upcoming ones stay visible so
              the roadmap reads as one connected library.
            </p>
          </div>
        )}
      </section>
    )
  }

  function renderReviewStep() {
    return (
      <section
        className="space-y-8 px-6 py-6 sm:px-8 sm:py-8"
        aria-labelledby="agents-review-title"
      >
        <div className="space-y-3">
          <h4
            id="agents-review-title"
            className="text-[clamp(2rem,4.5vw,3rem)] font-semibold leading-[1.02] tracking-[-0.04em] text-foreground"
          >
            Review and launch
          </h4>
          <p className="max-w-3xl text-[1.125rem] leading-8 tracking-[-0.02em] text-muted-foreground sm:text-[1.25rem]">
            Check the setup, then create the automation when it looks right.
          </p>
        </div>

        {selectedRecipe ? (
          <div className="space-y-6">
            <div className="rounded-[2rem] border border-border bg-card px-6 py-6 shadow-[0_1px_2px_rgba(8,8,8,0.04)]">
              <Badge variant={isReadyToLaunch ? "success" : "pending"}>
                {isReadyToLaunch ? "Ready to launch" : "Needs attention"}
              </Badge>
              <strong className="mt-4 block text-[1.6rem] leading-[1.08] font-semibold tracking-[-0.035em] text-foreground">
                {selectedRecipe.title}
              </strong>
              <p className="mt-3 max-w-3xl text-[1.05rem] leading-7 tracking-[-0.015em] text-muted-foreground sm:text-[1.125rem]">
                {selectedRecipe.description}
              </p>
            </div>

            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-[0.9rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Automation
                </dt>
                <dd className="mt-2 text-[1.1rem] font-medium tracking-[-0.02em] text-foreground">
                  {AUTOMATION_TEMPLATE_LABELS[template]}
                </dd>
              </div>
              <div>
                <dt className="text-[0.9rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Refresh
                </dt>
                <dd className="mt-2 text-[1.1rem] font-medium tracking-[-0.02em] text-foreground">
                  {AUTOMATION_REFRESH_MODE_LABELS[refreshMode]}
                </dd>
              </div>
              <div>
                <dt className="text-[0.9rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Cadence
                </dt>
                <dd className="mt-2 text-[1.1rem] font-medium tracking-[-0.02em] text-foreground">
                  {getScheduleLabel(schedule.kind)}
                </dd>
              </div>
              <div>
                <dt className="text-[0.9rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Cap
                </dt>
                <dd className="mt-2 text-[1.1rem] font-medium tracking-[-0.02em] text-foreground">
                  {maxVideosPerRun} videos
                </dd>
              </div>
              {needsLanguages ? (
                <div>
                  <dt className="text-[0.9rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Target language
                  </dt>
                  <dd className="mt-2 text-[1.1rem] font-medium tracking-[-0.02em] text-foreground">
                    {selectedLanguageName ?? "Choose one language"}
                  </dd>
                </div>
              ) : (
                <div>
                  <dt className="text-[0.9rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Scope
                  </dt>
                  <dd className="mt-2 text-[1.1rem] font-medium tracking-[-0.02em] text-foreground">
                    All eligible videos
                  </dd>
                </div>
              )}
            </dl>

            {error ? (
              <span className="inline-flex rounded-full border border-[rgba(239,51,64,0.24)] bg-[rgba(239,51,64,0.08)] px-4 py-2 text-[14px] font-medium text-[var(--ds-brand-red)]">
                {error}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="rounded-[2rem] border border-border bg-secondary/30 px-6 py-8 text-center">
            <strong className="block text-[1.35rem] font-semibold tracking-[-0.03em] text-foreground">
              No automation selected yet.
            </strong>
            <p className="mx-auto mt-3 max-w-2xl text-[1rem] leading-7 text-muted-foreground">
              Choose a live recipe to preview the automation that will be
              created.
            </p>
          </div>
        )}
      </section>
    )
  }

  return (
    <form className="space-y-0" onSubmit={handleSubmit}>
      <Stepper
        value={activeStep + 1}
        onValueChange={(value) => {
          const stepIndex = value - 1
          if (canNavigateToStep(stepIndex)) {
            setActiveStep(stepIndex)
          }
        }}
        className="space-y-2"
      >
        <StepperNav
          className="grid grid-cols-3 gap-3 px-6 pt-6 sm:px-8 sm:pt-8 md:gap-5"
          aria-label="Automation setup progress"
        >
          {stepItems.map((step, index) => (
            <StepperItem
              key={step.label}
              step={index + 1}
              completed={getStepStatus(index) === "complete"}
              disabled={!canNavigateToStep(index)}
              className="min-w-0"
            >
              <StepperTrigger
                className="flex w-full flex-col items-start gap-3"
                aria-label={`${step.label}. ${step.hint}`}
              >
                <StepperIndicator className="h-1 w-full rounded-full border-0 bg-border data-[state=completed]:bg-foreground data-[state=active]:bg-foreground" />
                <StepperTitle className="w-full text-left text-[clamp(1rem,2.9vw,1.55rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-foreground group-data-[state=inactive]/step:text-muted-foreground">
                  <span className="hidden sm:inline">{step.label}</span>
                  <span className="sm:hidden">{step.shortLabel}</span>
                </StepperTitle>
              </StepperTrigger>
            </StepperItem>
          ))}
        </StepperNav>

        <StepperPanel data-step={activeStep + 1}>
          <StepperContent value={1}>{renderRecipeStep()}</StepperContent>
          <StepperContent value={2}>{renderConfigStep()}</StepperContent>
          <StepperContent value={3}>{renderReviewStep()}</StepperContent>
        </StepperPanel>
      </Stepper>

      <div className="flex flex-col gap-5 border-t border-border/70 px-6 py-6 sm:px-8">
        <p className="text-[0.95rem] leading-6 text-muted-foreground">
          {activeStep === 0
            ? "Choose a live automation to continue."
            : activeStep === 1
              ? "Tune the setup, then move to launch review."
              : "Everything is staged. Create the automation when ready."}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {onCancel ? (
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={onCancel}
              >
                <X className="size-4" aria-hidden="true" />
                Cancel
              </Button>
            ) : null}
            {activeStep > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() =>
                  setActiveStep((current) => Math.max(0, current - 1))
                }
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                Back
              </Button>
            ) : null}
          </div>
          {activeStep < 2 ? (
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="ml-auto"
              disabled={
                activeStep === 0
                  ? !selectedRecipe
                  : !selectedRecipe || !isReadyToLaunch
              }
              onClick={handleNextStep}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
              {activeStep === 0 ? "Continue to rules" : "Review launch"}
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="ml-auto"
              disabled={!isReadyToLaunch || isSubmitting}
            >
              {isSubmitting ? (
                <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Rocket className="size-4" aria-hidden="true" />
              )}
              {isSubmitting ? "Creating..." : "Create automation"}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
