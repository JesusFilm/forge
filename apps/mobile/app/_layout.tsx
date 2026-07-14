import { Component, useEffect, useRef, useState } from "react"
import { Pressable, Text, View, ScrollView } from "react-native"
import type { ErrorInfo, ReactNode } from "react"

let moduleError: string | null = null

let Stack: typeof import("expo-router").Stack
let useRouter: typeof import("expo-router").useRouter
let StatusBar: typeof import("expo-status-bar").StatusBar
let Ionicons: typeof import("@expo/vector-icons/Ionicons").default
let ApolloProvider: typeof import("@apollo/client/react").ApolloProvider
let SafeAreaProvider: typeof import("react-native-safe-area-context").SafeAreaProvider
let getApolloClient: typeof import("../src/lib/apolloClient").getApolloClient
let ACCENT: string
let BG_COLOR: string
let ExperienceShell: typeof import("../src/contexts/ExperienceShell").ExperienceShell
let ExperienceSelectionProvider: typeof import("../src/contexts/ExperienceSelectionProvider").ExperienceSelectionProvider
let WatchPreferencesProvider: typeof import("../src/contexts/WatchPreferencesProvider").WatchPreferencesProvider
let DownloadsProvider: typeof import("../src/contexts/DownloadsProvider").DownloadsProvider
let isCachePersistenceEnabled: typeof import("../src/lib/cachePersistence").isCachePersistenceEnabled
let restoreApolloCache: typeof import("../src/lib/cachePersistence").restoreApolloCache
let startCachePersistence: typeof import("../src/lib/cachePersistence").startCachePersistence
let lockPortrait: typeof import("../src/lib/orientation").lockPortrait
let MobileDatadogProvider: typeof import("../src/components/DatadogRum").MobileDatadogProvider
let DatadogRouteTracker: typeof import("../src/components/DatadogRouteTracker").DatadogRouteTracker

// require() is intentional — static imports cause silent white screens when
// module-level throws (e.g., env validation) crash the entire module graph.
// See docs/solutions/runtime-errors/metro-env-inlining-eas-update-white-screen-20260410.md
/* eslint-disable @typescript-eslint/no-require-imports */
try {
  const router = require("expo-router")
  Stack = router.Stack
  useRouter = router.useRouter
  StatusBar = require("expo-status-bar").StatusBar
  Ionicons = require("@expo/vector-icons/Ionicons").default
  ApolloProvider = require("@apollo/client/react").ApolloProvider
  SafeAreaProvider = require("react-native-safe-area-context").SafeAreaProvider
  getApolloClient = require("../src/lib/apolloClient").getApolloClient
  const color = require("../src/lib/color")
  ACCENT = color.ACCENT
  BG_COLOR = color.BG_COLOR
  ExperienceShell = require("../src/contexts/ExperienceShell").ExperienceShell
  ExperienceSelectionProvider =
    require("../src/contexts/ExperienceSelectionProvider").ExperienceSelectionProvider
  WatchPreferencesProvider =
    require("../src/contexts/WatchPreferencesProvider").WatchPreferencesProvider
  DownloadsProvider =
    require("../src/contexts/DownloadsProvider").DownloadsProvider
  const cachePersistence = require("../src/lib/cachePersistence")
  isCachePersistenceEnabled = cachePersistence.isCachePersistenceEnabled
  restoreApolloCache = cachePersistence.restoreApolloCache
  startCachePersistence = cachePersistence.startCachePersistence
  lockPortrait = require("../src/lib/orientation").lockPortrait
  MobileDatadogProvider =
    require("../src/components/DatadogRum").MobileDatadogProvider
  DatadogRouteTracker =
    require("../src/components/DatadogRouteTracker").DatadogRouteTracker
} catch (e: unknown) {
  const err = e instanceof Error ? e : new Error(String(e))
  moduleError = `${err.message}\n\n${err.stack ?? ""}`
}
/* eslint-enable @typescript-eslint/no-require-imports */

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; errorInfo: ErrorInfo | null }
> {
  state: { error: Error | null; errorInfo: ErrorInfo | null } = {
    error: null,
    errorInfo: null,
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo })
  }

  render() {
    if (this.state.error) {
      return (
        <View
          style={{
            flex: 1,
            backgroundColor: "#1c1917",
            padding: 40,
            paddingTop: 80,
          }}
        >
          <Text
            style={{
              color: "#ef4444",
              fontSize: 20,
              fontWeight: "bold",
              marginBottom: 12,
            }}
          >
            App Error
          </Text>
          <ScrollView>
            <Text
              style={{
                color: "#fbbf24",
                fontSize: 13,
                fontFamily: "monospace",
              }}
              selectable
            >
              {this.state.error.message}
            </Text>
            {this.state.errorInfo?.componentStack && (
              <Text
                style={{
                  color: "#a8a29e",
                  fontSize: 11,
                  fontFamily: "monospace",
                  marginTop: 12,
                }}
                selectable
              >
                {this.state.errorInfo.componentStack}
              </Text>
            )}
          </ScrollView>
        </View>
      )
    }
    return this.props.children
  }
}

