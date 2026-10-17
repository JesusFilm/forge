import { View } from "react-native"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"

import { PassagePicker } from "../src/components/bible/sheets/PassagePicker"
import {
  useReaderSheetTheme,
  useSheetCatalog,
} from "../src/components/bible/sheets/useReaderSheetData"
import { getReaderServices } from "../src/lib/bible/reader/services"
import { useBookNames } from "../src/lib/bible/reader/useBookNames"
import {
  pickerBookNames,
  pickerCurrent,
} from "../src/lib/bible/sheets/passageSteps"
import { parseReaderSheetParams } from "../src/lib/bible/sheets/routes"

// feat-553 R17: the pill's passage picker, a root form sheet (KTD9) over the
// Bible tab or the pushed reader. The pick moves the shared position.
export default function ReaderPassageRoute() {
  const router = useRouter()
  const request = parseReaderSheetParams(useLocalSearchParams())
  const services = getReaderServices()
  const { tokens } = useReaderSheetTheme(services.settingsStore)
  const { state } = useSheetCatalog(services.loadCatalog)

  // While a stand-in shows a book (R25), the picker follows the viewer's own
  // pick (owner, 2026-09-28). A book the pick lacks keeps the stand-in's names
  // and numbers, as the pill does.
  const standIn = request.viewerTranslationId !== null
  const catalog = state.status === "ready" ? state.catalog : null
  const find = (id: string | null) =>
    id ? (catalog?.byId.get(id) ?? null) : null
  const translation = find(request.viewerTranslationId ?? request.translationId)
  const shown = find(request.translationId)
  const standInTranslation = standIn ? shown : null
  // The reader already read them, so these are memory hits on most opens.
  const pickNames = useBookNames(services.bookNames, translation)
  const standInNames = useBookNames(services.bookNames, standInTranslation)
  const bookNames = pickerBookNames({
    translation,
    names: pickNames,
    standIn: standInTranslation,
    standInNames,
  })

  return (
    <>
      <Stack.Screen
        options={{ contentStyle: { backgroundColor: tokens.background } }}
      />
      {state.status === "loading" ? (
        <View style={{ flex: 1, backgroundColor: tokens.background }} />
      ) : (
        <PassagePicker
          tokens={tokens}
          translation={translation}
          standIn={standInTranslation}
          bookNames={bookNames}
          // With no known translation the picker shows BSB's numbers.
          current={pickerCurrent({
            translation,
            ref: request.ref,
            shownRef: request.translationRef,
            standIn,
            shown,
          })}
          onPick={(ref) => {
            services.positionStore.moveTo(ref)
            router.back()
          }}
          onClose={() => router.back()}
        />
      )}
    </>
  )
}
