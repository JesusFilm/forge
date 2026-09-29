import {
  ADMIN_LANGUAGE_FORMS,
  AUDIO_SLUG_BY_TAG,
  type AdminLanguageForms,
} from "./adminLanguages.generated"
import { getCatalogTag } from "./localeStore"

export type { AdminLanguageForms }

function own<T>(table: Readonly<Record<string, T>>, key: string): T | null {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null
}

export const ENGLISH_ADMIN_FORMS: AdminLanguageForms = own(
  ADMIN_LANGUAGE_FORMS,
  "en",
) ?? {
  catalogTag: "en",
  forYouLocale: "en",
  textSlug: "english",
  rawTag: "en",
}

/** The Admin language forms for a catalog tag; English for a tag with no catalog. */
export function adminFormsFor(catalogTag: string): AdminLanguageForms {
  return own(ADMIN_LANGUAGE_FORMS, catalogTag) ?? ENGLISH_ADMIN_FORMS
}

/** The forms for the catalog in use. It reads the store on each call (KTD2). */
export function currentAdminForms(): AdminLanguageForms {
  return adminFormsFor(getCatalogTag())
}

/**
 * The default-audio slug for a phone language tag such as `es-ES` or
 * `zh-Hans-CN`: the exact tag first, then its language subtag, else null.
 */
export function audioSlugForLocaleTag(
  tag: string | null | undefined,
): string | null {
  const exact = (tag ?? "").trim().toLowerCase().replace(/_/g, "-")
  if (exact === "") return null
  const language = exact.split("-")[0]
  return (
    own(AUDIO_SLUG_BY_TAG, exact) ??
    (language ? own(AUDIO_SLUG_BY_TAG, language) : null)
  )
}
