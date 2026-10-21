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
  playerSize?: MuxPlayerSize | null
}

/** KTD16: the hook's stable facade. Call `beginReload` before an error
 *  reload's load starts, and the returned settle once it is set. */
export type MuxMonitorFacade = {
  beginReload: (url: string) => () => void
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

const NO_SETTLE = () => {}

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

  const monitored = (stream: LoadedStream | null): stream is LoadedStream =>
    stream != null &&
    stream.identity != null &&
    (deps.backend.downloadedPlaysMonitored || !deps.isLocal(stream.url))

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
    // Known after the first wait, so a later attach lands before the load.
    if (viewerId != null) {
      bind()
      return
    }
    deps.getViewerId().then(
      (id) => {
        viewerId = id
        if (generation === attachGeneration) bind()
      },
      () => {
        // The store resolves from memory after a fault; this is a backstop.
      },
    )
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
  // Loaded only behind the gate, so a build without a key never loads the
  // store and its storage module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const viewerIds = require("./viewerId") as typeof import("./viewerId")
  return createMonitorSession(player, {
    config,
    backend,
    getViewerId: () => viewerIds.getMuxViewerIdStore().get(),
    isLocal: (url) => validateLocalMediaUrl(url, OFFLINE_ROOT),
  })
}
