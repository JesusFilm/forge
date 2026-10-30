import type { VideoPlayer } from "expo-video"

import type { MuxViewData } from "./viewData"

/** The player size in points, from the host's layout (KTD1). */
export type MuxPlayerSize = { width: number; height: number }

/**
 * The method-neutral monitor for one player (KTD1). Staging never touches the
 * open view, so a swap that later loses cannot change it (KTD5).
 */
export type MuxMonitor = {
  /** Stage the next view's data. iOS native also starts the view here. */
  stage: (data: MuxViewData) => void
  /** Update the open view: a late id or title for the same video. */
  updateView: (data: MuxViewData) => void
  /** Start a new view with the staged data (the settle phase). */
  startView: () => void
  setPlayerSize: (size: MuxPlayerSize) => void
  /** Never touches the player: its own release runs first on unmount (KTD4). */
  release: () => void
}

export type MuxMonitorBackend = {
  /** False when the backend cannot keep a download's path out of Mux (R20). */
  downloadedPlaysMonitored: boolean
  /** False when the backend cannot see native-control seeks (R13). */
  seesNativeControlSeeks: boolean
  /** The first view opens at the first play request, not here. */
  attach: (input: {
    player: VideoPlayer
    envKey: string
    data: MuxViewData
    size: MuxPlayerSize | null
  }) => MuxMonitor
}

/**
 * The backend the device spike picks (U1). U5 or U6 connects it here; until
 * then Mux stays off, also with a key.
 */
export function resolveMuxMonitorBackend(): MuxMonitorBackend | null {
  return null
}
