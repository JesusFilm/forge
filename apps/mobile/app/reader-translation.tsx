import { useCallback, useMemo, useState } from "react"
import { Alert, View } from "react-native"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"

import { ReaderSheetMessage } from "../src/components/bible/sheets/ReaderSheetMessage"
import { TranslationPicker } from "../src/components/bible/sheets/TranslationPicker"
import {
  useReaderSheetTheme,
  useSheetCatalog,
} from "../src/components/bible/sheets/useReaderSheetData"
import { useWatchPreferences } from "../src/contexts/WatchPreferencesProvider"
import { useT } from "../src/i18n/useT"
import type { CatalogTranslation } from "../src/lib/bible/data/catalog"
import { getReaderServices } from "../src/lib/bible/reader/services"
import { openTranslationDownload } from "../src/lib/bible/routes/sheetCallbacks"
import { partialSwitch } from "../src/lib/bible/sheets/partialSwitch"
import { parseReaderSheetParams } from "../src/lib/bible/sheets/routes"
import { viewerLanguageCodes } from "../src/lib/bible/sheets/translationList"

// feat-553 R23: the translation pill's picker, a root form sheet (KTD9). A
// pick is the viewer's explicit choice (R41). The passage stays (R24, R38),
// unless a partial Bible lacks its book; see `partialSwitch`.
export default function ReaderTranslationRoute() {
  const t = useT("BibleTranslationPicker")
  const reader = useT("BibleReader")
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

  const { positionStore, repository } = services
  const { ref, translationRef } = request
  // The owner (2026-09-28): a partial Bible that lacks the current book opens
  // at its own start, after a warning. Any other pick keeps the passage.
  const switchFor = useCallback(
    (translation: CatalogTranslation) =>
      partialSwitch(t, {
        translation,
        ref,
        shownRef: translationRef,
        hasBook: repository.translationHasBook,
      }),
    [t, ref, translationRef, repository],
  )
  const confirmPick = useCallback(
    (translation: CatalogTranslation, proceed: () => void) => {
      const warning = switchFor(translation)
      if (!warning) {
        proceed()
        return
      }
      Alert.alert(warning.title, warning.message, [
        { text: warning.cancelLabel, style: "cancel" },
        { text: warning.confirmLabel, onPress: proceed },
      ])
    },
    [switchFor],
  )
  const onPick = useCallback(
    (translation: CatalogTranslation) => {
      const warning = switchFor(translation)
      if (warning) {
        positionStore.pickTranslationAt(translation.id, warning.start.bsb)
      } else {
        positionStore.pickTranslation(translation.id)
      }
      router.back()
    },
    [positionStore, router, switchFor],
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
        confirmPick={confirmPick}
        onPressDownload={openTranslationDownload}
        onClose={close}
      />
    )
  } else if (state.status === "failed") {
    body = (
      <ReaderSheetMessage
        tokens={tokens}
        sheetTitle={t("title")}
        title={reader("catalogTitle")}
        body={reader("catalogBody")}
        action={{
          label: reader("retry"),
          actionName: "bible-translation-catalog-retry",
          onPress: retry,
        }}
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
