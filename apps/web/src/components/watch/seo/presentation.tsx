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
  "min-h-11 max-w-full whitespace-normal text-center motion-reduce:transition-none focus-visible:ring-white",
)

export const seoFocusClass =
  "rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"

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
    <div className="mt-6 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/8 pt-3 text-[11px] leading-relaxed text-stone-400">
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
          ? "border-emerald-400/25 bg-emerald-400/8 text-emerald-200"
          : "border-amber-300/25 bg-amber-300/8 text-amber-100",
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
        "min-w-0 rounded-2xl border border-white/10 bg-[#171715] p-5 [overflow-wrap:anywhere] sm:p-7",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3
          id={id}
          className="text-xl leading-snug font-semibold tracking-tight text-white sm:text-2xl"
        >
          {title}
        </h3>
        <AvailabilityBadge state={family.state} />
      </div>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-stone-400">
        {description}
      </p>
      <div className="mt-5">
        {data != null ? (
          children(data)
        ) : (
          <p className="rounded-lg bg-stone-800/60 p-4 text-sm leading-relaxed text-stone-200">
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
      <dt className="text-sm leading-snug text-stone-300">{label}</dt>
      <dd
        className={cn(
          "mt-1 font-semibold text-stone-100 tabular-nums",
          value == null ? "text-base" : "text-2xl sm:text-3xl",
        )}
      >
        {displayNumber(value, suffix)}
      </dd>
    </div>
  )
}

export function CtaOutcome({ cta }: { cta: CtaEvidence }) {
  return (
    <div className="min-w-0 space-y-2 text-sm leading-relaxed">
      <h4 className="font-semibold text-white">{cta.label}</h4>
      <p className="text-stone-100">
        <span className="font-semibold tabular-nums">
          {displayNumber(cta.clicks)}
        </span>{" "}
        clicks
      </p>
      <p>
        {cta.outcomeLabel}:{" "}
        <span className="font-semibold tabular-nums">
          {displayNumber(cta.outcomes)}
        </span>
      </p>
      <p className="text-stone-300">
        Measurement population: {displayNumber(cta.denominator)}
      </p>
      <p className="text-stone-300">{cta.attributionNote}</p>
    </div>
  )
}
