import { Component, useRef } from "react"
import { ScrollView, Text, View } from "react-native"
import type { ErrorInfo, ReactNode } from "react"

import {
  VideoPlayerProvider,
  useVideoPlayerContext,
} from "../src/contexts/VideoPlayerContext"
import { SeriesLanguageProvider } from "../src/contexts/SeriesLanguageContext"
import { WatchSessionProvider } from "../src/contexts/WatchSessionProvider"
import { VideoPlayer } from "../src/components/VideoPlayer"

/** Background color from Crimson Gallery design system */
const BG_COLOR = "#161311"

let moduleError: string | null = null

let Stack: typeof import("expo-router").Stack
let StatusBar: typeof import("expo-status-bar").StatusBar
let ApolloProvider: typeof import("@apollo/client/react").ApolloProvider
let getApolloClient: typeof import("../src/lib/apolloClient").getApolloClient
let TvDatadogProvider: typeof import("../src/components/DatadogRum").TvDatadogProvider
let DatadogRouteTracker: typeof import("../src/components/DatadogRouteTracker").DatadogRouteTracker
let reportDatadogError: typeof import("../src/lib/datadog").reportDatadogError

// require() is intentional — static imports cause silent white screens when
// module-level throws (e.g., env validation) crash the entire module graph.
/* eslint-disable @typescript-eslint/no-require-imports */
try {
  Stack = require("expo-router").Stack
  StatusBar = require("expo-status-bar").StatusBar
  ApolloProvider = require("@apollo/client/react").ApolloProvider
  getApolloClient = require("../src/lib/apolloClient").getApolloClient
  TvDatadogProvider = require("../src/components/DatadogRum").TvDatadogProvider
  DatadogRouteTracker =
    require("../src/components/DatadogRouteTracker").DatadogRouteTracker
  reportDatadogError = require("../src/lib/datadog").reportDatadogError
} catch (e: unknown) {
  const err = e instanceof Error ? e : new Error(String(e))
  moduleError = `${err.message}\n\n${err.stack ?? ""}`
}
/* eslint-enable @typescript-eslint/no-require-imports */

/** Renders the full-screen video player overlay when a video is active. */
function VideoPlayerOverlay() {
  const { state, dismissVideo } = useVideoPlayerContext()

  if (!state.isVisible || state.currentUrl == null) {
    return null
  }

  return (
    <VideoPlayer
      streamingUrl={state.currentUrl}
      title={state.currentTitle ?? undefined}
      subtitle={state.currentSubtitle ?? undefined}
      onDismiss={dismissVideo}
    />
  )
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
    reportDatadogError(error, {
      componentStack: errorInfo.componentStack ?? undefined,
    })
  }

  render() {
    if (this.state.error) {
      return (
        <View
          style={{
            flex: 1,
            backgroundColor: BG_COLOR,
            padding: 80,
          }}
        >
          <Text
            style={{
              color: "#ef4444",
              fontSize: 28,
              fontWeight: "bold",
              marginBottom: 16,
            }}
          >
            App Error
          </Text>
          <ScrollView>
            <Text
              style={{
                color: "#fbbf24",
                fontSize: 18,
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
                  fontSize: 14,
                  fontFamily: "monospace",
                  marginTop: 16,
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

export default function RootLayout() {
  const clientRef = useRef(moduleError == null ? getApolloClient() : null)

  if (moduleError) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: BG_COLOR,
          padding: 80,
        }}
      >
        <Text
          style={{
            color: "#ef4444",
            fontSize: 28,
            fontWeight: "bold",
            marginBottom: 16,
          }}
        >
          Startup Error
        </Text>
        <ScrollView>
          <Text
            style={{
              color: "#fbbf24",
              fontSize: 18,
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

  return (
    <ErrorBoundary>
      {/* Datadog RUM wraps the app so it buffers/instruments from first mount.
          A no-op pass-through until the client token + app id are provisioned. */}
      <TvDatadogProvider>
        <ApolloProvider client={clientRef.current!}>
          {/* SeriesLanguage sits ABOVE WatchSession: session default-dub resolution
              reads the carried series-language selection (U4), so its provider must
              be mounted first. Lives here, not the series screen, to survive push/pop. */}
          <SeriesLanguageProvider>
            {/* WatchSession is OUTER of VideoPlayer so the overlay VideoPlayer can
                call useWatchSession() (live dub/subtitle handoff). Below ErrorBoundary
                so a throw degrades to the error screen. Inert until a video is published (KTD2, U3). */}
            <WatchSessionProvider>
              <VideoPlayerProvider>
                <StatusBar style="light" />
                <DatadogRouteTracker />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: BG_COLOR },
                  }}
                />
                <VideoPlayerOverlay />
              </VideoPlayerProvider>
            </WatchSessionProvider>
          </SeriesLanguageProvider>
        </ApolloProvider>
      </TvDatadogProvider>
    </ErrorBoundary>
  )
}
