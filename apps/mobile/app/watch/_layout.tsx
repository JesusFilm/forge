import { Stack } from "expo-router"

import { BACK_SWIPE_RESPONSE_DISTANCE } from "../../src/lib/backSwipe"
import { BG_COLOR } from "../../src/lib/color"
import { WatchSessionProvider } from "../../src/contexts/WatchSessionProvider"
import { LIST_SHEET_DETENTS } from "../../src/styles/shared"

// Native detents (react-native-screens): all sheets open at 0.65, grabber drags
// to full. LIST_SHEET_DETENTS is shared so sheets size lists per detent. Explicit
// fractional detents (not "fitToContents") dodge react-native-screens v4 Android bugs.
const DOWNLOAD_SHEET_DETENTS = [0.65, 1] as const

const SHEET_BASE_OPTIONS = {
  headerShown: false,
  presentation: "formSheet",
  sheetInitialDetentIndex: 0,
  sheetGrabberVisible: true,
  sheetCornerRadius: 16,
} as const

// Long language/subtitle lists opt OUT of scroll-expands-to-edge: otherwise the
// first scroll at the small detent snaps the sheet to full, making it useless.
// Off, the FlashList scrolls there and the user resizes via grabber. Download keeps it.
const LIST_SHEET_OPTIONS = {
  ...SHEET_BASE_OPTIONS,
  sheetAllowedDetents: [...LIST_SHEET_DETENTS],
  sheetExpandsWhenScrolledToEdge: false,
}

export default function WatchLayout() {
  return (
    <WatchSessionProvider>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: BG_COLOR },
        }}
      >
        {/* No native header: the video sits at the top safe edge with a
            floating back button overlaid on the player (see app/watch/[slug]). */}
        {/* Edge-confined back-swipe: iOS 26 defaults it to full-width, which
            claims rightward scrubs on episode→episode pops (src/lib/backSwipe). */}
        <Stack.Screen
          name="[slug]"
          options={{
            headerShown: false,
            gestureResponseDistance: BACK_SWIPE_RESPONSE_DISTANCE,
          }}
        />
        <Stack.Screen name="language" options={LIST_SHEET_OPTIONS} />
        <Stack.Screen name="subtitle" options={LIST_SHEET_OPTIONS} />
        <Stack.Screen
          name="download"
          options={{
            ...SHEET_BASE_OPTIONS,
            sheetAllowedDetents: [...DOWNLOAD_SHEET_DETENTS],
          }}
        />
      </Stack>
    </WatchSessionProvider>
  )
}
