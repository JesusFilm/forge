import { useCallback, useMemo, useState } from "react"
import { StyleSheet, Switch, Text, View } from "react-native"

import type {
  Catalog,
  CatalogTranslation,
} from "../../../lib/bible/data/catalog"
import type { TranslationDownloads } from "../../../lib/bible/repository/translationDownloads"
import { READER_SHEET_COPY } from "../../../lib/bible/sheets/copy"
import {
  readerSheetColors,
  readerSheetControlColors,
} from "../../../lib/bible/sheets/theme"
import {
  buildTranslationList,
  translationLanguageLabel,
  translationSearchValues,
  translationStatusLabel,
} from "../../../lib/bible/sheets/translationList"
import type { ReaderTokens } from "../../../lib/bible/theme/palettes"
import { SearchableListSheet } from "../../sheets/SearchableListSheet"
import { ReaderSheetHeader } from "./ReaderSheetHeader"
import { useDownloadsVersion } from "./useDownloadsVersion"

const COPY = READER_SHEET_COPY.translation

export type TranslationPickerProps = {
  tokens: ReaderTokens
  catalog: Catalog
  /** The shown translation, hoisted into the "Current" row. */
  activeId: string | null
  /** From `viewerLanguageCodes`: these languages list first (R23). */
  viewerLanguages: readonly string[]
  /** The reader got no network answer: start with the device filter on. */
  offline: boolean
  downloads: Pick<TranslationDownloads, "getState" | "subscribe" | "check">
  onPick: (translation: CatalogTranslation) => void
  onClose: () => void
}

const getId = (translation: CatalogTranslation) => translation.id
const getName = (translation: CatalogTranslation) => translation.name
const getCredit = (translation: CatalogTranslation) => translation.credit

// R23's picker, in the reader's theme. Each row shows the name, the language,
// complete or partial with the download state, and the credit.
export function TranslationPicker({
  tokens,
  catalog,
  activeId,
  viewerLanguages,
  offline,
  downloads,
  onPick,
  onClose,
}: TranslationPickerProps) {
  const [onDeviceOnly, setOnDeviceOnly] = useState(offline)
  const version = useDownloadsVersion(downloads)

  const rows = useMemo(() => {
    const list = buildTranslationList({
      catalog,
      viewerLanguages,
      onDeviceOnly,
      getState: downloads.getState,
    })
    // The "Current" row reads from the rows, so keep it when the filter hides it.
    const active = activeId ? catalog.byId.get(activeId) : undefined
    return active && !list.includes(active) ? [active, ...list] : list
    // `version` makes both memos read the store again after a change.
  }, [catalog, viewerLanguages, onDeviceOnly, downloads, activeId, version])

  const getStatus = useCallback(
    (translation: CatalogTranslation) =>
      translationStatusLabel(translation, downloads.getState(translation.id)),
    [downloads, version],
  )

  const colors = readerSheetColors(tokens)
  const controls = readerSheetControlColors(tokens)

  const headerTop = (
    <View style={styles.headerTop}>
      <ReaderSheetHeader tokens={tokens} title={COPY.title} onClose={onClose} />
      {offline && (
        <Text style={[styles.note, { color: tokens.secondaryText }]}>
          {COPY.offlineNote}
        </Text>
      )}
      <View style={styles.filterRow}>
        <Text style={[styles.filterLabel, { color: tokens.text }]}>
          {COPY.onDeviceOnly}
        </Text>
        <Switch
          value={onDeviceOnly}
          onValueChange={setOnDeviceOnly}
          trackColor={{ false: controls.switchOff, true: controls.switchOn }}
          ios_backgroundColor={controls.switchOff}
          thumbColor="#ffffff"
          accessibilityRole="switch"
          accessibilityLabel={COPY.onDeviceOnly}
        />
      </View>
    </View>
  )

  return (
    <View style={[styles.root, { backgroundColor: tokens.background }]}>
      <SearchableListSheet<CatalogTranslation>
        rows={rows}
        keepRowOrder
        activeId={activeId}
        getSelectionId={getId}
        getKey={getId}
        getPrimaryLabel={getName}
        getSecondaryLabel={translationLanguageLabel}
        getStatusLabel={getStatus}
        getDetailLabel={getCredit}
        getSearchValues={translationSearchValues}
        onSelect={onPick}
        searchPlaceholder={COPY.searchPlaceholder}
        searchAccessibilityLabel={COPY.searchLabel}
        emptySearchMessage={COPY.noMatch}
        headerTop={headerTop}
        colors={colors}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  headerTop: {
    // SearchableListSheet's header already clears the grabber.
    marginTop: -20,
    marginBottom: 8,
    gap: 4,
  },
  note: {
    fontFamily: "System",
    fontSize: 14,
    lineHeight: 20,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 48,
  },
  filterLabel: {
    flex: 1,
    fontFamily: "System",
    fontSize: 16,
  },
})
