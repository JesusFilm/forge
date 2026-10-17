import { useCallback } from "react"

import { SearchableListSheet } from "../sheets/SearchableListSheet"
import { useUiTag } from "../../hooks/useUiTag"
import { useT } from "../../i18n/useT"
import type { WatchVariant } from "../../lib/normalizeVideo"

// Dub rows keyed by slug for selection, documentId for the list key; a variant
// without `hls` isn't playable, so it silently ignores taps.
const getSelectionId = (v: WatchVariant) => v.slug
const getKey = (v: WatchVariant) => v.documentId
const getSecondaryLabel = (v: WatchVariant) => v.languageNameNative
const isSelectable = (v: WatchVariant) => !!v.hls

export type LanguageSheetProps = {
  variants: WatchVariant[]
  activeVariantSlug: string
  /** The dub of the file on disk (null with no download), so the viewer can
   *  see which one plays offline. Required, so a route cannot drop the mark. */
  downloadedDubDocumentId: string | null
  onLanguageChange: (variantSlug: string) => void
  onClose: () => void
}

export function LanguageSheetContent({
  variants,
  activeVariantSlug,
  downloadedDubDocumentId,
  onLanguageChange,
  onClose,
}: LanguageSheetProps) {
  const t = useT("Watch")
  const uiTag = useUiTag()
  const displayName = useCallback(
    (v: WatchVariant) => v.languageName ?? t("unknownLanguage"),
    [t],
  )
  // The "unknown language" fallback is UI text, in the catalog language.
  const displayLang = useCallback(
    (v: WatchVariant) => (v.languageName != null ? v.languageNameLang : uiTag),
    [uiTag],
  )
  const getSearchValues = useCallback(
    (v: WatchVariant) => [displayName(v), v.languageNameNative],
    [displayName],
  )
  const handleSelect = useCallback(
    (variant: WatchVariant) => {
      onLanguageChange(variant.slug)
      onClose()
    },
    [onLanguageChange, onClose],
  )
  const getStatusLabel = useCallback(
    (v: WatchVariant) =>
      downloadedDubDocumentId != null &&
      v.documentId === downloadedDubDocumentId
        ? t("downloadedStatus")
        : null,
    [downloadedDubDocumentId, t],
  )

  return (
    <SearchableListSheet
      rows={variants}
      activeId={activeVariantSlug}
      getSelectionId={getSelectionId}
      getKey={getKey}
      getPrimaryLabel={displayName}
      getPrimaryLang={displayLang}
      getSecondaryLabel={getSecondaryLabel}
      getStatusLabel={getStatusLabel}
      getSearchValues={getSearchValues}
      isSelectable={isSelectable}
      onSelect={handleSelect}
      searchPlaceholder={t("searchLanguagesPlaceholder")}
      searchAccessibilityLabel={t("searchLanguagesAriaLabel")}
      emptySearchMessage={t("noLanguagesFound")}
      actionName="watch-language-sheet"
    />
  )
}
