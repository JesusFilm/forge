import type { VideoPlayer } from "expo-video"

import { OFFLINE_ROOT } from "../offlineFileSystem"
import { validateLocalMediaUrl } from "../validateLocalMediaUrl"
import { resolveMuxDataConfig, type MuxDataConfig } from "./config"
import {
  resolveMuxMonitorBackend,
  type MuxMonitor,
  type MuxMonitorBackend,
  type MuxPlayerSize,
} from "./monitor"
import {
  isMonitoredStream,
  planStreamTransition,
  settleAction,
  type LoadedStream,
} from "./streamTransition"
import {
  buildMuxViewData,
  type MuxViewData,
  type MuxViewIdentity,
  type MuxViewSurface,
} from "./viewData"

/** The `muxData` option of `useManagedVideoPlayer`. Only a request that a
 *  monitored surface makes carries it; the series trailer carries none. */
export type MuxDataOption = {
  surface: MuxViewSurface
  identity: MuxViewIdentity
}

/** An Experience route's option: the block's video id, no slug, and the
 *  record title from the provider, never the block's stored title (R15). */
export function experienceMuxData(
  videoId: string | null,
  getVideoTitle: (videoId: string) => string | null,
): MuxDataOption | null {
  if (videoId == null) return null
  return {
    surface: "experience",
    identity: { videoId, videoSlug: null, title: getVideoTitle(videoId) },
  }
}

/** KTD16: the hook's stable facade, for callers outside its render inputs. */
export type MuxMonitorFacade = {
  /** Call before an error reload's load starts; run the returned settle once
   *  the source is set. */
  beginReload: (url: string) => () => void
  /** The size of the frame the video settles in, from the caller's layout
   *  (KTD1). The host knows it only after it calls the hook. */
  setPlayerSize: (size: MuxPlayerSize) => void
}

export type MonitorSession = {
  /**
   * The one entry for every stream and data change. Runs the open-view update
   * and the before-load action now; returns the settle phase, which the caller
   * runs once the load is set.
   */
  onStream: (
    url: string | null,
    option: MuxDataOption | null,
    errorReload?: boolean,
  ) => () => void
  setPlayerSize: (size: MuxPlayerSize | null) => void
  release: () => void
}

export type MonitorSessionDeps = {
  config: MuxDataConfig
  backend: MuxMonitorBackend
  getViewerId: () => Promise<string>
  /** `validateLocalMediaUrl(url, OFFLINE_ROOT)`, injected to keep this pure. */
  isLocal: (url: string) => boolean
}

export const NO_SETTLE = () => {}

/** A JS try/catch is the only guard between a monitor fault and playback
 *  (R27). The plan sends no warning: a fault never touches playback. */
function safely(call: () => void): void {
  try {
    call()
  } catch {
    // Mux is best-effort; the player keeps playing.
  }
}

export function createMonitorSession(
  player: VideoPlayer,
  deps: MonitorSessionDeps,
): MonitorSession {
  let loaded: LoadedStream | null = null
  let surface: MuxViewSurface = "watch"
  let monitor: MuxMonitor | null = null
  let viewerId: string | null = null
  let size: MuxPlayerSize | null = null
  // KTD4: the attach waits on the viewer id, so each attach and detach takes
  // a new generation and a stale wait does nothing.
  let attachGeneration = 0
  // Adapter swaps and error reloads; the hook's isSwappingRef stays the QoE's.
  let latestLoad = 0
  let released = false
  // Read at creation, so an attach after the first stream (an episode after
  // the trailer) finds the id and lands before its load (KTD4).
  const viewerIdRead = deps.getViewerId().then(
    (id) => {
      viewerId = id
    },
    () => {
      // The store resolves from memory after a fault; this is a backstop.
    },
  )

  const monitored = (stream: LoadedStream | null): stream is LoadedStream =>
    isMonitoredStream(
      stream,
      deps.backend.downloadedPlaysMonitored,
      deps.isLocal,
    )

  function dataFor(stream: LoadedStream): MuxViewData | null {
    if (stream.identity == null || viewerId == null) return null
    return buildMuxViewData({
      surface,
      identity: stream.identity,
      streamUrl: stream.url,
      downloaded: deps.isLocal(stream.url),
      viewerId,
      seesNativeControlSeeks: deps.backend.seesNativeControlSeeks,
    })
  }

  /** Binds the stream loaded NOW: a swap during the wait moved `loaded`. */
  function bind(): void {
    if (released || monitor != null || !monitored(loaded)) return
    const data = dataFor(loaded)
    if (data == null) return
    safely(() => {
      monitor = deps.backend.attach({
        player,
        envKey: deps.config.envKey,
        data,
        size,
      })
    })
  }

  function attach(): void {
    attachGeneration += 1
    const generation = attachGeneration
    if (viewerId != null) {
      bind()
      return
    }
    void viewerIdRead.then(() => {
      if (generation === attachGeneration) bind()
    })
  }

  function detach(): void {
    attachGeneration += 1
    const current = monitor
    monitor = null
    if (current != null) safely(() => current.release())
  }

  return {
    onStream(url, option, errorReload = false) {
      if (released) return NO_SETTLE
      if (option != null) surface = option.surface
      const openUrl = loaded?.url ?? null
      const transition = planStreamTransition({
        current: loaded,
        next: { url, identity: option?.identity ?? null, errorReload },
        downloadedPlaysMonitored: deps.backend.downloadedPlaysMonitored,
        isLocal: deps.isLocal,
      })

      const open = monitor
      if (open != null && openUrl != null && transition.openViewUpdate) {
        const data = dataFor({
          url: openUrl,
          identity: transition.openViewUpdate,
        })
        if (data != null) safely(() => open.updateView(data))
      }

      loaded = transition.loaded
      if (transition.beforeLoad === "attach") attach()
      else if (transition.beforeLoad === "detach") detach()
      else if (transition.beforeLoad === "stage") {
        const current = monitor
        const data = loaded == null ? null : dataFor(loaded)
        if (current != null && data != null) safely(() => current.stage(data))
      }

      if (!transition.loads) return NO_SETTLE
      latestLoad += 1
      const token = latestLoad
      return () => {
        if (released) return
        if (
          settleAction(transition, { token, latestToken: latestLoad }) ===
          "none"
        )
          return
        const current = monitor
        if (current != null) safely(() => current.startView())
      }
    },

    setPlayerSize(next) {
      if (released || next == null) return
      if (size?.width === next.width && size?.height === next.height) return
      size = next
      const current = monitor
      if (current != null) safely(() => current.setPlayerSize(next))
    },

    release() {
      if (released) return
      released = true
      detach()
    },
  }
}

/**
 * The gate decides first, so a build without a key resolves no backend and
 * loads no SDK (KTD3). Null until the spike's backend is connected.
 */
export function createMuxMonitorSession(
  player: VideoPlayer,
): MonitorSession | null {
  const config = resolveMuxDataConfig()
  if (config == null) return null
  const backend = resolveMuxMonitorBackend()
  if (backend == null) return null
  // Lazy: the player hook's import graph must not load the native storage
  // module, which the player suites do not mock.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const viewerIds = require("./viewerId") as typeof import("./viewerId")
  return createMonitorSession(player, {
    config,
    backend,
    getViewerId: () => viewerIds.getMuxViewerIdStore().get(),
    isLocal: (url) => validateLocalMediaUrl(url, OFFLINE_ROOT),
  })
}