export const unstable_settings = {
  initialRouteName: "(tabs)",
}

export default function RootLayout() {
  if (moduleError) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#1c1917",
          padding: 40,
          paddingTop: 80,
        }}
      >
        <Text
          style={{
            color: "#ef4444",
            fontSize: 20,
            fontWeight: "bold",
            marginBottom: 12,
          }}
        >
          Startup Error
        </Text>
        <ScrollView>
          <Text
            style={{
              color: "#fbbf24",
              fontSize: 13,
              fontFamily: "monospace",
            }}
            selectable
          >
            {moduleError}
          </Text>
        </ScrollView>
      </View>
    )
  }

  const clientRef = useRef(getApolloClient())
  const router = useRouter()

  // Lock the whole app to portrait; only the fullscreen video player rotates
  // (it relaxes the lock on entry and re-asserts it on exit). Fired as early as
  // the root effect allows so a cold launch held in landscape snaps to portrait.
  useEffect(() => {
    void lockPortrait()
  }, [])

  // Opt-in cache persistence: restore snapshot BEFORE ApolloProvider mounts so no
  // query races the restore (timeout-bounded in restoreApolloCache). When disabled,
  // hydrated starts true and this is inert — default path renders immediately.
  const [hydrated, setHydrated] = useState(() => !isCachePersistenceEnabled())
  useEffect(() => {
    if (hydrated) return
    let cancelled = false
    restoreApolloCache(clientRef.current.cache).finally(() => {
      if (cancelled) return
      startCachePersistence(clientRef.current)
      setHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [hydrated])

  if (!hydrated) {
    return <View style={{ flex: 1, backgroundColor: BG_COLOR }} />
  }

  return (
    <View style={{ flex: 1 }}>
      <ErrorBoundary>
        <MobileDatadogProvider>
          <ApolloProvider client={clientRef.current}>
            <SafeAreaProvider>
              <ExperienceSelectionProvider>
                <WatchPreferencesProvider>
                  <DownloadsProvider>
                    <ExperienceShell>
                      <StatusBar style="light" />
                      <DatadogRouteTracker />
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
                                <Ionicons
                                  name="chevron-back"
                                  size={28}
                                  color={ACCENT}
                                />
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
                                <Ionicons
                                  name="chevron-back"
                                  size={28}
                                  color={ACCENT}
                                />
                              </Pressable>
                            ),
                          }}
                        />
                        <Stack.Screen
                          name="experience/[slug]"
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
                                <Ionicons
                                  name="chevron-back"
                                  size={28}
                                  color={ACCENT}
                                />
                              </Pressable>
                            ),
                          }}
                        />
                        <Stack.Screen
                          name="mission"
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
                                <Ionicons
                                  name="chevron-back"
                                  size={28}
                                  color={ACCENT}
                                />
                              </Pressable>
                            ),
                          }}
                        />
                        <Stack.Screen
                          name="watch"
                          options={{ headerShown: false }}
                        />
                        <Stack.Screen
                          name="series"
                          options={{ headerShown: false }}
                        />
                      </Stack>
                    </ExperienceShell>
                  </DownloadsProvider>
                </WatchPreferencesProvider>
              </ExperienceSelectionProvider>
            </SafeAreaProvider>
          </ApolloProvider>
        </MobileDatadogProvider>
      </ErrorBoundary>
    </View>
  )
}
