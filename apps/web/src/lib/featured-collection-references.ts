export type FeaturedCollectionReferences = {
  ids: string[]
  slugs: string[]
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function collectFeaturedCollectionReferences(
  blocks: readonly unknown[],
): FeaturedCollectionReferences {
  const ids = new Set<string>()
  const slugs = new Set<string>()

  function visit(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (typeof value !== "object" || value == null) return

    const record = value as Record<string, unknown>
    const typename = nonEmptyString(record.__typename)
    const isMediaBlock =
      typename === "MediaCollectionBlock" || typename === "VideoCarouselBlock"
    if (
      isMediaBlock &&
      nonEmptyString(record.itemsSource) !== "dynamicCollections"
    ) {
      const parentSlug = nonEmptyString(record.mediaDefaultCollectionSlug)
      if (parentSlug) slugs.add(parentSlug)

      const items = Array.isArray(record.items) ? record.items : []
      for (const item of items) {
        if (typeof item !== "object" || item == null) continue
        const itemRecord = item as Record<string, unknown>
        const id =
          nonEmptyString(itemRecord.videoId) ??
          nonEmptyString(itemRecord.coreId)
        if (id) ids.add(id)
      }
    }

    for (const child of Object.values(record)) {
      if (Array.isArray(child)) visit(child)
    }
  }

  visit(blocks)
  return { ids: [...ids], slugs: [...slugs] }
}
