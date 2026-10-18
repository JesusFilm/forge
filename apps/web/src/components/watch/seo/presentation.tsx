import { useId, type ReactNode } from "react"

import { buttonVariants } from "@/components/ui/button-variants"
import { WATCH_PILL_BUTTON_CLASS } from "@/components/watch/watch-section-styles"
import { cn } from "@/lib/utils"

import type {
  CtaEvidence,
  EvidenceFamily,
  ReportingWindow,
  SeoAvailability,
} from "./types"

export const seoActionClass = cn(
  buttonVariants({ variant: "pill", className: WATCH_PILL_BUTTON_CLASS }),
  "min-h-11 max-w-full whitespace-normal text-center motion-reduce:transition-none focus-visible:ring-stone-900",
)

export const seoFocusClass =
  "rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stone-900"

const availabilityLabels: Record<SeoAvailability, string> = {
  available: "Available",
  partial: "Partial coverage",
  unavailable: "Unavailable",
  not_connected: "Not connected",
  stale: "Out of date",
  compacted: "Detailed evidence expired",
  unknown: "Coverage unknown",
}

export function displayNumber(
  value: number | null | undefined,
  suffix = "",
): string {
  return value == null || !Number.isFinite(value)
    ? "Unavailable"
    : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}${suffix}`
}

export function displayDate(value: string | null): string {
  if (!value) return "Unavailable"
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(date)
}

export function displayWindow(window: ReportingWindow | null): string {
  return window
    ? `${displayDate(window.start)} to ${displayDate(window.end)}`
    : "Reporting window unavailable"
}

/** Non-displayable families cannot accidentally expose retained detailed data. */
export function displayableData<T>(family: EvidenceFamily<T>): T | null {
  return ["available", "partial", "stale"].includes(family.state)
    ? family.data
    : null
}

export function EvidenceProvenance({
  family,
}: {
  family: EvidenceFamily<unknown>
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-stone-200 pt-3 text-[10px] leading-relaxed text-stone-500">
      <p>Source: {family.source || "Unavailable"}</p>
      <p>{displayWindow(family.window)}</p>
      <p>Observed {displayDate(family.observedAt)}</p>
      {family.note ? <p>{family.note}</p> : null}
    </div>
  )
}

export function AvailabilityBadge({ state }: { state: SeoAvailability }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-[11px] leading-snug font-semibold tracking-wide uppercase",
        state === "available"
          ? "border-emerald-600/25 bg-emerald-50 text-emerald-700"
          : "border-amber-500/30 bg-amber-50 text-amber-800",
      )}
    >
      {availabilityLabels[state]}
    </span>
  )
}

export function SeoFamily<T>({
  name,
  title,
  description,
  family,
  children,
  className,
}: {
  name: string
  title: string
  description: string
  family: EvidenceFamily<T>
  children: (data: T) => ReactNode
  className?: string
}) {
  const id = useId()
  const data = displayableData(family)
  return (
    <section
      aria-labelledby={id}
      data-seo-family={name}
      data-availability={family.state}
      className={cn(
        "min-w-0 overflow-hidden rounded-[10px] border border-stone-200 bg-white p-4 text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,0.04)] [overflow-wrap:anywhere] sm:p-[18px]",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3
          id={id}
          className="text-base leading-snug font-semibold tracking-tight text-stone-950 sm:text-lg"
        >
          {title}
        </h3>
        <AvailabilityBadge state={family.state} />
      </div>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-stone-600">
        {description}
      </p>
      <div className="mt-4">
        {data != null ? (
          children(data)
        ) : (
          <p className="rounded-lg bg-stone-100 p-4 text-sm leading-relaxed text-stone-700">
            Unavailable.{" "}
            {family.state === "not_connected"
              ? "This source is not connected."
              : family.state === "compacted"
                ? "Detailed evidence has expired under the retention policy. Refresh evidence in Admin."
                : "No usable stored observation was supplied for this section."}
          </p>
        )}
      </div>
      <EvidenceProvenance family={family} />
    </section>
  )
}

export function Metric({
  label,
  value,
  suffix = "",
}: {
  label: string
  value: number | null
  suffix?: string
}) {
  return (
    <div data-metric={label} className="min-w-0">
      <dt className="text-[11px] leading-snug text-stone-500">{label}</dt>
      <dd
        className={cn(
          "mt-1 font-semibold text-stone-950 tabular-nums",
          value == null ? "text-sm" : "text-xl sm:text-2xl",
        )}
      >
        {displayNumber(value, suffix)}
      </dd>
    </div>
  )
}

export function CtaOutcome({ cta }: { cta: CtaEvidence }) {
  return (
    <div className="min-w-0 text-xs leading-relaxed">
      <h4 className="text-[10px] font-semibold text-stone-500">{cta.label}</h4>
      <p className="mt-1 text-stone-950">
        <span className="text-xl font-bold tabular-nums">
          {displayNumber(cta.clicks)}
        </span>{" "}
        clicks
      </p>
      <p className="mt-1 text-stone-700">
        {cta.outcomeLabel}:{" "}
        <span className="font-semibold tabular-nums">
          {displayNumber(cta.outcomes)}
        </span>
      </p>
      <p className="mt-1 text-[10px] text-stone-500">
        Measurement population: {displayNumber(cta.denominator)}
      </p>
      <p className="mt-1 text-[10px] text-stone-500">{cta.attributionNote}</p>
    </div>
  )
}
