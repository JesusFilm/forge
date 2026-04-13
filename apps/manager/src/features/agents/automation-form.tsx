"use client"

import { useMemo, useState, type FormEvent } from "react"
import {
  AUTOMATION_REFRESH_MODE_LABELS,
  AUTOMATION_TEMPLATE_LABELS,
  CREATABLE_AUTOMATION_TEMPLATES,
  templateRequiresTargetLanguages,
  type AutomationDraft,
  type AutomationSchedule,
  type AutomationTemplate,
} from "./automation-contract"

export type LanguageOption = {
  coreId: string
  name: string
}

function buildSchedule(kind: string): AutomationSchedule {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  if (kind === "hourly") return { kind: "hourly", minute: 0, timezone }
  if (kind === "daily") return { kind: "daily", hour: 9, minute: 0, timezone }
  if (kind === "weekly") {
    return { kind: "weekly", weekday: "mon", hour: 9, minute: 0, timezone }
  }
  return { kind: "every_minute", timezone }
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
  const [name, setName] = useState("Missing metadata")
  const [template, setTemplate] =
    useState<AutomationTemplate>("metadata_missing")
  const [refreshMode, setRefreshMode] =
    useState<AutomationDraft["refreshMode"]>("missing_only")
  const [schedule, setSchedule] = useState<AutomationSchedule>(() =>
    buildSchedule("every_minute"),
  )
  const [targetLanguageIds, setTargetLanguageIds] = useState<string[]>([])
  const [maxVideosPerRun, setMaxVideosPerRun] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needsLanguages = templateRequiresTargetLanguages(template)
  const hasRequiredLanguageSelection =
    !needsLanguages || targetLanguageIds.length === 1
  const canSubmit = useMemo(
    () => name.trim().length > 0 && hasRequiredLanguageSelection,
    [name, hasRequiredLanguageSelection],
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
      setName(`Missing ${AUTOMATION_TEMPLATE_LABELS[template].toLowerCase()}`)
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

  return (
    <form className="agents-form" onSubmit={handleSubmit}>
      <div className="agents-form-grid">
        <label className="jobs-field">
          <span className="jobs-field-label">Name</span>
          <input
            className="jobs-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="jobs-field">
          <span className="jobs-field-label">Template</span>
          <select
            className="jobs-input"
            value={template}
            onChange={(event) =>
              setTemplate(event.target.value as AutomationTemplate)
            }
          >
            {CREATABLE_AUTOMATION_TEMPLATES.map((value) => (
              <option key={value} value={value}>
                {AUTOMATION_TEMPLATE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="jobs-field">
          <span className="jobs-field-label">Refresh</span>
          <select
            className="jobs-input"
            value={refreshMode}
            onChange={(event) =>
              setRefreshMode(
                event.target.value as AutomationDraft["refreshMode"],
              )
            }
          >
            {Object.entries(AUTOMATION_REFRESH_MODE_LABELS).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="jobs-field">
          <span className="jobs-field-label">Schedule</span>
          <select
            className="jobs-input"
            value={schedule.kind}
            onChange={(event) => setSchedule(buildSchedule(event.target.value))}
          >
            <option value="every_minute">Every minute</option>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily at 9:00 AM</option>
            <option value="weekly">Weekly Monday at 9:00 AM</option>
          </select>
        </label>
        <label className="jobs-field">
          <span className="jobs-field-label">Cap</span>
          <input
            className="jobs-input"
            type="number"
            min={1}
            max={100}
            value={maxVideosPerRun}
            onChange={(event) =>
              setMaxVideosPerRun(Math.max(1, Number(event.target.value) || 1))
            }
          />
        </label>
      </div>
      {needsLanguages && (
        <fieldset className="agents-language-fieldset">
          <legend>Target languages</legend>
          <p className="small agents-field-hint">
            Choose one target language for subtitle automations.
          </p>
          {languageOptions.length === 0 ? (
            <p className="small">No languages loaded yet.</p>
          ) : (
            <div className="agents-language-options">
              {languageOptions.map((language) => {
                const checked = targetLanguageIds.includes(language.coreId)
                const disabled = !checked && targetLanguageIds.length >= 1
                return (
                  <label key={language.coreId} className="jobs-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={(event) => {
                        setTargetLanguageIds((current) =>
                          event.target.checked
                            ? [...current, language.coreId]
                            : current.filter((id) => id !== language.coreId),
                        )
                      }}
                    />
                    {language.name}
                  </label>
                )
              })}
            </div>
          )}
        </fieldset>
      )}
      <div className="jobs-actions">
        {onCancel && (
          <button
            type="button"
            className="jobs-primary-button agents-secondary-button"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          className="jobs-primary-button"
          disabled={!canSubmit || isSubmitting}
        >
          {isSubmitting ? "Creating..." : "New automation"}
        </button>
        {error && <span className="jobs-status-error">{error}</span>}
      </div>
    </form>
  )
}
