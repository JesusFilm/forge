/**
 * KTD7's reviewed map from an OS language code to one Language slug, because
 * a BCP-47 tag is not an identity (CONCEPTS.md "Language"). Admin has no
 * lookup by tag.
 */

// Each slug was checked with `watchLanguageInventory` on production, 2026-09-25.
// Where two Languages share a code, the entry names the larger dubbed bucket.
// Keyed on the lowercase language subtag.
export const DEVICE_LANGUAGE_SLUGS: Readonly<Record<string, string>> =
  Object.freeze({
    am: "amharic",
    ar: "arabic-modern-standard",
    bn: "bangla-2",
    de: "german-standard",
    en: "english",
    // spanish-latin-american (bcp47 `es`): 631 videos; spanish-castilian: 244.
    es: "spanish-latin-american",
    fa: "farsi-western",
    fil: "tagalog",
    fr: "french",
    hi: "hindi",
    // indonesian-yesus: 330 videos; indonesian-isa (web's UI choice): 206.
    id: "indonesian-yesus",
    it: "italian",
    ja: "japanese",
    ko: "korean",
    ms: "malay",
    ne: "nepali",
    nl: "dutch",
    pl: "polish",
    pt: "portuguese-brazil",
    ru: "russian",
    // There is no plain `swahili` slug.
    sw: "swahili-tanzania",
    th: "thai",
    tl: "tagalog",
    tr: "turkish",
    uk: "ukrainian",
    ur: "urdu",
    vi: "vietnamese",
    // Chinese subtitle tracks use chinese-simplified and chinese-traditional;
    // the dubbed Mandarin inventory is mandarin-china (561 videos).
    zh: "mandarin-china",
  })

/** `language-region`, lowercase. Only where a region names another Language. */
export const DEVICE_REGION_LANGUAGE_SLUGS: Readonly<Record<string, string>> =
  Object.freeze({
    "es-es": "spanish-castilian",
    "pt-pt": "portuguese-portugal",
  })

function own(map: Readonly<Record<string, string>>, key: string) {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null
}

/** The mapped slug for a locale tag such as `es-ES` or `zh-Hans-CN`, or null. */
export function languageSlugForLocale(
  locale: string | null | undefined,
): string | null {
  const parts = (locale ?? "").trim().toLowerCase().split(/[-_]/)
  const language = parts[0]
  if (!language) return null
  // A region is 2 letters or 3 digits; a 4-letter part is a script.
  const region = parts
    .slice(1)
    .find((part) => /^[a-z]{2}$/.test(part) || /^\d{3}$/.test(part))
  if (region != null) {
    const refined = own(DEVICE_REGION_LANGUAGE_SLUGS, `${language}-${region}`)
    if (refined != null) return refined
  }
  return own(DEVICE_LANGUAGE_SLUGS, language)
}
