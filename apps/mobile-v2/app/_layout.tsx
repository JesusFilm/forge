import { useRef } from "react"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { ApolloProvider } from "@apollo/client/react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { getApolloClient } from "../src/lib/apolloClient"
import { ExperienceShell } from "../src/contexts/ExperienceShell"

export const unstable_settings = {
  initialRouteName: "(tabs)",
}

export default function RootLayout() {
  const clientRef = useRef(getApolloClient())
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
              }}
            />
          </Stack>
        </ExperienceShell>
      </SafeAreaProvider>
    </ApolloProvider>
  )
}
