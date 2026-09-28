import { View } from "react-native"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"

import { PassagePicker } from "../src/components/bible/sheets/PassagePicker"
import {
  useReaderSheetTheme,
  useSheetCatalog,
} from "../src/components/bible/sheets/useReaderSheetData"
import { getReaderServices } from "../src/lib/bible/reader/services"
import { useBookNames } from "../src/lib/bible/reader/useBookNames"
import { pickerCurrent } from "../src/lib/bible/sheets/passageSteps"
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
  // pick: its books, names, and numbers (owner, 2026-09-28).
  const standIn = request.viewerTranslationId !== null
  const pickerId = request.viewerTranslationId ?? request.translationId
  const translation =
    state.status === "ready" && pickerId
      ? (state.catalog.byId.get(pickerId) ?? null)
      : null
  // The reader already read them, so this is a memory hit on most opens.
  const bookNames = useBookNames(services.bookNames, translation)

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
          bookNames={bookNames}
          // With no known translation the picker shows BSB's numbers.
          current={pickerCurrent({
            translation,
            ref: request.ref,
            shownRef: request.translationRef,
            standIn,
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
