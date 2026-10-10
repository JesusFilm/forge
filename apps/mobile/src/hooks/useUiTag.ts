import { getCatalogTag } from "../i18n/localeStore"
import { useLocaleEpoch } from "../i18n/useT"

/** The UI catalog tag, e.g. `zh-Hans`, for name sorts in React code (KTD15). */
export function useUiTag(): string {
  // The epoch changes exactly when the tag does, so this re-renders then.
  useLocaleEpoch()
  return getCatalogTag()
}
