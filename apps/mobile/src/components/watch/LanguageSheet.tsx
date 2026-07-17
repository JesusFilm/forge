import { useCallback } from "react"

import { SearchableListSheet } from "../sheets/SearchableListSheet"
import type { WatchVariant } from "../../lib/normalizeVideo"

function displayName(v: WatchVariant): string {
  return v.languageName ?? "Unknown"
}

// Dub rows keyed by slug for selection, documentId for the list key; a variant
// without `hls` isn't playable, so it silently ignores taps.
const getSelectionId = (v: WatchVariant) => v.slug
const getKey = (v: WatchVariant) => v.documentId
const getSecondaryLabel = (v: WatchVariant) => v.languageNameNative
const getSearchValues = (v: WatchVariant) => [
  displayName(v),
  v.languageNameNative,
]
const isSelectable = (v: WatchVariant) => !!v.hls

export type LanguageSheetProps = {
  variants: WatchVariant[]
  activeVariantSlug: string
  onLanguageChange: (variantSlug: string) => void
  onClose: () => void
}

export function LanguageSheetContent({
  variants,
  activeVariantSlug,
  onLanguageChange,
  onClose,
}: LanguageSheetProps) {
  const handleSelect = useCallback(
    (variant: WatchVariant) => {
      onLanguageChange(variant.slug)
      onClose()
    },
    [onLanguageChange, onClose],
  )

  return (
    <SearchableListSheet
      rows={variants}
      activeId={activeVariantSlug}
      getSelectionId={getSelectionId}
      getKey={getKey}
      getPrimaryLabel={displayName}
      getSecondaryLabel={getSecondaryLabel}
      getSearchValues={getSearchValues}
      isSelectable={isSelectable}
      onSelect={handleSelect}
      searchPlaceholder="Search languages..."
      searchAccessibilityLabel="Search languages"
      emptySearchMessage="No languages found"
    />
  )
}
