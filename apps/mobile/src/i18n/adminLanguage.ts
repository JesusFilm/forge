import {
  ADMIN_LANGUAGE_FORMS,
  type AdminLanguageForms,
} from "./adminLanguages.generated"
import { getCatalogTag } from "./localeStore"

export type { AdminLanguageForms }
export { audioSlugForLocaleTag } from "./audioSlug"

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
