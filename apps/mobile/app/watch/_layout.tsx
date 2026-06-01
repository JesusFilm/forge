import { Stack, useRouter } from "expo-router"
import { Pressable } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { ACCENT, BG_COLOR } from "../../src/lib/color"
import { WatchSessionProvider } from "../../src/contexts/WatchSessionProvider"

// Native detents (react-native-screens) — same heights the gorhom sheets used.
// Explicit fractional detents (not "fitToContents") avoid the Android
// keyboard/empty-sheet bugs in react-native-screens v4.
const LIST_SHEET_DETENTS = [0.5, 1] as const
const DOWNLOAD_SHEET_DETENTS = [0.75, 1] as const

const SHEET_BASE_OPTIONS = {
  headerShown: false,
  presentation: "formSheet",
  sheetInitialDetentIndex: 0,
  sheetGrabberVisible: true,
  sheetCornerRadius: 16,
} as const

export default function WatchLayout() {
  const router = useRouter()

  return (
    <WatchSessionProvider>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: BG_COLOR },
        }}
      >
        <Stack.Screen
          name="[slug]"
          options={{
            headerShown: true,
            headerTintColor: ACCENT,
            headerTitle: "",
            headerStyle: { backgroundColor: BG_COLOR },
            headerShadowVisible: false,
            headerTitleAlign: "center",
            headerLeft: () => (
              <Pressable
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                hitSlop={12}
              >
                <Ionicons name="chevron-back" size={28} color={ACCENT} />
              </Pressable>
            ),
          }}
        />
        <Stack.Screen
          name="language"
          options={{
            ...SHEET_BASE_OPTIONS,
            sheetAllowedDetents: [...LIST_SHEET_DETENTS],
          }}
        />
        <Stack.Screen
          name="subtitle"
          options={{
            ...SHEET_BASE_OPTIONS,
            sheetAllowedDetents: [...LIST_SHEET_DETENTS],
          }}
        />
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
