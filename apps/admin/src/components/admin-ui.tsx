import type { ButtonHTMLAttributes, ReactNode } from "react"
import type { Route } from "next"
import Link from "next/link"
import { ChevronRight, Search, type LucideIcon } from "lucide-react"

type StatusTone = "success" | "warning" | "danger" | "info" | "muted"

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ")
}

export function StatusPill({
  tone,
  children,
}: {
  tone: StatusTone
  children: ReactNode
}) {
  const toneClass =
    tone === "success"
      ? "text-[var(--color-success)] border-[var(--color-success-border)]"
      : tone === "warning"
        ? "text-[var(--color-warning)] border-[var(--color-warning-border)]"
        : tone === "danger"
          ? "text-[var(--color-danger)] border-[var(--color-danger-border)]"
          : tone === "info"
            ? "text-[var(--color-info)] border-[var(--color-info-border)]"
            : "text-[var(--color-text-muted)] border-white/15"

  return <span className={cx("status-pill", toneClass)}>{children}</span>
}

export function DashboardPageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow ? <div className="label-text mb-1">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
        <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
          {description}
        </p>
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  )
}

export function PrimaryButton({
  children,
  className,
  type = "button",
  ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
}) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex h-8 cursor-pointer items-center gap-2 rounded-sm bg-[var(--color-brand)] px-3 text-[13px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-[var(--color-brand)]",
        className,
      )}
      {...buttonProps}
    >
      {children}
    </button>
  )
}

export function SecondaryButton({
  children,
  className,
  type = "button",
  ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
}) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex h-8 cursor-pointer items-center gap-2 rounded-sm border border-[var(--color-hairline)] px-3 text-[13px] font-medium text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--color-hairline)] disabled:hover:bg-transparent",
        className,
      )}
      {...buttonProps}
    >
      {children}
    </button>
  )
}

export function MetricCard({
  label,
  value,
  delta,
  footer,
  accent,
}: {
  label: string
  value: string
  delta?: string
  footer: string
  accent?: "danger"
}) {
  return (
    <div
      className={cx(
        "app-card flex flex-col gap-2 p-4",
        accent === "danger" && "border-[var(--color-danger-border)]",
      )}
    >
      <span
        className={cx(
          "label-text",
          accent === "danger" && "text-[var(--color-danger)]",
        )}
      >
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span
          className={cx(
            "font-mono text-xl font-medium",
            accent === "danger" && "text-[var(--color-brand)]",
          )}
        >
          {value}
        </span>
        {delta ? (
          <span
            className={cx(
              "font-mono text-[11px]",
              accent === "danger"
                ? "text-[var(--color-danger)]"
                : "text-[var(--color-success)]",
            )}
          >
            {delta}
          </span>
        ) : null}
      </div>
      <span
        className={cx(
          "font-mono text-[10px] uppercase text-[var(--color-text-muted)]",
          accent === "danger" && "text-[var(--color-danger)]",
        )}
      >
        {footer}
      </span>
    </div>
  )
}

export function SearchPill({
  label,
  shortcut,
}: {
  label: string
  shortcut: string
}) {
  return (
    <div className="flex h-8 w-full max-w-[320px] items-center gap-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3">
      <Search
        className="h-4 w-4 text-[var(--color-text-muted)]"
        strokeWidth={1.5}
      />
      <span className="flex-1 font-mono text-[11px] text-[var(--color-text-muted)]">
        {label}
      </span>
      <span className="rounded-sm border border-white/10 bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
        {shortcut}
      </span>
    </div>
  )
}

export function SearchPillButton({
  onClick,
  label,
  shortcut,
}: {
  onClick: () => void
  label: string
  shortcut: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full max-w-[320px] cursor-pointer items-center gap-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-left transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-overlay)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
    >
      <Search
        className="h-4 w-4 text-[var(--color-text-muted)]"
        strokeWidth={1.5}
      />
      <span className="flex-1 font-mono text-[11px] text-[var(--color-text-muted)]">
        {label}
      </span>
      <span className="rounded-sm border border-white/10 bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
        {shortcut}
      </span>
    </button>
  )
}

