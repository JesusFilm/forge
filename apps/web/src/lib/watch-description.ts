export type WatchDescriptionAttribution = {
  lumo: boolean
}

export type ParsedWatchDescription = {
  editorial: string
  attribution: WatchDescriptionAttribution | null
}

const LUMO_FOOTER =
  /(?:^|\s)(?:[-–—]?\s*)For more information please visit\s*[-–—:]?\s*https?:\/\/(?:www\.)?lumoproject\.com\s+Follow us on Facebook\s*[-–—:]?\s*https?:\/\/www\.facebook\.com\/thelumoproject\s+Follow us on Twitter\s*[-–—:]?\s*https?:\/\/twitter\.com\/TheLumoProject\s+Follow us on Instagram\s*[-–—:]?\s*https?:\/\/www\.instagram\.com\/lumo\.project\s*\.?\s*$/

/** Separate the exact known LUMO source footer without rewriting authored copy. */
export function parseWatchDescription(
  description: string | null | undefined,
): ParsedWatchDescription {
  if (!description) return { editorial: description ?? "", attribution: null }

  const match = LUMO_FOOTER.exec(description)
  if (!match) return { editorial: description, attribution: null }

  return {
    editorial: description.slice(0, match.index).trimEnd(),
    attribution: { lumo: true },
  }
}

/** Metadata stays concise and uses editorial copy rather than source URLs. */
export function toWatchMetadataDescription(
  description: string | null | undefined,
  maxLength = 160,
): string {
  const editorial = parseWatchDescription(description).editorial.trim()
  if (editorial.length <= maxLength) return editorial

  const candidate = editorial.slice(0, maxLength)
  const boundary = candidate.lastIndexOf(" ")
  const shortened = candidate
    .slice(0, boundary > 0 ? boundary : maxLength - 1)
    .trimEnd()
  return `${shortened}…`
}
