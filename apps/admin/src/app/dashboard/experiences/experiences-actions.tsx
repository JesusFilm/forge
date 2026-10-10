"use client"

import { useState } from "react"
import { Filter, Plus, X } from "lucide-react"
import { PrimaryButton, SecondaryButton } from "@/components/admin-ui"

function SubmitButton({ label }: { label: string }) {
  return <PrimaryButton type="submit">{label}</PrimaryButton>
}

function slugFromTitle(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
}

export function ExperiencesActions({
  labels,
  canCreate,
  createAction,
}: {
  labels: {
    filter: string
    filterUnavailable: string
    primary: string
    modalTitle: string
    modalDescription: string
    titleLabel: string
    localeLabel: string
    slugLabel: string
    routeTemplateLabel: string
    routeTemplateHelp: string
    cancel: string
    submit: string
    localeHelp: string
    noPermission: string
    createFailed: string
  }
  canCreate: boolean
  createAction: (
    formData: FormData,
  ) => Promise<{ ok: boolean; error?: "forbidden" | "unknown" }>
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [slug, setSlug] = useState("")
  const [error, setError] = useState("")

  return (
    <>
      <div className="flex items-center gap-3">
        <SecondaryButton
          disabled
          title={labels.filterUnavailable}
          aria-describedby="experience-filter-unavailable"
        >
          <Filter className="h-4 w-4" strokeWidth={1.5} />
          {labels.filter}
        </SecondaryButton>
        <PrimaryButton
          type="button"
          disabled={!canCreate}
          title={canCreate ? undefined : labels.noPermission}
          onClick={() => {
            setError("")
            setOpen(true)
          }}
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          {labels.primary}
        </PrimaryButton>
      </div>
      <p
        id="experience-filter-unavailable"
        className="text-[12px] text-[var(--color-text-muted)]"
      >
        {labels.filterUnavailable}
      </p>
      {!canCreate ? (
        <p className="text-[12px] text-[var(--color-text-muted)]">
          {labels.noPermission}
        </p>
      ) : null}
      {error ? (
        <p className="text-[12px] text-[var(--color-danger)]">{error}</p>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6">
          <div className="w-full max-w-lg rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
            <div className="hairline-strong-b flex items-center justify-between px-4 py-3">
              <div>
                <h2 className="text-[14px] font-semibold">
                  {labels.modalTitle}
                </h2>
                <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                  {labels.modalDescription}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="cursor-pointer rounded-sm border border-[var(--color-hairline)] p-1.5 text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                aria-label={labels.cancel}
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
            <form
              action={async (formData) => {
                setError("")
                const result = await createAction(formData)
                if (result.ok) {
                  setOpen(false)
                  return
                }

                setError(
                  result.error === "forbidden"
                    ? labels.noPermission
                    : labels.createFailed,
                )
              }}
              className="grid gap-4 p-4"
            >
              <label className="grid gap-1.5">
                <span className="label-text">{labels.titleLabel}</span>
                <input
                  name="title"
                  value={title}
                  onChange={(event) => {
                    const nextTitle = event.target.value
                    setTitle(nextTitle)
                    if (!slug || slug === slugFromTitle(title)) {
                      setSlug(slugFromTitle(nextTitle))
                    }
                  }}
                  required
                  className="h-9 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-3 text-[13px] outline-none transition-all duration-[120ms] ease-out focus:border-[var(--color-hairline-strong)]"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="label-text">{labels.localeLabel}</span>
                <input
                  name="locale"
                  defaultValue="en"
                  required
                  className="h-9 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-3 font-mono text-[13px] outline-none transition-all duration-[120ms] ease-out focus:border-[var(--color-hairline-strong)]"
                />
                <span className="mono-meta text-[var(--color-text-muted)]">
                  {labels.localeHelp}
                </span>
              </label>
              <label className="grid gap-1.5">
                <span className="label-text">{labels.slugLabel}</span>
                <input
                  name="slug"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  required
                  className="h-9 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-3 font-mono text-[13px] outline-none transition-all duration-[120ms] ease-out focus:border-[var(--color-hairline-strong)]"
                />
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-3 py-3">
                <input
                  type="checkbox"
                  name="isTemplate"
                  className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-[var(--color-text-primary)]">
                    {labels.routeTemplateLabel}
                  </span>
                  <span className="mt-1 block text-[12px] leading-5 text-[var(--color-text-muted)]">
                    {labels.routeTemplateHelp}
                  </span>
                </span>
              </label>
              <div className="mt-1 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-8 cursor-pointer items-center rounded-sm border border-[var(--color-hairline)] px-3 text-[13px] text-[var(--color-text-secondary)] transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                >
                  {labels.cancel}
                </button>
                <SubmitButton label={labels.submit} />
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}
