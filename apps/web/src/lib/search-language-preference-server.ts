import "server-only"
import { cookies } from "next/headers"

import { SEARCH_LANGUAGE_PREFERENCE_COOKIE } from "./search-language-preference-constants"

export { SEARCH_LANGUAGE_PREFERENCE_COOKIE }

export async function readSearchLanguagePreferenceSlug(): Promise<
  string | null
> {
  try {
    const store = await cookies()
    return store.get(SEARCH_LANGUAGE_PREFERENCE_COOKIE)?.value ?? null
  } catch {
    return null
  }
}
