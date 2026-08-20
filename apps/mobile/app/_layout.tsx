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
let BACK_SWIPE_RESPONSE_DISTANCE: typeof import("../src/lib/backSwipe").BACK_SWIPE_RESPONSE_DISTANCE
let ExperienceShell: typeof import("../src/contexts/ExperienceShell").ExperienceShell
let ExperienceSelectionProvider: typeof import("../src/contexts/ExperienceSelectionProvider").ExperienceSelectionProvider
let WatchPreferencesProvider: typeof import("../src/contexts/WatchPreferencesProvider").WatchPreferencesProvider
let DownloadsProvider: typeof import("../src/contexts/DownloadsProvider").DownloadsProvider
let AuthProvider: typeof import("../src/contexts/AuthProvider").AuthProvider
let isCachePersistenceEnabled: typeof import("../src/lib/cachePersistence").isCachePersistenceEnabled
let restoreApolloCache: typeof import("../src/lib/cachePersistence").restoreApolloCache
let startCachePersistence: typeof import("../src/lib/cachePersistence").startCachePersistence
let lockPortrait: typeof import("../src/lib/orientation").lockPortrait
// Dev-only surface: the require itself is gated so Metro drops it from a
// release bundle rather than shipping a component nothing can render.
let DevEndpointNotice:
  | typeof import("../src/components/DevEndpointNotice").DevEndpointNotice
  | undefined
let PlaybackHost: typeof import("../src/components/watch/PlaybackHost").PlaybackHost
let MobileDatadogProvider: typeof import("../src/components/DatadogRum").MobileDatadogProvider
let DatadogRouteTracker: typeof import("../src/components/DatadogRouteTracker").DatadogRouteTracker
// `| undefined`: this one is read at module scope after the try/catch, where a
// require failure could leave it unassigned — the R15 guard tolerates that.
let reportDatadogError:
  | typeof import("../src/lib/datadog").reportDatadogError
  | undefined
let addDatadogTiming: typeof import("../src/lib/datadog").addDatadogTiming
let datadogLog: typeof import("../src/lib/datadog").datadogLog
let Linking: typeof import("expo-linking")
let initDeepLinkOrigins: typeof import("../src/lib/deepLinkOrigin").initDeepLinkOrigins

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
  BACK_SWIPE_RESPONSE_DISTANCE =
    require("../src/lib/backSwipe").BACK_SWIPE_RESPONSE_DISTANCE
  ExperienceShell = require("../src/contexts/ExperienceShell").ExperienceShell
  ExperienceSelectionProvider =
    require("../src/contexts/ExperienceSelectionProvider").ExperienceSelectionProvider
  WatchPreferencesProvider =
    require("../src/contexts/WatchPreferencesProvider").WatchPreferencesProvider
  DownloadsProvider =
    require("../src/contexts/DownloadsProvider").DownloadsProvider
  AuthProvider = require("../src/contexts/AuthProvider").AuthProvider
  const cachePersistence = require("../src/lib/cachePersistence")
  isCachePersistenceEnabled = cachePersistence.isCachePersistenceEnabled
  restoreApolloCache = cachePersistence.restoreApolloCache
  startCachePersistence = cachePersistence.startCachePersistence
  lockPortrait = require("../src/lib/orientation").lockPortrait
  PlaybackHost = require("../src/components/watch/PlaybackHost").PlaybackHost
  if (__DEV__) {
    DevEndpointNotice =
      require("../src/components/DevEndpointNotice").DevEndpointNotice
  }
  MobileDatadogProvider =
    require("../src/components/DatadogRum").MobileDatadogProvider
  DatadogRouteTracker =
    require("../src/components/DatadogRouteTracker").DatadogRouteTracker
  const datadog = require("../src/lib/datadog")
  reportDatadogError = datadog.reportDatadogError
  addDatadogTiming = datadog.addDatadogTiming
  datadogLog = datadog.datadogLog
  Linking = require("expo-linking")
  initDeepLinkOrigins = require("../src/lib/deepLinkOrigin").initDeepLinkOrigins
} catch (e: unknown) {
  const err = e instanceof Error ? e : new Error(String(e))
  moduleError = `${err.message}\n\n${err.stack ?? ""}`
}
/* eslint-enable @typescript-eslint/no-require-imports */

// R15: the module-init boot failure is invisible to the RUM crash path and the
// React ErrorBoundary. Best-effort report — never re-throw; the SDK may be down.
if (moduleError && typeof reportDatadogError === "function") {
  try {
    reportDatadogError(new Error(moduleError), { origin: "module_init" })
  } catch {
    // Telemetry must never mask the Startup Error screen.
  }
}

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
      // R23: mark the cold-start restore gate finished; the granular
      // Distinct event: cache_restore's granular hit/miss/timeout outcome is
      // emitted inside restoreApolloCache — reusing that name here would swamp
      // its outcome aggregate. This just marks the hydration gate finished.
      datadogLog.info("app_hydration_complete", {})
      startCachePersistence(clientRef.current)
      setHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [hydrated])

  // Records which slugs arrived from OUTSIDE the app, so deep-link attribution
  // reads the opening URL instead of guessing from stack shape.
  useEffect(() => {
    return initDeepLinkOrigins({
      getInitialURL: () => Linking.getInitialURL(),
      addUrlListener: (handler) => Linking.addEventListener("url", handler),
    })
  }, [])

  // R20: js-thread time-to-interactive — the first real-tree paint past the
  // hydration gate. Fires once; native app-start hides this Hermes stall.
  const jsTtiEmittedRef = useRef(false)
  useEffect(() => {
    if (!hydrated || jsTtiEmittedRef.current) return
    jsTtiEmittedRef.current = true
    addDatadogTiming("js_tti")
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
                  <AuthProvider>
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
                            // Full-bleed: the screen renders its own floating back
                            // button over the edge-to-edge hero (no native nav bar).
                            options={{ headerShown: false }}
                          />
                          <Stack.Screen
                            name="mission"
                            // Full-bleed, same as experience/[slug]: an opaque
                            // header would cap the screen's gradient with a
                            // flat band. The screen renders its own floating
                            // back button instead.
                            options={{ headerShown: false }}
                          />
                          {/* Both player stacks confine the back-swipe to the
                              left edge: iOS 26 defaults it to full-width,
                              which claims rightward scrubs (src/lib/backSwipe). */}
                          <Stack.Screen
                            name="watch"
                            options={{
                              headerShown: false,
                              gestureResponseDistance:
                                BACK_SWIPE_RESPONSE_DISTANCE,
                            }}
                          />
                          <Stack.Screen
                            name="series"
                            options={{
                              headerShown: false,
                              gestureResponseDistance:
                                BACK_SWIPE_RESPONSE_DISTANCE,
                            }}
                          />
                        </Stack>
                      </ExperienceShell>
                      {/* KTD1: a sibling of ExperienceShell, never inside it —
                          the shell swaps its element type once per cold launch,
                          remounting its subtree. The player outlives the route. */}
                      <PlaybackHost />
                    </DownloadsProvider>
                  </AuthProvider>
                </WatchPreferencesProvider>
              </ExperienceSelectionProvider>
            </SafeAreaProvider>
          </ApolloProvider>
        </MobileDatadogProvider>
      </ErrorBoundary>
      {DevEndpointNotice ? <DevEndpointNotice /> : null}
    </View>
  )
}
