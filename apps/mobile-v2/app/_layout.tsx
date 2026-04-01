import { useEffect, useState } from "react"
import { ActivityIndicator, View, StyleSheet } from "react-native"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { ApolloProvider } from "@apollo/client/react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import type { ApolloClient } from "@apollo/client"
import { getApolloClient } from "../src/lib/apolloClient"

export const unstable_settings = {
  initialRouteName: "(tabs)",
}

export default function RootLayout() {
  const [client, setClient] = useState<ApolloClient | null>(null)

  useEffect(() => {
    let cancelled = false
    getApolloClient().then((c) => {
      if (!cancelled) setClient(c)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!client) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#CB333B" />
      </View>
    )
  }

  return (
    <ApolloProvider client={client}>
      <SafeAreaProvider>
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
              headerTintColor: "#f5f5f4",
              headerTitle: "",
              headerStyle: { backgroundColor: "transparent" },
            }}
          />
        </Stack>
      </SafeAreaProvider>
    </ApolloProvider>
  )
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1c1917",
  },
})
