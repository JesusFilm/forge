"use client"

import { Sparkles, X } from "lucide-react"

export function AiDraftPanel({
  open,
  prompt,
  pending,
  error,
  onPromptChange,
  onOpen,
  onCancel,
  onGenerate,
}: {
  open: boolean
  prompt: string
  pending: boolean
  error: string
  onPromptChange: (value: string) => void
  onOpen: () => void
  onCancel: () => void
  onGenerate: () => void
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full cursor-pointer items-start gap-4 rounded-sm border border-[color:color-mix(in_oklab,var(--color-brand)_28%,var(--color-hairline))] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-brand)_8%,var(--color-surface)),var(--color-surface-raised))] px-4 py-4 text-left transition-all duration-[120ms] ease-out hover:border-[color:color-mix(in_oklab,var(--color-brand)_45%,var(--color-hairline-strong))] hover:bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-brand)_11%,var(--color-surface)),var(--color-surface))]"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-[color:color-mix(in_oklab,var(--color-brand)_30%,var(--color-hairline))] bg-[color:color-mix(in_oklab,var(--color-brand)_14%,var(--color-surface-inset))] text-[var(--color-brand)]">
          <Sparkles className="h-5 w-5" strokeWidth={1.5} />
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            AI Draft
          </div>
          <div className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">
            Generate with AI
          </div>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--color-text-secondary)]">
            Type a theme, story, or angle and let AI build a first draft with
            title, description, and blocks using the real catalog.
          </p>
        </div>
      </button>
    )
  }

  return (
    <div className="rounded-sm border border-[color:color-mix(in_oklab,var(--color-brand)_28%,var(--color-hairline))] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-brand)_7%,var(--color-surface)),var(--color-surface))] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            AI Draft
          </div>
          <div className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">
            Generate with AI
          </div>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--color-text-secondary)]">
            Describe the theme, story, or angle you want. AI will draft title,
            description, and blocks into this empty canvas.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
          aria-label="Close AI draft panel"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      <textarea
        id="ai-draft-prompt"
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        rows={4}
        placeholder="Example: A gentle experience about forgiveness after failure, starting with hope, then a story video, then reflection and next steps."
        className="mt-4 block w-full resize-y rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-3 py-3 text-[13px] leading-6 text-[var(--color-text-primary)] outline-none transition-all duration-[120ms] ease-out placeholder:text-[var(--color-text-disabled)] focus:border-[var(--color-hairline-strong)]"
      />

      {error ? (
        <p className="mt-3 text-[12px] text-[var(--color-danger)]">{error}</p>
      ) : (
        <p className="mt-3 text-[12px] text-[var(--color-text-muted)]">
          Uses only catalog-backed video candidates and keeps the result local
          until you save.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onGenerate}
          disabled={pending}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-sm bg-[var(--color-brand)] px-3 text-[12px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.5} />
          {pending ? "Generating…" : "Generate Draft"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="inline-flex h-9 items-center justify-center rounded-sm border border-[var(--color-hairline)] px-3 text-[12px] font-medium text-[var(--color-text-secondary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
