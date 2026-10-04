import { Stack } from "expo-router"

import { pauseColors } from "../../src/lib/dailyPause/theme"

// R27's Customize sheet opens over the Opening, as a native form sheet. The
// shape is the watch group's download sheet.
const CUSTOMIZE_SHEET_OPTIONS = {
  headerShown: false,
  presentation: "formSheet" as const,
  sheetAllowedDetents: [0.65, 1],
  sheetInitialDetentIndex: 0,
  sheetGrabberVisible: true,
  sheetCornerRadius: 16,
  contentStyle: { backgroundColor: pauseColors.sheet },
}

export default function DailyPauseLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: pauseColors.background },
      }}
    >
      {/* KTD4: the steps are states of this one screen, so no swipe can move
          between them, and only the close leaves. */}
      <Stack.Screen name="index" options={{ gestureEnabled: false }} />
      <Stack.Screen name="customize" options={CUSTOMIZE_SHEET_OPTIONS} />
    </Stack>
  )
}
