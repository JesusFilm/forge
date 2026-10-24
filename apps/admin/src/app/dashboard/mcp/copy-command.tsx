"use client"

import { Check, Copy } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"

import { cx } from "@/components/admin-ui"

export function CopyCommand({
  label,
  value,
}: {
  label: string
  value: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="min-w-0 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-hairline)] px-3 py-2">
        <span className="label-text">{label}</span>
        <button
          type="button"
          onClick={copy}
          className={cx(
            "inline-flex h-7 items-center gap-1.5 rounded-sm border px-2 text-[11px] font-medium transition-all duration-[120ms] ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]",
            copied
              ? "border-[var(--color-success-border)] text-[var(--color-success)]"
              : "border-[var(--color-hairline)] text-[var(--color-text-muted)] hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-text-primary)]",
          )}
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-words px-3 py-3 font-mono text-[11px] leading-5 text-[var(--color-text-primary)]">
        {value}
      </pre>
    </div>
  )
}

export function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-2">
      <span className="label-text">{label}</span>
      <CopySurface value={value} ariaLabel={`Copy ${label}`}>
        <code className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-[var(--color-text-primary)]">
          {value}
        </code>
      </CopySurface>
    </div>
  )
}

export function CopyPrompt({ value }: { value: string }) {
  return (
    <CopySurface
      value={value}
      ariaLabel="Copy prompt"
      className="min-h-[72px] items-start"
    >
      <span className="min-w-0 flex-1 text-[13px] leading-5 text-[var(--color-text-primary)]">
        {value}
      </span>
    </CopySurface>
  )
}

function CopySurface({
  ariaLabel,
  children,
  className,
  value,
}: {
  ariaLabel: string
  children: ReactNode
  className?: string
  value: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div
      className={cx(
        "flex min-w-0 gap-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-3 transition-colors duration-[120ms] hover:border-[var(--color-hairline-strong)]",
        className,
      )}
    >
      {children}
      <button
        type="button"
        onClick={copy}
        className={cx(
          "inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border transition-all duration-[120ms] ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]",
          copied
            ? "border-[var(--color-success-border)] text-[var(--color-success)]"
            : "border-[var(--color-hairline)] text-[var(--color-text-muted)] hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-text-primary)]",
        )}
        aria-label={ariaLabel}
        title={copied ? "Copied" : "Copy"}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  )
}
