import { Stack, useRouter } from "expo-router"
import { Pressable } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { ACCENT, BG_COLOR } from "../../src/lib/color"
import { SeriesSessionProvider } from "../../src/contexts/SeriesSessionProvider"

// Mirrors app/watch/_layout.tsx: the series screen + its language sheet share a
// session context, so the Stack is wrapped in SeriesSessionProvider. The
// `language` formSheet route is registered in U5 when the sheet lands.
export default function SeriesLayout() {
  const router = useRouter()

  return (
    <SeriesSessionProvider>
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
      </Stack>
    </SeriesSessionProvider>
  )
}
