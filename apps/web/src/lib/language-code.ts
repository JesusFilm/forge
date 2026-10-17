import { slugToBcp47Primary, slugToBcp47Tag } from "@/lib/locale"
import { LANGUAGE_BCP47_MAP } from "@/lib/language-bcp47-map"

/**
 * Return the primary BCP 47 language subtag in the compact uppercase form
 * used by Watch's selector and switcher chrome (for example `en-US` → `EN`).
 */
export function primaryLanguageCode(
  value: string | null | undefined,
): string | null {
  const primary = value?.trim().split(/[-_]/)[0]?.trim() ?? ""
  return /^[A-Za-z]{2,3}$/.test(primary) ? primary.toUpperCase() : null
}

type LanguageCodeSource = {
  bcp47?: string | null
  iso3?: string | null
  slug?: string | null
}

function badgeCodeFromTag(tag: string): string | null {
  const code = primaryLanguageCode(tag)
  if (!code) return null

  const subtags = tag.split(/[-_]/).slice(1)
  const variant: string[] = []
  const hasNumericRegionVariant = subtags.some((subtag) =>
    /^\d{2}$/.test(subtag),
  )

  for (let index = 0; index < subtags.length; index += 1) {
    const subtag = subtags[index]
    if (subtag.toLowerCase() === "x") {
      const privateUse = subtags[index + 1]
      if (privateUse) variant.push(privateUse.slice(0, 3).toUpperCase())
      break
    }

    if (/^[A-Za-z]{4}$/.test(subtag)) {
      variant.push(subtag.toUpperCase())
    } else if (/^(?:[A-Za-z]{2}|\d{3})$/.test(subtag)) {
      if (!(hasNumericRegionVariant && /^[A-Za-z]{2}$/.test(subtag))) {
        variant.push(subtag.toUpperCase())
      }
    } else if (/^\d{2}$/.test(subtag)) {
      variant.push(subtag)
    } else if (/^[A-Za-z0-9]{3,8}$/.test(subtag)) {
      variant.push(subtag.slice(0, 4).toUpperCase())
    }
  }

  return variant.length > 0 ? `${code}-${variant.join("-")}` : code
}

function uniqueSlugSuffix(slug: string, collidingSlugs: string[]): string {
  const slugParts = collidingSlugs.map((candidate) =>
    candidate.toUpperCase().split("-"),
  )
  const commonPrefixLength =
    Array.from(
      { length: Math.min(...slugParts.map((parts) => parts.length)) },
      (_, index) => index,
    ).find((index) =>
      slugParts.some((parts) => parts[index] !== slugParts[0]?.[index]),
    ) ?? Math.min(...slugParts.map((parts) => parts.length))
  const descriptors = slugParts.map((parts) =>
    parts.slice(commonPrefixLength).length > 0
      ? parts.slice(commonPrefixLength)
      : parts.slice(-1),
  )
  const targetIndex = collidingSlugs.indexOf(slug)
  const tokenPrefix = (parts: string[], length: number) =>
    parts.map((part) => part.slice(0, length)).join("")
  if (descriptors.every((parts) => parts.length === 1)) {
    const maxTokenLength = Math.max(
      ...descriptors.map((parts) => parts[0]!.length),
    )
    for (let index = 2; index < maxTokenLength; index += 1) {
      const signatures = descriptors.map(
        (parts) => `${parts[0]!.slice(0, 2)}${parts[0]![index] ?? ""}`,
      )
      if (new Set(signatures).size === signatures.length) {
        return signatures[targetIndex] ?? slug
      }
    }
  }

  for (
    let length = 1;
    length <= Math.max(...descriptors.flat().map((part) => part.length));
    length += 1
  ) {
    const suffix = tokenPrefix(descriptors[targetIndex] ?? [slug], length)
    if (
      descriptors.every(
        (parts, index) =>
          index === targetIndex || tokenPrefix(parts, length) !== suffix,
      )
    ) {
      return suffix
    }
  }

  return (descriptors[targetIndex] ?? [slug]).join("")
}

type BadgeCodeMaps = {
  badgeCodesBySlug: Map<string, string>
  slugsByBadgeCode: Map<string, string[]>
}

