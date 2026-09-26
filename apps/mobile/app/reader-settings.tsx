import { Stack, useLocalSearchParams, useRouter } from "expo-router"

import { ReaderSettingsSheet } from "../src/components/bible/sheets/ReaderSettingsSheet"
import {
  useReaderSheetTheme,
  useSheetCatalog,
} from "../src/components/bible/sheets/useReaderSheetData"
import { useIsTabletLayout } from "../src/hooks/useIsTabletLayout"
import { getReaderServices } from "../src/lib/bible/reader/services"
import { parseReaderSheetParams } from "../src/lib/bible/sheets/routes"
import { BSB_TRANSLATION_ID } from "../src/lib/bible/versification/classify"

// feat-553 R33: the reader settings, a root form sheet (KTD9). Each change
// goes to the settings store that both reader hosts read.
export default function ReaderSettingsRoute() {
  const router = useRouter()
  const request = parseReaderSheetParams(useLocalSearchParams())
  const services = getReaderServices()
  const { settings, tokens } = useReaderSheetTheme(services.settingsStore)
  const { state } = useSheetCatalog(services.loadCatalog)
  const layout = useIsTabletLayout() ? "tablet" : "phone"

  const shown =
    state.status === "ready" && request.translationId
      ? state.catalog.byId.get(request.translationId)
      : undefined
  // BSB has its own line in "About the text".
  const currentCredit =
    shown && shown.id !== BSB_TRANSLATION_ID
      ? { name: shown.name, credit: shown.credit }
      : null

  return (
    <>
      <Stack.Screen
        options={{ contentStyle: { backgroundColor: tokens.background } }}
      />
      <ReaderSettingsSheet
        tokens={tokens}
        settings={settings}
        layout={layout}
        currentCredit={currentCredit}
        onChange={(patch) => {
          services.settingsStore.update(patch)
        }}
        onClose={() => router.back()}
      />
    </>
  )
}
