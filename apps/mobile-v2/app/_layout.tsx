import { useRef } from "react"
import { Pressable } from "react-native"
import { Stack, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import Ionicons from "@expo/vector-icons/Ionicons"
import { ApolloProvider } from "@apollo/client/react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { getApolloClient } from "../src/lib/apolloClient"
import { ACCENT, BG_COLOR } from "../src/lib/color"
import { ExperienceShell } from "../src/contexts/ExperienceShell"
import { ExperienceSelectionProvider } from "../src/contexts/ExperienceSelectionProvider"

export const unstable_settings = {
  initialRouteName: "(tabs)",
}

export default function RootLayout() {
  const clientRef = useRef(getApolloClient())
  const router = useRouter()
  return (
    <ApolloProvider client={clientRef.current}>
      <SafeAreaProvider>
        <ExperienceSelectionProvider>
          <ExperienceShell>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: BG_COLOR },
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="video/[sectionKey]"
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
                name="collection/[sectionKey]"
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
          </ExperienceShell>
        </ExperienceSelectionProvider>
      </SafeAreaProvider>
    </ApolloProvider>
  )
}