let badgeCodeMaps: BadgeCodeMaps | undefined

function getBadgeCodeMaps(): BadgeCodeMaps {
  if (badgeCodeMaps) return badgeCodeMaps

  const slugsByBadgeCode = new Map<string, string[]>()
  for (const [slug, tag] of Object.entries(LANGUAGE_BCP47_MAP)) {
    const code = badgeCodeFromTag(tag)
    if (code) {
      slugsByBadgeCode.set(code, [...(slugsByBadgeCode.get(code) ?? []), slug])
    }
  }

  const candidateBadgeCodesBySlug = new Map<string, string>()
  const slugsByCandidateBadgeCode = new Map<string, string[]>()
  for (const [slug, tag] of Object.entries(LANGUAGE_BCP47_MAP)) {
    const code = badgeCodeFromTag(tag)
    if (!code) continue
    const collidingSlugs = slugsByBadgeCode.get(code)
    const candidateCode =
      collidingSlugs && collidingSlugs.length > 1
        ? `${code}-${uniqueSlugSuffix(slug, collidingSlugs)}`
        : code
    candidateBadgeCodesBySlug.set(slug, candidateCode)
    slugsByCandidateBadgeCode.set(candidateCode, [
      ...(slugsByCandidateBadgeCode.get(candidateCode) ?? []),
      slug,
    ])
  }

  const badges = new Map<string, string>()
  for (const [slug, candidateCode] of candidateBadgeCodesBySlug) {
    const collidingSlugs = slugsByCandidateBadgeCode.get(candidateCode) ?? []
    if (collidingSlugs.length <= 1) {
      badges.set(slug, candidateCode)
      continue
    }

    const tag = LANGUAGE_BCP47_MAP[slug]
    const primary = primaryLanguageCode(tag) ?? candidateCode.split("-")[0]
    badges.set(slug, `${primary}-${uniqueSlugSuffix(slug, collidingSlugs)}`)
  }

  badgeCodeMaps = { badgeCodesBySlug: badges, slugsByBadgeCode }
  return badgeCodeMaps
}

/**
 * Prefer BCP 47 because it is the canonical public language identifier. When
 * a legacy row lacks it, the Watch slug map provides the same two-letter
 * primary subtag before falling back to ISO 639-3 metadata.
 */
export function languageCodeFor({
  bcp47,
  iso3,
  slug,
}: LanguageCodeSource): string | null {
  const bcp47Code = primaryLanguageCode(bcp47)
  if (bcp47Code) return bcp47Code

  const slugCode = slug ? primaryLanguageCode(slugToBcp47Primary(slug)) : null
  if (slugCode) return slugCode

  const iso3Code = primaryLanguageCode(iso3)
  if (iso3Code) return iso3Code

  const fallback = slug?.trim().match(/^[A-Za-z]{2,3}$/)?.[0]
  return fallback ? fallback.toUpperCase() : null
}

/**
 * Return a compact player-chrome code that preserves a BCP-47 variant when
 * one is present (for example `pt-PT` → `PT-PT`, `ar-arq` → `AR-ARQ`).
 * Languages whose data uses a distinct ISO 639-3 code already remain distinct
 * through `languageCodeFor` (for example French `FR` / French African `FRA`).
 */
export function languageBadgeCodeFor({
  bcp47,
  iso3,
  slug,
}: LanguageCodeSource): string | null {
  const maps = getBadgeCodeMaps()
  if (slug && maps.badgeCodesBySlug.has(slug)) {
    return maps.badgeCodesBySlug.get(slug) ?? null
  }

  const mappedSlugTag =
    slug && Object.hasOwn(LANGUAGE_BCP47_MAP, slug)
      ? slugToBcp47Tag(slug)
      : null
  const tag = mappedSlugTag ?? bcp47?.trim() ?? null
  const code = tag
    ? badgeCodeFromTag(tag)
    : languageCodeFor({ bcp47, iso3, slug })
  if (!code) return null

  const collidingSlugs = maps.slugsByBadgeCode.get(code)
  if (slug && collidingSlugs?.includes(slug) && collidingSlugs.length > 1) {
    return `${code}-${uniqueSlugSuffix(slug, collidingSlugs)}`
  }

  return code
}
