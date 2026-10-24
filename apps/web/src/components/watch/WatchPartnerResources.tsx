"use client"

import { ArrowUpRight, FileText } from "lucide-react"
import { useMemo, useState } from "react"

import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"
import { cn } from "@/lib/utils"
import {
  WATCH_PARTNER_RESOURCE_CATEGORIES,
  WATCH_PARTNER_RESOURCES,
  filterWatchPartnerResources,
  watchPartnerResourceCategoryCounts,
  watchPartnerResourceLanguageLabel,
  watchPartnerResourceLinks,
  type WatchPartnerResource,
  type WatchPartnerResourceCategoryId,
} from "@/lib/watch-partner-resources"

const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeZone: "UTC",
})

/**
 * The public Partner resource library. It needs no account and makes no
 * session request: every entry is a real jesusfilm.org page, plus its PDF when
 * the page publishes one, opened as an ordinary external link.
 */
export function WatchPartnerResources() {
  const [category, setCategory] = useState<
    WatchPartnerResourceCategoryId | "all"
  >("all")
  const counts = useMemo(() => watchPartnerResourceCategoryCounts(), [])
  const resources = filterWatchPartnerResources(category)

  return (
    <section
      aria-labelledby="watch-partner-resources-heading"
      data-testid="watch-partner-resources"
      className="w-full min-w-0 text-white"
    >
      <p className={WATCH_SECTION_EYEBROW_CLASS}>Resource library</p>
      <h2
        id="watch-partner-resources-heading"
        className="mt-3 max-w-2xl text-3xl leading-[1.1] font-semibold tracking-[-0.02em] text-balance sm:text-4xl"
      >
        Guides and strategies from Jesus Film Project
      </h2>

      <div
        role="group"
        aria-label="Filter resources by category"
        className="mt-6 flex flex-wrap items-center gap-2"
      >
        <FilterButton
          label="All"
          count={WATCH_PARTNER_RESOURCES.length}
          selected={category === "all"}
          onSelect={() => setCategory("all")}
        />
        {WATCH_PARTNER_RESOURCE_CATEGORIES.map(({ id, label }) => (
          <FilterButton
            key={id}
            label={label}
            count={counts[id]}
            selected={category === id}
            onSelect={() => setCategory(id)}
          />
        ))}
      </div>
      <p
        aria-live="polite"
        data-testid="watch-partner-result-count"
        className="mt-4 text-sm text-white/60"
      >
        Showing {resources.length} of {WATCH_PARTNER_RESOURCES.length}
      </p>

      <ul
        data-testid="watch-partner-grid"
        className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {resources.map((resource) => (
          <li key={resource.id} className="min-w-0">
            <ResourceCard resource={resource} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function FilterButton({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string
  count: number
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none",
        selected
          ? "border-white bg-white text-stone-900"
          : "border-white/15 text-white/70 hover:border-white/40 hover:text-white",
      )}
    >
      {label}
      <span
        className={cn(
          "text-xs tabular-nums",
          selected ? "text-stone-500" : "text-white/40",
        )}
      >
        {count}
      </span>
    </button>
  )
}

function ResourceCard({ resource }: { resource: WatchPartnerResource }) {
  const category = WATCH_PARTNER_RESOURCE_CATEGORIES.find(
    ({ id }) => id === resource.category,
  )

  return (
    <article
      data-resource-id={resource.id}
      className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-4"
    >
      <p className="text-xs font-semibold tracking-[0.1em] text-red-200/70 uppercase">
        {category?.label}
      </p>
      <h3
        lang={resource.sourceLanguage}
        className="mt-1.5 text-base leading-tight font-semibold text-balance"
      >
        {resource.title}
      </h3>
      <p
        lang={resource.sourceLanguage}
        className="mt-2 text-sm leading-snug text-white/65"
      >
        {resource.summary}
      </p>
      <p className="mt-3 text-xs text-white/50">
        {watchPartnerResourceLanguageLabel(resource.sourceLanguage)} · Source
        checked {dateFormat.format(new Date(resource.sourceDate))}
      </p>
      <div className="mt-auto flex flex-wrap gap-x-5 gap-y-1 pt-4">
        {watchPartnerResourceLinks(resource).map((link) => {
          const Icon = link.kind === "pdf" ? FileText : ArrowUpRight
          return (
            <a
              key={link.kind}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-red-200 transition-colors hover:text-white focus-visible:text-white focus-visible:underline focus-visible:outline-none"
            >
              {link.label}
              <span className="sr-only">: {resource.title}</span>
              <Icon aria-hidden className="size-4" />
            </a>
          )
        })}
      </div>
    </article>
  )
}
