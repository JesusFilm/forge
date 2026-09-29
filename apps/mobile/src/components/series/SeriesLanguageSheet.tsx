import { useCallback } from "react"

import { useT } from "../../i18n/useT"
import { SearchableListSheet } from "../sheets/SearchableListSheet"
import type { WatchChildLanguage } from "../../lib/normalizeVideo"

// Series language rows over childDubLanguages. Identity is the unique `slug`, not
// bcp47 (`ko` collides with `ko-kmr`); no `hls`/`documentId` — hence a different
// key/guard than the watch LanguageSheet, passed as shell params not a fork.
function displayName(lang: WatchChildLanguage): string {
  return lang.name ?? lang.slug
}

// A slug stand-in has no known language.
const displayLang = (lang: WatchChildLanguage) =>
  lang.name != null ? lang.nameLang : null
const getSlug = (lang: WatchChildLanguage) => lang.slug
const getSearchValues = (lang: WatchChildLanguage) => [displayName(lang)]

export type SeriesLanguageSheetProps = {
  languages: WatchChildLanguage[]
  activeLanguageSlug: string
  onLanguageChange: (slug: string) => void
  onClose: () => void
}

export function SeriesLanguageSheet({
  languages,
  activeLanguageSlug,
  onLanguageChange,
  onClose,
}: SeriesLanguageSheetProps) {
  const t = useT("Series")
  const handleSelect = useCallback(
    (lang: WatchChildLanguage) => {
      // Exact slug match — never bcp47.
      onLanguageChange(lang.slug)
      onClose()
    },
    [onLanguageChange, onClose],
  )

  return (
    <SearchableListSheet
      rows={languages}
      activeId={activeLanguageSlug}
      getSelectionId={getSlug}
      getKey={getSlug}
      getPrimaryLabel={displayName}
      getPrimaryLang={displayLang}
      getSearchValues={getSearchValues}
      onSelect={handleSelect}
      searchPlaceholder={t("searchLanguagesPlaceholder")}
      searchAccessibilityLabel={t("searchLanguagesAriaLabel")}
      emptySearchMessage={t("noLanguagesFound")}
      actionName="series-language-sheet"
    />
  )
}
