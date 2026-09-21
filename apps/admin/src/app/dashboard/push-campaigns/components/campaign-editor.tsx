"use client"

/**
 * R6 to R8 — the campaign's words, destination, and audience in one form.
 *
 * Every cap is checked here before submit, because the service refuses the
 * whole save for one long row and the editor should not have to guess which.
 */
import { Plus, Trash2 } from "lucide-react"
import { useActionState, useMemo, useState } from "react"

import { PrimaryButton, SecondaryButton, cx } from "@/components/admin-ui"
import {
  PUSH_COPY_BODY_MAX_CHARS,
  PUSH_COPY_TITLE_MAX_CHARS,
} from "@/services/push/contracts"
import type {
  PushCampaignDetail,
  PushLanguageOption,
} from "@/services/push/dashboard.service"
import { PUSH_ENGLISH_LANGUAGE_SLUG } from "@/services/push/language-resolution"

import { saveCampaignAction } from "../actions"
import { ActionFeedback } from "./action-feedback"
import { PUSH_ACTION_IDLE } from "./action-state"
import { normalizePushCountryInput, pushCopyFieldError } from "./campaign-view"
import { DestinationPicker, type DestinationValue } from "./destination-picker"

type CopyRow = { languageSlug: string; title: string; body: string }

function initialCopies(campaign: PushCampaignDetail): CopyRow[] {
  const rows = campaign.copies.map((copy) => ({ ...copy }))
  if (rows.some((row) => row.languageSlug === PUSH_ENGLISH_LANGUAGE_SLUG)) {
    return rows
  }
  // R6 — English is required, so the editor always opens on an English row.
  return [
    { languageSlug: PUSH_ENGLISH_LANGUAGE_SLUG, title: "", body: "" },
    ...rows,
  ]
}

function FieldError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <span
      data-testid="push-copy-error"
      className="text-[11px] leading-4 text-[var(--color-danger)]"
    >
      {message}
    </span>
  )
}

