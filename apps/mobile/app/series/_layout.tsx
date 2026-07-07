import { Stack } from "expo-router"

import { BG_COLOR } from "../../src/lib/color"
import { SeriesSessionProvider } from "../../src/contexts/SeriesSessionProvider"
import { LIST_SHEET_DETENTS } from "../../src/styles/shared"

const SHEET_BASE_OPTIONS = {
  headerShown: false,
  presentation: "formSheet",
  sheetInitialDetentIndex: 0,
  sheetGrabberVisible: true,
  sheetCornerRadius: 16,
} as const

// Long, scrollable language list → opt out of scroll-expands-to-edge so the
// first scroll at the smaller detent doesn't snap the sheet to full (same as
// the watch language/subtitle sheets).
const LIST_SHEET_OPTIONS = {
  ...SHEET_BASE_OPTIONS,
  sheetAllowedDetents: [...LIST_SHEET_DETENTS],
  sheetExpandsWhenScrolledToEdge: false,
}

// Mirrors app/watch/_layout.tsx: the download-all sheet opens at 0.65, grabber
// drags to full (keeps scroll-expands-to-edge on, like the per-video sheet).
const DOWNLOAD_SHEET_DETENTS = [0.65, 1] as const

// Mirrors app/watch/_layout.tsx: the series screen + its language sheet share a
// session context, so the Stack is wrapped in SeriesSessionProvider.
export default function SeriesLayout() {
  return (
    <SeriesSessionProvider>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: BG_COLOR },
        }}
      >
        {/* No native header: the hero sits at the top safe edge with a floating
            back button overlaid (mirrors app/watch/_layout.tsx + app/series/[slug]). */}
        <Stack.Screen name="[slug]" options={{ headerShown: false }} />
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
    </SeriesSessionProvider>
  )
}
