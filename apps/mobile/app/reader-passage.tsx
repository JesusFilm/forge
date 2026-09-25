import { View } from "react-native"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"

import { PassagePicker } from "../src/components/bible/sheets/PassagePicker"
import {
  useReaderSheetTheme,
  useSheetCatalog,
} from "../src/components/bible/sheets/useReaderSheetData"
import { getReaderServices } from "../src/lib/bible/reader/services"
import { parseReaderSheetParams } from "../src/lib/bible/sheets/routes"

// feat-551 R17: the pill's passage picker, a root form sheet (KTD9) over the
// Bible tab or the pushed reader. The pick moves the shared position.
export default function ReaderPassageRoute() {
  const router = useRouter()
  const request = parseReaderSheetParams(useLocalSearchParams())
  const services = getReaderServices()
  const { tokens } = useReaderSheetTheme(services.settingsStore)
  const { state } = useSheetCatalog(services.loadCatalog)

  const translation =
    state.status === "ready" && request.translationId
      ? (state.catalog.byId.get(request.translationId) ?? null)
      : null

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
          // With no known translation the picker shows BSB's numbers.
          current={translation ? request.translationRef : request.ref}
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
