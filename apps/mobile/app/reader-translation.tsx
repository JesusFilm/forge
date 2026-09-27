import { useCallback, useMemo, useState } from "react"
import { View } from "react-native"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"

import { ReaderSheetMessage } from "../src/components/bible/sheets/ReaderSheetMessage"
import { TranslationPicker } from "../src/components/bible/sheets/TranslationPicker"
import {
  useReaderSheetTheme,
  useSheetCatalog,
} from "../src/components/bible/sheets/useReaderSheetData"
import { useWatchPreferences } from "../src/contexts/WatchPreferencesProvider"
import type { CatalogTranslation } from "../src/lib/bible/data/catalog"
import { READER_COPY } from "../src/lib/bible/reader/copy"
import { getReaderServices } from "../src/lib/bible/reader/services"
import { READER_SHEET_COPY } from "../src/lib/bible/sheets/copy"
import { parseReaderSheetParams } from "../src/lib/bible/sheets/routes"
import { viewerLanguageCodes } from "../src/lib/bible/sheets/translationList"

// feat-553 R23: the footer label's translation picker, a root form sheet
// (KTD9). A pick is the viewer's explicit choice (R41). The passage stays,
// because the saved position is in BSB numbering (R24, R38).
export default function ReaderTranslationRoute() {
  const router = useRouter()
  const request = parseReaderSheetParams(useLocalSearchParams())
  const services = getReaderServices()
  const { tokens } = useReaderSheetTheme(services.settingsStore)
  const { state, retry } = useSheetCatalog(services.loadCatalog)
  const { audioLanguageIso3 } = useWatchPreferences()
  const [phoneLanguage] = useState(() => services.readPhoneLanguage())
  const viewerLanguages = useMemo(
    () => viewerLanguageCodes([audioLanguageIso3, phoneLanguage]),
    [audioLanguageIso3, phoneLanguage],
  )

  const { positionStore } = services
  const onPick = useCallback(
    (translation: CatalogTranslation) => {
      positionStore.pickTranslation(translation.id)
      router.back()
    },
    [positionStore, router],
  )
  const close = useCallback(() => router.back(), [router])

  let body
  if (state.status === "ready") {
    body = (
      <TranslationPicker
        tokens={tokens}
        catalog={state.catalog}
        activeId={request.translationId}
        viewerLanguages={viewerLanguages}
        offline={request.offline}
        downloads={services.downloads}
        onPick={onPick}
        onClose={close}
      />
    )
  } else if (state.status === "failed") {
    body = (
      <ReaderSheetMessage
        tokens={tokens}
        sheetTitle={READER_SHEET_COPY.translation.title}
        title={READER_COPY.failure.catalogTitle}
        body={READER_COPY.failure.catalogBody}
        action={{ label: READER_COPY.failure.retry, onPress: retry }}
        onClose={close}
      />
    )
  } else {
    body = <View style={{ flex: 1, backgroundColor: tokens.background }} />
  }

  return (
    <>
      <Stack.Screen
        options={{ contentStyle: { backgroundColor: tokens.background } }}
      />
      {body}
    </>
  )
}