export function DataTable({
  columns,
  rowHrefs,
  rows,
  selectedRow,
}: {
  columns: readonly string[]
  rowHrefs?: readonly Route[]
  rows: readonly (readonly ReactNode[])[]
  selectedRow?: number
}) {
  return (
    <div className="app-card overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead className="hairline-strong-b">
          <tr className="h-10">
            {columns.map((column) => (
              <th key={column} className="label-text px-4">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className={cx(
                "hairline-b h-[52px]",
                rowIndex === selectedRow &&
                  "border-l-2 border-[var(--color-brand)] bg-[var(--color-brand-soft)]",
              )}
            >
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={cx(
                    "align-middle",
                    rowHrefs?.[rowIndex] ? "p-0" : "px-4 py-2",
                  )}
                >
                  {rowHrefs?.[rowIndex] ? (
                    <Link
                      href={rowHrefs[rowIndex]}
                      className="flex h-[52px] w-full cursor-pointer items-center px-4 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]"
                    >
                      {cell}
                    </Link>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function InfoStrip({
  items,
  trailing,
}: {
  items: readonly string[]
  trailing: string
}) {
  return (
    <div className="flex h-6 items-center justify-between border-b border-white/5 bg-[var(--color-surface)] px-4">
      <div className="flex items-center gap-4">
        {items.map((item, index) => (
          <span
            key={item}
            className={cx(
              "font-mono text-[10px] text-[var(--color-text-muted)]",
              index === 0 && "flex items-center gap-1.5",
            )}
          >
            {index === 0 ? (
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
            ) : null}
            {item}
          </span>
        ))}
      </div>
      <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
        {trailing}
      </span>
    </div>
  )
}

export function PageSection({
  title,
  meta,
  actions,
  children,
}: {
  title: string
  meta?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="app-card overflow-hidden">
      <div className="hairline-strong-b flex items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {meta ? (
            <div className="mono-meta mt-1 text-[var(--color-text-muted)]">
              {meta}
            </div>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function QueueList({
  items,
}: {
  items: ReadonlyArray<{
    title: string
    meta: string
    status: { label: string; tone: StatusTone }
    detail?: string
  }>
}) {
  return (
    <div className="divide-y divide-white/10">
      {items.map((item) => (
        <div
          key={`${item.title}-${item.meta}`}
          className="flex items-center justify-between gap-4 px-4 py-3"
        >
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium">{item.title}</div>
            <div className="mono-meta text-[var(--color-text-muted)]">
              {item.meta}
            </div>
            {item.detail ? (
              <div className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                {item.detail}
              </div>
            ) : null}
          </div>
          <StatusPill tone={item.status.tone}>{item.status.label}</StatusPill>
        </div>
      ))}
    </div>
  )
}

export function InsightGrid({
  items,
}: {
  items: ReadonlyArray<{
    label: string
    value: string
    detail: string
    icon: LucideIcon
  }>
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <div
            key={item.label}
            className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="label-text">{item.label}</span>
              <Icon
                className="h-4 w-4 text-[var(--color-text-muted)]"
                strokeWidth={1.5}
              />
            </div>
            <div className="font-mono text-[16px] font-medium">
              {item.value}
            </div>
            <div className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
              {item.detail}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function OperatorRail({
  title,
  meta = "FIELD_GUIDE",
  notes,
  chips,
}: {
  title: string
  meta?: string
  notes: string
  chips: ReadonlyArray<{ label: string; value: string }>
}) {
  return (
    <PageSection title={title} meta={meta}>
      <div className="p-4">
        <p className="text-[13px] leading-6 text-[var(--color-text-secondary)]">
          {notes}
        </p>
        <div className="mt-4 grid gap-3">
          {chips.map((chip) => (
            <div
              key={chip.label}
              className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-3"
            >
              <div className="label-text mb-1">{chip.label}</div>
              <div className="mono-meta text-[var(--color-text-secondary)]">
                {chip.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageSection>
  )
}

export function BreadcrumbTrail({
  section,
  current,
}: {
  section: string
  current: string
}) {
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
      <span>{section}</span>
      <ChevronRight className="h-3 w-3" strokeWidth={1.5} />
      <span className="text-[var(--color-text-primary)]">{current}</span>
    </div>
  )
}
