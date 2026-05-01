"use client"

import { useMemo, useState, type CSSProperties, type FormEvent } from "react"
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
import {
  AUTOMATION_REFRESH_MODE_LABELS,
  AUTOMATION_RUN_MODE_LABELS,
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

const RUN_MODE_OPTIONS: Array<{
  description: string
  label: string
  value: AutomationDraft["runMode"]
}> = [
  {
    value: "live",
    label: "Live",
    description: "Create real enrichment jobs when the automation runs.",
  },
  {
    value: "dry_run",
    label: "Dry run",
    description: "Prepare a report without enqueueing enrichment work.",
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
  const [runMode, setRunMode] = useState<AutomationDraft["runMode"]>("live")
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
        runMode,
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
    setRunMode("live")
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
        className="agents-recipe-stage agents-slide-stage"
        aria-labelledby="agents-recipe-title"
      >
        <div className="agents-stage-heading">
          <div>
            <h4 id="agents-recipe-title">Choose the workflow to automate</h4>
            <p>
              Start from a ready-made playbook, then move into the setup details
              for the one you want to launch.
            </p>
          </div>
        </div>

        <div className="agents-recipe-grid">
          {AUTOMATION_RECIPES.map((recipe) => {
            const Icon = recipe.icon
            const isSelected =
              recipe.status === "available" && recipe.id === selectedRecipeId
            const isAvailable = recipe.status === "available"

            return (
              <button
                key={recipe.id}
                type="button"
                className={`agents-recipe-card${isSelected ? " is-selected" : ""}${
                  isAvailable ? "" : " is-disabled"
                }`}
                disabled={!isAvailable}
                aria-pressed={isSelected}
                onClick={() => {
                  if (isAvailable) {
                    applyRecipe(recipe)
                  }
                }}
              >
                <span className={`agents-recipe-icon is-${recipe.tone}`}>
                  <Icon size={18} aria-hidden="true" />
                </span>
                <div className="agents-recipe-copy">
                  <div className="agents-recipe-title-row">
                    <strong>{recipe.title}</strong>
                    {!isAvailable ? (
                      <span className="badge pending">Coming soon</span>
                    ) : null}
                  </div>
                  <p>{recipe.description}</p>
                </div>
                {isAvailable ? (
                  <ChevronRight
                    className="agents-recipe-chevron"
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
        className="agents-config-panel agents-slide-stage"
        aria-labelledby="agents-config-title"
      >
        <div className="agents-stage-heading">
          <div>
            <h4 id="agents-config-title">Tune the rules</h4>
            <p>
              Shape how often the automation runs and how aggressively it
              refreshes existing output.
            </p>
          </div>
        </div>

        {selectedRecipe ? (
          <>
            <div className="agents-selected-recipe">
              <span className={`agents-recipe-icon is-${selectedRecipe.tone}`}>
                {SelectedRecipeIcon ? (
                  <SelectedRecipeIcon size={18} aria-hidden="true" />
                ) : null}
              </span>
              <div className="agents-selected-recipe-copy">
                <strong>{selectedRecipe.title}</strong>
                <p>{selectedRecipe.description}</p>
              </div>
              <button
                type="button"
                className="agents-inline-link"
                onClick={() => setActiveStep(0)}
              >
                Change
              </button>
            </div>

            <div className="agents-config-grid">
              <label className="jobs-field agents-config-name">
                <span className="jobs-field-label">Automation name</span>
                <input
                  className="jobs-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>

              <fieldset className="agents-choice-group agents-choice-group--switch">
                <legend>Refresh behavior</legend>
                <div className="agents-choice-pills agents-choice-pills--switch">
                  {REFRESH_OPTIONS.map((option) => {
                    const isSelected = refreshMode === option.value

                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`agents-choice-pill agents-choice-pill--switch${isSelected ? " is-selected" : ""}`}
                        aria-pressed={isSelected}
                        onClick={() => setRefreshMode(option.value)}
                      >
                        <strong>{option.label}</strong>
                        <small>{option.description}</small>
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              <fieldset className="agents-choice-group agents-choice-group--switch">
                <legend>Run mode</legend>
                <div className="agents-choice-pills agents-choice-pills--switch">
                  {RUN_MODE_OPTIONS.map((option) => {
                    const isSelected = runMode === option.value

                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`agents-choice-pill agents-choice-pill--switch${isSelected ? " is-selected" : ""}`}
                        aria-pressed={isSelected}
                        onClick={() => setRunMode(option.value)}
                      >
                        <strong>{option.label}</strong>
                        <small>{option.description}</small>
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              <fieldset className="agents-choice-group agents-choice-group--switch">
                <legend>Run cadence</legend>
                <div className="agents-choice-pills agents-choice-pills--switch">
                  {SCHEDULE_OPTIONS.map((option) => {
                    const isSelected = schedule.kind === option.value

                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`agents-choice-pill agents-choice-pill--switch is-compact${isSelected ? " is-selected" : ""}`}
                        aria-pressed={isSelected}
                        onClick={() => setSchedule(buildSchedule(option.value))}
                      >
                        <strong>{option.label}</strong>
                        <small>{option.detail}</small>
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              {needsLanguages ? (
                <fieldset className="agents-choice-group agents-language-group">
                  <legend>Target language</legend>
                  <p className="agents-field-hint">
                    Choose one language for the subtitle translation run.
                  </p>
                  {languageOptions.length === 0 ? (
                    <p className="small">No languages loaded yet.</p>
                  ) : (
                    <div
                      className="agents-language-pills"
                      role="radiogroup"
                      aria-label="Target language"
                    >
                      {languageOptions.map((language) => {
                        const isSelected =
                          selectedLanguageId === language.coreId

                        return (
                          <button
                            key={language.coreId}
                            type="button"
                            className={`agents-language-pill${isSelected ? " is-selected" : ""}`}
                            aria-pressed={isSelected}
                            onClick={() =>
                              setTargetLanguageIds([language.coreId])
                            }
                          >
                            {language.name}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </fieldset>
              ) : null}

              <fieldset className="agents-choice-group agents-cap-group">
                <legend>Cap per run</legend>
                <p className="agents-field-hint">
                  Keep each automation predictable by limiting how many videos
                  it can enqueue at once.
                </p>
                <div
                  className="agents-cap-stepper"
                  role="group"
                  aria-label="Videos per run"
                >
                  <button
                    type="button"
                    className="agents-cap-button"
                    disabled={maxVideosPerRun <= 1}
                    onClick={() =>
                      setMaxVideosPerRun((current) => Math.max(1, current - 1))
                    }
                  >
                    <Minus size={16} aria-hidden="true" />
                  </button>
                  <div className="agents-cap-value">
                    <strong>{maxVideosPerRun}</strong>
                    <small>videos per run</small>
                  </div>
                  <button
                    type="button"
                    className="agents-cap-button"
                    disabled={maxVideosPerRun >= 100}
                    onClick={() =>
                      setMaxVideosPerRun((current) =>
                        Math.min(100, current + 1),
                      )
                    }
                  >
                    <Plus size={16} aria-hidden="true" />
                  </button>
                </div>
              </fieldset>
            </div>
          </>
        ) : (
          <div className="agents-config-empty">
            <Bot size={20} aria-hidden="true" />
            <strong>
              Select an automation to unlock cadence, scope, and launch
              settings.
            </strong>
            <p>
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
        className="agents-review-panel agents-slide-stage"
        aria-labelledby="agents-review-title"
      >
        <div className="agents-stage-heading">
          <div>
            <h4 id="agents-review-title">Review and launch</h4>
            <p>
              Check the setup, then create the automation when it looks right.
            </p>
          </div>
        </div>

        {selectedRecipe ? (
          <div className="agents-review-stack">
            <div className="agents-review-hero">
              <span
                className={`badge ${isReadyToLaunch ? "success" : "pending"}`}
              >
                {isReadyToLaunch ? "Ready to launch" : "Needs attention"}
              </span>
              <strong>{selectedRecipe.title}</strong>
              <p>{selectedRecipe.description}</p>
            </div>

            <dl className="agents-review-list">
              <div>
                <dt>Automation</dt>
                <dd>{AUTOMATION_TEMPLATE_LABELS[template]}</dd>
              </div>
              <div>
                <dt>Refresh</dt>
                <dd>{AUTOMATION_REFRESH_MODE_LABELS[refreshMode]}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{AUTOMATION_RUN_MODE_LABELS[runMode]}</dd>
              </div>
              <div>
                <dt>Cadence</dt>
                <dd>{getScheduleLabel(schedule.kind)}</dd>
              </div>
              <div>
                <dt>Cap</dt>
                <dd>{maxVideosPerRun} videos</dd>
              </div>
              {needsLanguages ? (
                <div>
                  <dt>Target language</dt>
                  <dd>{selectedLanguageName ?? "Choose one language"}</dd>
                </div>
              ) : (
                <div>
                  <dt>Scope</dt>
                  <dd>All eligible videos</dd>
                </div>
              )}
            </dl>

            {error ? <span className="jobs-status-error">{error}</span> : null}
          </div>
        ) : (
          <div className="agents-review-placeholder">
            <strong>No automation selected yet.</strong>
            <p>
              Choose a live recipe to preview the automation that will be
              created.
            </p>
          </div>
        )}
      </section>
    )
  }

  return (
    <form className="agents-form agents-wizard-form" onSubmit={handleSubmit}>
      <Stepper
        value={activeStep + 1}
        onValueChange={(value) => {
          const stepIndex = value - 1
          if (canNavigateToStep(stepIndex)) {
            setActiveStep(stepIndex)
          }
        }}
        className="agents-wizard-stepper"
      >
        <StepperNav
          className="agents-wizard-stepper-nav"
          aria-label="Automation setup progress"
          style={{ "--stepper-columns": stepItems.length } as CSSProperties}
        >
          {stepItems.map((step, index) => (
            <StepperItem
              key={step.label}
              step={index + 1}
              completed={getStepStatus(index) === "complete"}
              disabled={!canNavigateToStep(index)}
              className="agents-wizard-stepper-item"
            >
              <StepperTrigger
                className="agents-wizard-stepper-trigger"
                aria-label={`${step.label}. ${step.hint}`}
              >
                <StepperIndicator className="agents-wizard-stepper-indicator" />
                <StepperTitle className="agents-wizard-stepper-title">
                  <span className="agents-wizard-step-label agents-wizard-step-label--full">
                    {step.label}
                  </span>
                  <span className="agents-wizard-step-label agents-wizard-step-label--short">
                    {step.shortLabel}
                  </span>
                </StepperTitle>
              </StepperTrigger>
            </StepperItem>
          ))}
        </StepperNav>

        <StepperPanel
          className="agents-wizard-slide"
          data-step={activeStep + 1}
        >
          <StepperContent value={1}>{renderRecipeStep()}</StepperContent>
          <StepperContent value={2}>{renderConfigStep()}</StepperContent>
          <StepperContent value={3}>{renderReviewStep()}</StepperContent>
        </StepperPanel>
      </Stepper>

      <div className="jobs-actions agents-form-footer">
        <p className="agents-form-footer-note">
          {activeStep === 0
            ? "Choose a live automation to continue."
            : activeStep === 1
              ? "Tune the setup, then move to launch review."
              : "Everything is staged. Create the automation when ready."}
        </p>
        <div className="agents-form-footer-actions">
          {onCancel ? (
            <button
              type="button"
              className="jobs-primary-button agents-secondary-button"
              onClick={onCancel}
            >
              <X className="icon" aria-hidden="true" />
              Cancel
            </button>
          ) : null}
          {activeStep > 0 ? (
            <button
              type="button"
              className="jobs-primary-button agents-secondary-button"
              onClick={() =>
                setActiveStep((current) => Math.max(0, current - 1))
              }
            >
              <ChevronLeft className="icon" aria-hidden="true" />
              Back
            </button>
          ) : null}
          {activeStep < 2 ? (
            <button
              type="button"
              className="jobs-primary-button agents-primary-advance"
              disabled={
                activeStep === 0
                  ? !selectedRecipe
                  : !selectedRecipe || !isReadyToLaunch
              }
              onClick={handleNextStep}
            >
              <ChevronRight className="icon" aria-hidden="true" />
              {activeStep === 0 ? "Continue to rules" : "Review launch"}
            </button>
          ) : (
            <button
              type="submit"
              className="jobs-primary-button agents-primary-advance"
              disabled={!isReadyToLaunch || isSubmitting}
            >
              {isSubmitting ? (
                <RefreshCw className="icon is-spinning" aria-hidden="true" />
              ) : (
                <Rocket className="icon" aria-hidden="true" />
              )}
              {isSubmitting ? "Creating..." : "Create automation"}
            </button>
          )}
        </div>
      </div>
    </form>
  )
}
