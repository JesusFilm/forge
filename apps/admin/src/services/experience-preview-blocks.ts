/**
 * Read-time projection that binds a preview's own locale to the media
 * collection items inside its blocks.
 *
 * `MediaCollectionItem.previewResolvedTitle` takes no argument — it reads the
 * locale off the item row instead, so no caller can ask a preview for a title
 * in a locale other than the one being previewed. Something has to put that
 * locale on the row, and `ExperiencePreview` is the only place that knows it.
 *
 * The stamp is deliberately NOT part of `MediaCollectionItemSchema` in
 * `domain/blocks.ts`: that schema is `.strict()` and describes persisted
 * authored JSON. This runs after `ExperienceLocaleDraftSnapshotSchema` has
 * already parsed the snapshot, so the extra key never reaches a Zod parse.
 *
 * The four traversal paths mirror the block composition allowed by
 * `domain/blocks.ts`: a media collection can sit at the top level, inside
 * `container.content`, inside `section.content`, or inside a container nested
 * in a section. A section cannot contain another section, so there is no
 * deeper case.
 */

/** Non-persisted key this projection adds to each media collection item. */
export const PREVIEW_LOCALE_KEY = "previewLocale"

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function stampItems(block: UnknownRecord, locale: string): unknown {
  if (!Array.isArray(block.items)) return block

  return {
    ...block,
    items: block.items.map((item) => {
      const record = asRecord(item)
      return record == null ? item : { ...record, [PREVIEW_LOCALE_KEY]: locale }
    }),
  }
}

function stampContent(block: UnknownRecord, locale: string): unknown {
  if (!Array.isArray(block.content)) return block

  return {
    ...block,
    content: block.content.map((child) => stampBlock(child, locale)),
  }
}

function stampBlock(block: unknown, locale: string): unknown {
  const record = asRecord(block)
  if (record == null) return block

  if (record.t === "mediaCollection") return stampItems(record, locale)
  if (record.t === "container" || record.t === "section") {
    return stampContent(record, locale)
  }
  return block
}

/**
 * Returns a copy of `blocks` whose media collection items carry `locale`.
 *
 * Non-media-collection blocks are passed through by reference, so an unrelated
 * block is identical — not merely equal — before and after. A non-array input
 * or a blank locale is returned untouched, matching the defensive posture of
 * `resolveWatchHomeCategoryRailReadBlocks` in the sibling projection.
 */
export function stampPreviewLocaleOnMediaCollections(
  blocks: unknown,
  locale: string,
): unknown {
  if (!Array.isArray(blocks) || !locale) return blocks
  return blocks.map((block) => stampBlock(block, locale))
}