export function CampaignEditor({
  campaign,
  languageOptions,
  destinationTitle,
}: {
  campaign: PushCampaignDetail
  languageOptions: readonly PushLanguageOption[]
  destinationTitle: string | null
}) {
  const [state, formAction, pending] = useActionState(
    saveCampaignAction,
    PUSH_ACTION_IDLE,
  )
  const [copies, setCopies] = useState<CopyRow[]>(() => initialCopies(campaign))
  const [addLanguage, setAddLanguage] = useState("")
  const [destination, setDestination] = useState<DestinationValue | null>(
    campaign.destinationKind && campaign.destinationSlug
      ? {
          kind: campaign.destinationKind as DestinationValue["kind"],
          slug: campaign.destinationSlug,
        }
      : null,
  )
  const [byCountry, setByCountry] = useState(
    campaign.audienceScope === "COUNTRIES",
  )
  const [countries, setCountries] = useState<string[]>([...campaign.countries])
  const [countryDraft, setCountryDraft] = useState("")
  const [countryError, setCountryError] = useState<string | null>(null)
  const [languageFilter, setLanguageFilter] = useState<string[]>([
    ...campaign.languageFilter,
  ])

  const labelBySlug = useMemo(
    () => new Map(languageOptions.map((option) => [option.slug, option.label])),
    [languageOptions],
  )

  const rowErrors = copies.map((row) => ({
    title: pushCopyFieldError("title", row.title),
    body: pushCopyFieldError("body", row.body),
  }))
  const blocked =
    rowErrors.some((row) => row.title !== null || row.body !== null) ||
    (byCountry && countries.length === 0)

  const available = languageOptions.filter(
    (option) => !copies.some((row) => row.languageSlug === option.slug),
  )

  function updateCopy(index: number, patch: Partial<CopyRow>) {
    setCopies((rows) =>
      rows.map((row, position) =>
        position === index ? { ...row, ...patch } : row,
      ),
    )
  }

  function removeCopy(index: number) {
    setCopies((rows) => rows.filter((_, position) => position !== index))
  }

  function addCopy() {
    if (!addLanguage) return
    setCopies((rows) => [
      ...rows,
      { languageSlug: addLanguage, title: "", body: "" },
    ])
    setAddLanguage("")
  }

  function addCountry() {
    const result = normalizePushCountryInput(countryDraft, countries)
    if ("error" in result) {
      setCountryError(result.error)
      return
    }
    setCountries((current) => [...current, result.country])
    setCountryDraft("")
    setCountryError(null)
  }

  function toggleLanguageFilter(slug: string) {
    setLanguageFilter((current) =>
      current.includes(slug)
        ? current.filter((entry) => entry !== slug)
        : [...current, slug],
    )
  }

  return (
    <form action={formAction} className="grid gap-6 p-4">
      <input type="hidden" name="campaignId" value={campaign.id} />

      <fieldset className="grid gap-3">
        <legend className="text-[13px] font-semibold">
          Copy, one row per language
        </legend>
        <p className="text-[12px] leading-5 text-[var(--color-text-muted)]">
          English is required. A phone receives the first of these it has: the
          app language, the phone language, English. Titles cap at{" "}
          {PUSH_COPY_TITLE_MAX_CHARS} characters and bodies at{" "}
          {PUSH_COPY_BODY_MAX_CHARS}.
        </p>

        {copies.map((row, index) => {
          const english = row.languageSlug === PUSH_ENGLISH_LANGUAGE_SLUG
          const errors = rowErrors[index]
          return (
            <div
              key={row.languageSlug}
              data-testid="push-copy-row"
              data-language={row.languageSlug}
              className="grid gap-2 rounded-sm border border-[var(--color-hairline)] p-3"
            >
              <input
                type="hidden"
                name="copyLanguage"
                value={row.languageSlug}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium">
                  {labelBySlug.get(row.languageSlug) ?? row.languageSlug}
                  {english ? " (required)" : null}
                </span>
                {english ? null : (
                  <button
                    type="button"
                    data-testid="push-copy-remove"
                    data-language={row.languageSlug}
                    onClick={() => removeCopy(index)}
                    aria-label={`Remove the ${row.languageSlug} copy row`}
                    className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-sm border border-[var(--color-hairline)] px-2 text-[12px] text-[var(--color-text-muted)] hover:border-[var(--color-danger-border)] hover:text-[var(--color-danger)]"
                  >
                    <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                    Remove
                  </button>
                )}
              </div>

              <label className="grid gap-1">
                <span className="label-text">Title</span>
                <input
                  name="copyTitle"
                  value={row.title}
                  data-testid="push-copy-title"
                  onChange={(event) =>
                    updateCopy(index, { title: event.target.value })
                  }
                  className={cx(
                    "h-9 rounded-sm border bg-[var(--color-surface-raised)] px-3 text-[13px] outline-none",
                    errors?.title
                      ? "border-[var(--color-danger-border)]"
                      : "border-[var(--color-hairline)]",
                  )}
                />
                <FieldError message={errors?.title ?? null} />
              </label>

              <label className="grid gap-1">
                <span className="label-text">Body</span>
                <textarea
                  name="copyBody"
                  value={row.body}
                  rows={2}
                  data-testid="push-copy-body"
                  onChange={(event) =>
                    updateCopy(index, { body: event.target.value })
                  }
                  className={cx(
                    "rounded-sm border bg-[var(--color-surface-raised)] px-3 py-2 text-[13px] outline-none",
                    errors?.body
                      ? "border-[var(--color-danger-border)]"
                      : "border-[var(--color-hairline)]",
                  )}
                />
                <FieldError message={errors?.body ?? null} />
              </label>
            </div>
          )
        })}

        <div className="flex flex-wrap items-center gap-2">
          <label className="grid gap-1">
            <span className="sr-only">Add a language</span>
            <select
              value={addLanguage}
              data-testid="push-add-language"
              onChange={(event) => setAddLanguage(event.target.value)}
              className="h-8 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-2 text-[13px]"
            >
              <option value="">Add a language...</option>
              {available.map((option) => (
                <option key={option.slug} value={option.slug}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <SecondaryButton
            type="button"
            data-testid="push-add-language-submit"
            onClick={addCopy}
            disabled={!addLanguage}
          >
            <Plus className="h-3 w-3" strokeWidth={1.5} />
            Add row
          </SecondaryButton>
        </div>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="text-[13px] font-semibold">Destination</legend>
        <DestinationPicker
          value={destination}
          title={destinationTitle}
          onChange={setDestination}
        />
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="text-[13px] font-semibold">Audience</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="radio"
              name="audienceScope"
              value="EVERYWHERE"
              data-testid="push-audience-everywhere"
              checked={!byCountry}
              onChange={() => setByCountry(false)}
            />
            Everywhere
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="radio"
              name="audienceScope"
              value="COUNTRIES"
              data-testid="push-audience-countries"
              checked={byCountry}
              onChange={() => setByCountry(true)}
            />
            Chosen countries
          </label>
        </div>

        {byCountry ? (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={countryDraft}
                maxLength={2}
                data-testid="push-country-input"
                placeholder="SA"
                onChange={(event) => setCountryDraft(event.target.value)}
                className="h-8 w-20 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-2 text-[13px] uppercase"
              />
              <SecondaryButton
                type="button"
                data-testid="push-country-add"
                onClick={addCountry}
              >
                Add country
              </SecondaryButton>
            </div>
            {countryError ? (
              <span
                data-testid="push-country-error"
                className="text-[11px] text-[var(--color-danger)]"
              >
                {countryError}
              </span>
            ) : null}
            {countries.length === 0 ? (
              <span className="text-[11px] text-[var(--color-danger)]">
                Name at least one country, or choose everywhere.
              </span>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {countries.map((country) => (
                  <li key={country}>
                    <input type="hidden" name="country" value={country} />
                    <button
                      type="button"
                      data-testid="push-country-chip"
                      onClick={() =>
                        setCountries((current) =>
                          current.filter((entry) => entry !== country),
                        )
                      }
                      aria-label={`Remove ${country}`}
                      className="mono-meta inline-flex h-7 cursor-pointer items-center gap-1 rounded-sm border border-[var(--color-hairline)] px-2 hover:border-[var(--color-danger-border)] hover:text-[var(--color-danger)]"
                    >
                      {country}
                      <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <details className="rounded-sm border border-[var(--color-hairline)] px-3 py-2">
          <summary className="cursor-pointer text-[12px] text-[var(--color-text-secondary)]">
            Language filter ({languageFilter.length} chosen) — optional
          </summary>
          <p className="mt-2 text-[12px] leading-5 text-[var(--color-text-muted)]">
            A filter narrows the audience to phones whose app language or phone
            language is on this list. It does not decide which copy a phone
            receives.
          </p>
          <div className="mt-2 grid max-h-48 gap-1 overflow-y-auto">
            {languageOptions.map((option) => (
              <label
                key={option.slug}
                className="flex items-center gap-2 text-[12px]"
              >
                <input
                  type="checkbox"
                  name="languageFilter"
                  value={option.slug}
                  data-testid="push-language-filter"
                  checked={languageFilter.includes(option.slug)}
                  onChange={() => toggleLanguageFilter(option.slug)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </details>
      </fieldset>

      <ActionFeedback state={state} />

      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton type="submit" disabled={pending || blocked}>
          {pending ? "Saving..." : "Save campaign"}
        </PrimaryButton>
        {blocked ? (
          <span
            data-testid="push-save-blocked"
            className="text-[12px] text-[var(--color-text-muted)]"
          >
            Fix the fields marked above before you save.
          </span>
        ) : null}
      </div>
    </form>
  )
}
