import { useCallback } from "react"

import { SearchableListSheet } from "../sheets/SearchableListSheet"
import type { WatchChildLanguage } from "../../lib/normalizeVideo"

// Series language rows over childDubLanguages (episode language union). Identity is
// the unique `slug`, not bcp47 (`ko` collides with `ko-kmr`), and there's no
// `hls`/`documentId` — hence a different key/guard than the watch LanguageSheet,
// expressed here as shell params rather than a forked copy.
function displayName(lang: WatchChildLanguage): string {
  return lang.name ?? lang.slug
}

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
      getSearchValues={getSearchValues}
      onSelect={handleSelect}
      searchPlaceholder="Search languages..."
      searchAccessibilityLabel="Search languages"
      emptySearchMessage="No languages found"
    />
  )
}
