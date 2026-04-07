import { useRef } from "react"
import { Pressable } from "react-native"
import { Stack, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import Ionicons from "@expo/vector-icons/Ionicons"
import { ApolloProvider } from "@apollo/client/react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { getApolloClient } from "../src/lib/apolloClient"
import { ExperienceShell } from "../src/contexts/ExperienceShell"

export const unstable_settings = {
  initialRouteName: "(tabs)",
}

export default function RootLayout() {
  const clientRef = useRef(getApolloClient())
  const router = useRouter()
  return (
    <ApolloProvider client={clientRef.current}>
      <SafeAreaProvider>
        <ExperienceShell>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: "#1c1917" },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="video/[sectionKey]"
              options={{
                headerShown: true,
                headerTransparent: true,
                headerTintColor: "#CB333B",
                headerTitle: "",
                headerStyle: { backgroundColor: "transparent" },
                headerLeft: () => (
                  <Pressable
                    onPress={() => router.back()}
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                    hitSlop={8}
                  >
                    <Ionicons name="chevron-back" size={28} color="#CB333B" />
                  </Pressable>
                ),
              }}
            />
          </Stack>
        </ExperienceShell>
      </SafeAreaProvider>
    </ApolloProvider>
  )
}
