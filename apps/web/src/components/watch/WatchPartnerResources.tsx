"use client"

// The Partner tab's resource library, as originally designed: a featured
// "take it with you" PDF carousel on the shared embla Carousel, a filterable
// strategy grid, and a prayer-guide strip. Records are the verified public
// jesusfilm.org library (`@/lib/watch-partner-resources`) via the
// `partner-resources` adapter; every link is an ordinary external link.

import {
  ArrowUpRight,
  Download,
  FileText,
  Sparkles,
  type LucideIcon,
} from "lucide-react"
import Image from "next/image"
import { useMemo, useState } from "react"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import {
  PARTNER_FAMILY_GUIDES,
  PARTNER_PRAYER_GUIDES,
  PARTNER_RESOURCES,
  type PartnerResource,
  type PartnerResourceKind,
} from "@/components/watch/partner-resources"
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"
import { CAROUSEL_END_SPACER } from "@/lib/content-width"
import { cn } from "@/lib/utils"

const CAROUSEL_OPTS = {
  dragFree: true,
  containScroll: "trimSnaps",
  align: "start",
} as const

/** Filter order: what a partner planning an outreach reaches for first. */
const KIND_ORDER: PartnerResourceKind[] = [
  "Outreach Resources",
  "Training Strategies",
  "Digital Strategies",
  "Equipment",
  "Prayer Resources",
]

const KIND_SHORT: Record<PartnerResourceKind, string> = {
  "Outreach Resources": "Outreach",
  "Training Strategies": "Training",
  "Digital Strategies": "Digital",
  Equipment: "Equipment",
  "Prayer Resources": "Prayer",
}

const withPdf = PARTNER_RESOURCES.filter(
  (r): r is PartnerResource & { pdf: string } => Boolean(r.pdf),
)

