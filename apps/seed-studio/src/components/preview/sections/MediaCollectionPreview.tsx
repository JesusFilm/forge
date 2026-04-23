import type { MediaCollectionSection } from "@forge/experience-templates"

import { cn } from "@/lib/cn"
import { fixImageUrl } from "@/lib/mux"

type MediaCollectionPreviewProps = {
  section: MediaCollectionSection
}

type NormalizedItem = {
  title: string
  subtitle?: string
  label?: string
  collectionSize?: string
  imageUrl?: string
}

function normalizeItem(
  raw: NonNullable<MediaCollectionSection["items"]>[number],
): NormalizedItem {
  const imageUrl = fixImageUrl(raw.imageUrl) ?? undefined
  return {
    title: raw.titleOverride ?? "Untitled",
    subtitle: raw.subtitleOverride,
    label: raw.labelOverride,
    collectionSize: raw.collectionSize,
    imageUrl,
  }
}

export function MediaCollectionPreview({
  section,
}: MediaCollectionPreviewProps) {
  const variant = section.variant ?? "grid"
  const items = (section.items ?? [])
    .filter((i): i is NonNullable<typeof i> => i != null)
    .map(normalizeItem)

  const header = (
    <div className="space-y-1">
      {section.categoryLabel ? (
        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          {section.categoryLabel}
        </p>
      ) : null}
      {section.title ? (
        <h3 className="text-base font-bold text-neutral-900">
          {section.title}
        </h3>
      ) : null}
      {section.subtitle ? (
        <p className="text-xs text-neutral-500">{section.subtitle}</p>
      ) : null}
      {section.description ? (
        <p className="text-sm text-neutral-700">{section.description}</p>
      ) : null}
    </div>
  )

  if (items.length === 0) {
    return (
      <div className="space-y-3">
        {header}
        <p className="text-xs italic text-neutral-400">No items.</p>
      </div>
    )
  }

  if (variant === "hero") {
    const [featured] = items
    return (
      <div className="space-y-3">
        {header}
        {featured ? (
          <div className="relative aspect-[16/7] overflow-hidden rounded-lg bg-neutral-200">
            {featured.imageUrl ? (
              <img
                src={featured.imageUrl}
                alt={featured.title}
                className="h-full w-full object-cover"
              />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 space-y-1 p-4">
              <h4 className="text-base font-bold text-white">
                {featured.title}
              </h4>
              {featured.subtitle ? (
                <p className="text-xs text-white/80">{featured.subtitle}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  if (variant === "player") {
    const [featured] = items
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        {header}
        {featured ? (
          <div className="aspect-video overflow-hidden rounded-lg bg-neutral-900">
            {featured.imageUrl ? (
              <img
                src={featured.imageUrl}
                alt={featured.title}
                className="h-full w-full object-cover opacity-80"
              />
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  if (variant === "carousel") {
    return (
      <div className="space-y-3">
        {header}
        <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
          {items.map((item, i) => (
            <MediaCard
              key={i}
              item={item}
              className="w-40 shrink-0 snap-center"
            />
          ))}
        </div>
      </div>
    )
  }

  const gridClass =
    variant === "grid"
      ? "grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4"
      : "grid grid-cols-1 gap-3 md:grid-cols-2"

  return (
    <div className="space-y-3">
      {header}
      <div className={gridClass}>
        {items.map((item, i) => (
          <MediaCard key={i} item={item} />
        ))}
      </div>
      {section.ctaLink ? (
        <a
          href={section.ctaLink}
          className="inline-block text-xs font-medium text-blue-600 hover:underline"
        >
          {section.ctaLabel ?? "View all"}
        </a>
      ) : null}
      {section.footerText ? (
        <p className="text-xs text-neutral-500">{section.footerText}</p>
      ) : null}
    </div>
  )
}

function MediaCard({
  item,
  className,
}: {
  item: NormalizedItem
  className?: string
}) {
  return (
    <article
      className={cn(
        "space-y-2 overflow-hidden rounded-lg border border-neutral-200 bg-white",
        className,
      )}
    >
      <div className="relative aspect-video bg-neutral-200">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.title}
            className="h-full w-full object-cover"
          />
        ) : null}
        {item.collectionSize ? (
          <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
            {item.collectionSize}
          </span>
        ) : null}
      </div>
      <div className="space-y-0.5 px-3 pb-3">
        {item.label ? (
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            {item.label}
          </p>
        ) : null}
        <p className="truncate text-xs font-semibold text-neutral-900">
          {item.title}
        </p>
        {item.subtitle ? (
          <p className="truncate text-[11px] text-neutral-500">
            {item.subtitle}
          </p>
        ) : null}
      </div>
    </article>
  )
}
