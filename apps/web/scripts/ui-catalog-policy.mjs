export const PROVISIONAL_CATALOG_POLICY =
  "Missing inventory locales are provisional UI catalogs seeded from the English source catalog. Existing authored catalogs are preserved and are not marked provisional. Before authoring a listed provisional locale, remove it from provisionalLocales and run the generator without --refresh-provisional to promote its ownership; --refresh-provisional overwrites every locale that remains listed."

export const COMPLETED_CATALOG_POLICY =
  "Every shipped UI catalog contains locale-specific copy. Existing authored translations are preserved; machineTranslatedLocales identifies catalogs completed with approved contextual AI translation and recommended for native-speaker review."

export function catalogPolicyFor(provisionalLocaleCount) {
  return provisionalLocaleCount > 0
    ? PROVISIONAL_CATALOG_POLICY
    : COMPLETED_CATALOG_POLICY
}

// These exact messages are valid Spanish as well as English. Keep the allowance
// tied to the locale, key, and both values so it cannot admit copied sentences.
const SPANISH_SHARED_MESSAGES = {
  "VideoLabels.video": "Video",
  "LanguageInventory.videoCount":
    "{count, plural, one {# video} other {# videos}}",
}

export function isLocaleSharedMessage(locale, key, source, value) {
  return (
    locale === "es" &&
    Object.hasOwn(SPANISH_SHARED_MESSAGES, key) &&
    SPANISH_SHARED_MESSAGES[key] === source &&
    value === source
  )
}