export function WatchPartnerResources() {
  const [kind, setKind] = useState<PartnerResourceKind | "all">("all")

  const grid = useMemo(() => {
    const ordered = [...PARTNER_RESOURCES].sort(
      (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
    )
    return kind === "all" ? ordered : ordered.filter((r) => r.kind === kind)
  }, [kind])

  const counts = useMemo(() => {
    const map = new Map<PartnerResourceKind, number>()
    for (const r of PARTNER_RESOURCES)
      map.set(r.kind, (map.get(r.kind) ?? 0) + 1)
    return map
  }, [])

  return (
    <section
      aria-labelledby="watch-partner-resources-heading"
      data-testid="watch-partner-resources"
      className="w-full min-w-0 pt-12 text-white md:pt-16"
    >
      {/* ---------------- 1. featured downloads ---------------- */}
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="max-w-2xl">
          <p className={WATCH_SECTION_EYEBROW_CLASS}>Take it with you</p>
          <h2
            id="watch-partner-resources-heading"
            className="mt-3 text-3xl leading-[1.1] font-semibold tracking-[-0.02em] text-balance sm:text-4xl"
          >
            Printable guides, ready to hand out.
          </h2>
        </div>
        <p className="text-sm text-white/55">
          {withPdf.length} PDFs · free to print and share
        </p>
      </header>

      <div className="mt-6 -mx-5 w-[calc(100%+2.5rem)] min-w-0 md:mx-0 md:w-full">
        <Carousel
          aria-label="Printable partner guides"
          opts={CAROUSEL_OPTS}
          className="w-full"
        >
          <CarouselContent
            data-testid="watch-partner-pdfs"
            className="-ml-4 pl-5 md:pl-0"
          >
            {withPdf.map((r) => (
              <CarouselItem key={r.id} className="basis-auto pl-4">
                <PdfCard resource={r} />
              </CarouselItem>
            ))}
            <CarouselItem className="basis-auto pl-0" aria-hidden tabIndex={-1}>
              <div className={CAROUSEL_END_SPACER} />
            </CarouselItem>
          </CarouselContent>
          <CarouselPrevious label="Previous guides" />
          <CarouselNext label="More guides" />
        </Carousel>
      </div>

      {/* ---------------- 2. the whole library ---------------- */}
      <div className="mt-14 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="max-w-2xl">
          <p className={WATCH_SECTION_EYEBROW_CLASS}>The full toolkit</p>
          <h3 className="mt-3 text-2xl leading-tight font-semibold text-balance sm:text-3xl">
            Everything we give partners.
          </h3>
        </div>
        <div
          role="tablist"
          aria-label="Filter resources"
          className="flex flex-wrap items-center gap-2"
        >
          <FilterChip
            selected={kind === "all"}
            onClick={() => setKind("all")}
            label="All"
            count={PARTNER_RESOURCES.length}
          />
          {KIND_ORDER.map((k) => (
            <FilterChip
              key={k}
              selected={kind === k}
              onClick={() => setKind(k)}
              label={KIND_SHORT[k]}
              count={counts.get(k) ?? 0}
            />
          ))}
        </div>
      </div>

      <ul
        data-testid="watch-partner-grid"
        className="mt-6 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {grid.map((r) => (
          <li key={r.id} className="min-w-0">
            <ResourceTile resource={r} />
          </li>
        ))}
      </ul>

      {/* ---------------- 3. prayer guides ---------------- */}
      <div className="mt-14 min-w-0 rounded-3xl border border-white/10 bg-white/[0.04] p-6 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div>
            <p className={cn(WATCH_SECTION_EYEBROW_CLASS, "!text-xs")}>
              Pray with us
            </p>
            <h3 className="mt-2 text-xl leading-tight font-semibold sm:text-2xl">
              Monthly prayer guides
            </h3>
            <p className="mt-2 max-w-[48ch] text-sm leading-relaxed text-white/60">
              A country a month, with prayer points for the least-reached. Print
              it, or use the family edition at the dinner table.
            </p>
          </div>
          <a
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-300 transition-colors hover:text-white"
            href="https://www.jesusfilm.org/partners/resources/pray/"
            target="_blank"
            rel="noopener noreferrer"
          >
            All prayer resources
            <ArrowUpRight aria-hidden className="size-4" />
          </a>
        </div>

        {/* family editions: printed covers, so lead with the artwork */}
        <p className="mt-7 text-[11px] font-semibold tracking-[0.14em] text-white/45 uppercase">
          Family edition
        </p>
        <ul className="mt-3 grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
          {PARTNER_FAMILY_GUIDES.slice(0, 4).map((g) => (
            <li key={g.url} className="min-w-0">
              <a
                className="group block overflow-hidden rounded-xl border border-white/10 bg-black/30 transition-colors hover:border-white focus-visible:border-white focus-visible:outline-none"
                href={g.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {g.image ? (
                  <span className="relative block aspect-[7/4] overflow-hidden">
                    <Image
                      src={g.image}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 45vw, 200px"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </span>
                ) : null}
                <span className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <span className="truncate text-[13px] font-semibold text-white group-hover:text-white">
                    {g.title}
                  </span>
                  <Download
                    aria-hidden
                    className="size-4 shrink-0 text-white/40 group-hover:text-brand-red"
                  />
                </span>
              </a>
            </li>
          ))}
        </ul>

        {/* individual editions: a dense month list */}
        <p className="mt-7 text-[11px] font-semibold tracking-[0.14em] text-white/45 uppercase">
          Individual edition
        </p>
        <ul className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PARTNER_PRAYER_GUIDES.slice(0, 9).map((g) => (
            <li key={g.url} className="min-w-0">
              <a
                className="group flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 transition-colors hover:border-white hover:bg-white focus-visible:border-white focus-visible:outline-none"
                href={g.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FileText
                  aria-hidden
                  className="size-4 shrink-0 text-white/60 group-hover:text-brand-red"
                />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-white group-hover:text-stone-900">
                  {g.title}
                </span>
                <Download
                  aria-hidden
                  className="size-4 shrink-0 text-white/40 group-hover:text-stone-600"
                />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function FilterChip({
  selected,
  onClick,
  label,
  count,
}: {
  selected: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none",
        selected
          ? "border-white bg-white text-stone-900"
          : "border-white/15 bg-transparent text-white/70 hover:border-white/40 hover:text-white",
      )}
    >
      {label}
      <span
        className={cn(
          "text-[11px] tabular-nums",
          selected ? "text-stone-500" : "text-white/40",
        )}
      >
        {count}
      </span>
    </button>
  )
}

/** Big, image-led card for a resource that ships a printable PDF. */
function PdfCard({
  resource,
}: {
  resource: PartnerResource & { pdf: string }
}) {
  return (
    <a
      href={resource.pdf}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex h-full w-[260px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] transition-colors hover:border-white/40 hover:bg-white/10 focus-visible:border-white focus-visible:outline-none sm:w-[300px]"
    >
      <span className="relative block aspect-[4/3] overflow-hidden bg-black/40">
        <Image
          src={resource.image}
          alt=""
          fill
          sizes="300px"
          className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent"
        />
        <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] text-white uppercase backdrop-blur-sm">
          <FileText aria-hidden className="size-3" />
          PDF
        </span>
        <span className="absolute right-3 bottom-3 left-3 block text-[17px] leading-tight font-semibold text-white">
          {resource.title}
        </span>
      </span>
      <span className="flex flex-1 flex-col gap-3 p-4">
        <span className="line-clamp-3 text-[13px] leading-snug text-white/65">
          {resource.summary}
        </span>
        <span className="mt-auto inline-flex items-center gap-2 text-[12px] font-bold tracking-wider text-white uppercase">
          <Download
            aria-hidden
            className="size-4 text-brand-red transition-transform group-hover:translate-y-0.5"
          />
          Download
        </span>
      </span>
    </a>
  )
}

const KIND_ICON: Record<PartnerResourceKind, LucideIcon> = {
  "Outreach Resources": Sparkles,
  "Training Strategies": FileText,
  "Digital Strategies": ArrowUpRight,
  Equipment: Download,
  "Prayer Resources": Sparkles,
}

/** Compact tile for the full library grid. */
function ResourceTile({ resource }: { resource: PartnerResource }) {
  const Icon = KIND_ICON[resource.kind]
  return (
    <a
      href={resource.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex h-full gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3 transition-colors hover:border-white/40 hover:bg-white/[0.09] focus-visible:border-white focus-visible:outline-none"
    >
      <span className="relative block size-[76px] shrink-0 overflow-hidden rounded-xl bg-black/40">
        <Image
          src={resource.image}
          alt=""
          fill
          sizes="76px"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col py-0.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em] text-red-200/70 uppercase">
          <Icon aria-hidden className="size-3" />
          {KIND_SHORT[resource.kind]}
          {resource.pdf ? (
            <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[9px] tracking-[0.08em] text-white/70">
              PDF
            </span>
          ) : null}
        </span>
        <span className="mt-1.5 text-[15px] leading-tight font-semibold text-balance">
          {resource.title}
        </span>
        <span className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-white/55">
          {resource.summary}
        </span>
      </span>
    </a>
  )
}
