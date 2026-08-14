import { Component, useCallback, useRef } from "react"
import { ScrollView, Text, View } from "react-native"
import type { ErrorInfo, ReactNode } from "react"

import {
  VideoPlayerProvider,
  useVideoPlayerContext,
} from "../src/contexts/VideoPlayerContext"
import { SeriesLanguageProvider } from "../src/contexts/SeriesLanguageContext"
import { WatchPreferencesProvider } from "../src/contexts/WatchPreferencesProvider"
import {
  WatchSessionProvider,
  useWatchSession,
} from "../src/contexts/WatchSessionProvider"
import { VideoPlayer } from "../src/components/VideoPlayer"
import {
  queueMeaningfulWatchEvent,
  type PlaybackSnapshot,
  type WatchEventIdentity,
} from "../src/lib/watchEvents/watchEvents"
import { saveResumeSnapshot } from "../src/lib/watchEvents/continueWatching"

/** Background color from Crimson Gallery design system */
const BG_COLOR = "#161311"

let moduleError: string | null = null

let Stack: typeof import("expo-router").Stack
let router: typeof import("expo-router").router
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
  router = require("expo-router").router
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
  const { state, dismissVideo, markUpNextChain } = useVideoPlayerContext()
  // Live dub attribution: the in-player language menu swaps dubs via
  // replaceAsync WITHOUT a new playVideo, so currentIdentity's videoDubId is
  // frozen at Play-press. When the watch session still owns this playback
  // (same video), its activeVariant is the dub actually playing — use it.
  const { video: sessionVideo, activeVariant: sessionVariant } =
    useWatchSession()
  const liveDubId =
    state.currentIdentity != null &&
    sessionVideo?.documentId === state.currentIdentity.videoId
      ? (sessionVariant?.documentId ?? state.currentIdentity.videoDubId)
      : (state.currentIdentity?.videoDubId ?? null)

  // Anonymous watch-event capture (feat-322). The callbacks read a SNAPSHOT
  // captured while playback is active and NEVER cleared on dismiss:
  // dismissVideo resets context state (identity -> null) BEFORE the player's
  // unmount emission fires, so an "identityRef" read at exit time is always
  // null and the Back-exit save silently drops (review P1). The snapshot is
  // only REPLACED by the next identity-carrying playback.
  const activePlaybackRef = useRef<{
    identity: WatchEventIdentity
    videoDubId: string | null
    video: ReturnType<typeof useWatchSession>["video"]
  } | null>(null)
  if (state.isVisible && state.currentIdentity != null) {
    activePlaybackRef.current = {
      identity: state.currentIdentity,
      videoDubId: liveDubId,
      video:
        sessionVideo?.documentId === state.currentIdentity.videoId
          ? sessionVideo
          : activePlaybackRef.current?.video?.documentId ===
              state.currentIdentity.videoId
            ? activePlaybackRef.current.video
            : null,
    }
  } else if (state.isVisible && state.currentIdentity == null) {
    // An identity-less playback (trailer, experience card) must not save
    // against the PREVIOUS video's snapshot.
    activePlaybackRef.current = null
  }

  const handleMeaningfulPlayback = useCallback((snapshot: PlaybackSnapshot) => {
    const active = activePlaybackRef.current
    if (active == null) return
    void queueMeaningfulWatchEvent(
      { videoId: active.identity.videoId, videoDubId: active.videoDubId },
      snapshot,
    )
  }, [])

  // Continue Watching shelf: display fields come from the session's video
  // record — captured in the snapshot under the same ownership rule as the
  // live dub attribution above.
  const handlePlaybackPosition = useCallback((snapshot: PlaybackSnapshot) => {
    const active = activePlaybackRef.current
    if (active?.video == null) return
    if (
      active.video.documentId !== active.identity.videoId ||
      active.video.slug == null
    ) {
      return
    }
    void saveResumeSnapshot(
      {
        videoId: active.identity.videoId,
        slug: active.video.slug,
        title: active.video.title,
        imageUrl: active.video.posterUrl,
        updatedAt: new Date().toISOString(),
      },
      snapshot,
    )
  }, [])

  if (!state.isVisible || state.currentUrl == null) {
    return null
  }

  return (
    <VideoPlayer
      streamingUrl={state.currentUrl}
      title={state.currentTitle ?? undefined}
      subtitle={state.currentSubtitle ?? undefined}
      onDismiss={dismissVideo}
      onMeaningfulPlayback={handleMeaningfulPlayback}
      // Dub switch = new attribution unit: re-arm the one-shot latch so the
      // new dub can record its own meaningful event (web parity).
      meaningfulResetKey={liveDubId}
      startAtSeconds={state.currentStartAtSeconds}
      onPlaybackPosition={handlePlaybackPosition}
      upNextTarget={state.currentUpNext}
      // Up Next confirm/expiry: end THIS playback, then replace the details
      // route with the next episode's in autoplay pass-through mode — the
      // same path a Continue Watching card takes, so playback opens without
      // painting the details page first.
      onPlayNext={(slug) => {
        // Mark BEFORE dismissing: the pass-through screen's pop-back effect
        // observes the dismiss and must know this close is a hop, not a
        // viewer exit — otherwise hop 2+ (autoplay-entered routes) pops the
        // replaced next episode and the binge chain dies on Home.
        markUpNextChain()
        dismissVideo()
        router.replace(`/watch/${encodeURIComponent(slug)}?autoplay=1`)
      }}
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
            {/* WatchPreferences sits ABOVE WatchSession: the session's default-dub
                resolution reads the persisted audio-language preference (U2), and
                the preference must outlive WatchSession's unmount on leaving watch. */}
            <WatchPreferencesProvider>
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
            </WatchPreferencesProvider>
          </SeriesLanguageProvider>
        </ApolloProvider>
      </TvDatadogProvider>
    </ErrorBoundary>
  )
}
