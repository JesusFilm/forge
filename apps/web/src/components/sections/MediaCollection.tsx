import Image from "next/image"
import { graphql, type FragmentOf } from "@forge/graphql"
import type { EnrichedMediaItem } from "@/lib/enrichment"
import { enrichMediaItem } from "@/lib/enrichment"

export const mediaCollectionFragment = graphql(`
  fragment MediaCollection on ComponentSectionsMediaCollection @_unmask {
    id
    title
    subtitle
    mediaDescription: description
    categoryLabel
    mediaCtaLink: ctaLink
    showItemNumbers
    variant
    items {
      id
      titleOverride
      subtitleOverride
      imageOverride {
        url
      }
      video {
        documentId
        title
        slug
        image {
          url
        }
      }
    }
  }
`)

type MediaCollectionProps = {
  data: FragmentOf<typeof mediaCollectionFragment>
}

export function MediaCollection({ data }: MediaCollectionProps) {
  const {
    id,
    title,
    subtitle,
    mediaDescription: description,
    categoryLabel,
    mediaCtaLink: ctaLink,
    showItemNumbers,
    variant,
    items,
  } = data

  const enrichedItems = (items ?? [])
    .filter((i): i is NonNullable<typeof i> => i != null)
    .map(enrichMediaItem)

  if (enrichedItems.length === 0) return null

  const ItemCard = ({
    item,
    index,
  }: {
    item: EnrichedMediaItem
    index: number
  }) => (
    <article className="rounded-lg border bg-white p-4 shadow-sm">
      {item.imageUrl && (
        <div className="relative mb-2 aspect-video w-full overflow-hidden rounded">
          <Image
            src={item.imageUrl}
            alt={item.title}
            fill
            className="object-cover"
            sizes={
              variant === "hero"
                ? "100vw"
                : variant === "player"
                  ? "(max-width: 768px) 100vw, 33vw"
                  : "(max-width: 768px) 100vw, 25vw"
            }
          />
        </div>
      )}
      <h3 className="font-semibold">{item.title}</h3>
      {item.subtitle && (
        <p className="text-sm text-gray-600">{item.subtitle}</p>
      )}
      {showItemNumbers && (
        <span className="text-xs text-gray-400">{index + 1}</span>
      )}
    </article>
  )

  const gridClass =
    variant === "hero"
      ? "grid grid-cols-1"
      : variant === "player"
        ? "grid grid-cols-1 max-w-2xl mx-auto"
        : variant === "grid"
          ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
          : variant === "carousel"
            ? "flex gap-4 overflow-x-auto pb-4"
            : "grid grid-cols-1 md:grid-cols-2 gap-4"

  return (
    <section id={id} className="py-8">
      <div className="container mx-auto px-4">
        {title && <h2 className="mb-2 text-2xl font-bold">{title}</h2>}
        {subtitle && <p className="mb-2 text-gray-600">{subtitle}</p>}
        {description && <p className="mb-4">{description}</p>}
        {categoryLabel && (
          <span className="mb-4 inline-block rounded bg-gray-100 px-2 py-1 text-sm">
            {categoryLabel}
          </span>
        )}
        <div className={gridClass}>
          {enrichedItems.map((item, i) => (
            <ItemCard key={item.id} item={item} index={i} />
          ))}
        </div>
        {ctaLink && (
          <a
            href={ctaLink}
            className="mt-4 inline-block font-medium text-blue-600 hover:underline"
          >
            View all
          </a>
        )}
      </div>
    </section>
  )
}
