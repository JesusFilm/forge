"use client"

/**
 * "Create persona version" — duplicates the current experience as a NEW DRAFT,
 * re-toned for a chosen audience persona (the source page steers structure +
 * voice; the persona drives framing/tone/Scripture). On success it navigates to
 * the freshly-created draft.
 *
 * The 5 persona ids mirror the Mastra roster
 * (`apps/mastra/src/config/personas/persona-roster.ts`) and are hardcoded here
 * because admin must NOT import from apps/mastra — the persona `id` is the
 * stable cross-app contract.
 */

import type { Route } from "next"
import { useState } from "react"
import { useRouter } from "next/navigation"

import type { GenerateVariantActionResult } from "@/app/dashboard/experiences/generate-variant-action"

const PERSONAS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "seeker-skeptic", label: "Seeker / skeptic" },
  { id: "grieving", label: "Grieving" },
  { id: "new-believer", label: "New believer" },
  { id: "family", label: "Family with children" },
  { id: "seasoned-believer", label: "Seasoned believer" },
]

const CONTROL_CLASS =
  "inline-flex h-8 cursor-pointer items-center rounded-sm border border-[var(--color-hairline)] px-3 text-[13px] text-[var(--color-text-secondary)] transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-60"

type PersonaVariantButtonProps = {
  action: (input: { personaId: string }) => Promise<GenerateVariantActionResult>
}

export function PersonaVariantButton({ action }: PersonaVariantButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [personaId, setPersonaId] = useState<string>(PERSONAS[0]!.id)
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const generating = status === "generating"

  async function handleCreate() {
    setStatus("generating")
    setError(null)
    try {
      const result = await action({ personaId })
      if (!result.ok) {
        setStatus("error")
        setError(result.error)
        return
      }
      setStatus("idle")
      setOpen(false)
      // Navigate to the freshly-created DRAFT duplicate.
      router.push(result.href as Route)
    } catch {
      setStatus("error")
      setError("Something went wrong generating the persona version.")
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={CONTROL_CLASS}
        aria-expanded={open}
      >
        Create persona version…
      </button>

      {open && (
        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3">
          <label
            htmlFor="persona-variant-select"
            className="text-[12px] text-[var(--color-text-muted)]"
          >
            Audience
          </label>
          <select
            id="persona-variant-select"
            value={personaId}
            onChange={(event) => setPersonaId(event.target.value)}
            disabled={generating}
            className="h-9 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-3 text-[13px] outline-none transition-all duration-[120ms] ease-out focus:border-[var(--color-hairline-strong)] disabled:opacity-60"
          >
            {PERSONAS.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleCreate}
            disabled={generating}
            className={CONTROL_CLASS}
          >
            {generating ? "Generating… (~60s)" : "Create draft"}
          </button>
          {error && (
            <p className="w-full text-[12px] text-[var(--color-danger,#dc2626)]">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
