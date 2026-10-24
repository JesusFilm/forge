"use client"

import { useState } from "react"

import { cx } from "@/components/admin-ui"

import { CopyCommand } from "./copy-command"

type Platform = "codex" | "claude" | "other"

type PlatformAction = {
  command?: string
  note?: string
  steps: string[]
}

type PlatformActionMap = Record<Platform, PlatformAction>

const platforms: Array<{ id: Platform; label: string }> = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude" },
  { id: "other", label: "Other AI Apps" },
]

export function PlatformActionPicker({
  actions,
  label,
}: {
  actions: PlatformActionMap
  label: string
}) {
  const [selected, setSelected] = useState<Platform>("codex")
  const action = actions[selected]

  return (
    <div className="min-w-0 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)]">
      <div
        className="grid gap-px border-b border-[var(--color-hairline)] bg-[var(--color-hairline)] sm:grid-cols-3"
        role="tablist"
        aria-label={label}
      >
        {platforms.map((platform) => {
          const isSelected = platform.id === selected

          return (
            <button
              key={platform.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setSelected(platform.id)}
              className={cx(
                "h-11 cursor-pointer bg-[var(--color-surface-raised)] px-4 text-left text-[13px] font-medium transition-all duration-[120ms] ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]",
                isSelected
                  ? "text-[var(--color-text-primary)] shadow-[inset_0_-2px_0_var(--color-brand)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-text-primary)]",
              )}
            >
              {platform.label}
            </button>
          )
        })}
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1fr)]">
        <ol className="space-y-3 text-[13px] leading-5 text-[var(--color-text-muted)]">
          {action.steps.map((step, index) => (
            <li key={step} className="flex gap-2">
              <span className="font-mono text-[11px] text-[var(--color-text-subtle)]">
                {index + 1}.
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <div className="min-w-0">
          {action.command ? (
            <CopyCommand
              label={platforms.find((p) => p.id === selected)!.label}
              value={action.command}
            />
          ) : (
            <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-3 text-[13px] leading-5 text-[var(--color-text-muted)]">
              {action.note}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
