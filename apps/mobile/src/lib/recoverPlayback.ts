import type { VideoPlayerStatus } from "expo-video"

/**
 * Bring a player back from a terminal `error` status (todos/024).
 *
 * ExoPlayer's play() is a no-op once the source has failed, so the transport's
 * play button reads as dead. Recovery has to re-apply the source, which is why
 * this lives beside the adapter's swap path rather than in the chrome.
 */
type RecoverableSubscription = { remove: () => void }

type RecoverablePlayer = {
  replaceAsync: (source: string) => Promise<unknown>
  /** expo-video's second argument is `disableWarning`, not a position flag. */
  replace: (source: string, disableWarning?: boolean) => void
  play: () => void
  currentTime: number
  status?: VideoPlayerStatus
  addListener: (
    name: "sourceLoad",
    listener: (payload?: unknown) => void,
  ) => RecoverableSubscription
}

/** Reported by the caller, so a recovery is never silent. */
export type RecoveryOutcome = "recovered" | "failed"

/** How long the pending seek waits for its source. The player outlives every
 *  route, so a load that never arrives must not leave the listener behind. */
export const RECOVERY_SEEK_WINDOW_MS = 15000

export async function recoverPlayback(
  player: RecoverablePlayer,
  sourceUrl: string,
  positionSeconds: number,
  /** Mirrors the adapter's swap resume: never start audio the viewer cannot
   *  see, and never play locally under a cast session. */
  shouldResume: () => boolean = () => true,
): Promise<RecoveryOutcome> {
  // The seek rides `sourceLoad`, NOT the replaceAsync promise. replaceAsync
  // settles while the source is still being applied, so a write in its
  // continuation lands on the outgoing item and is silently discarded — see
  // docs/solutions/integration-issues/expo-video-replaceasync-seek-silently-dropped-tvos.md
  // and the same sourceLoad-gated seek in VideoPlayer.tsx.
  let loadSub: RecoverableSubscription | null = null
  let deadline: ReturnType<typeof setTimeout> | null = null
  let settled = false
  let resolveOutcome!: (outcome: RecoveryOutcome) => void
  const outcome = new Promise<RecoveryOutcome>((resolve) => {
    resolveOutcome = resolve
  })

  const cleanup = () => {
    if (deadline != null) {
      clearTimeout(deadline)
      deadline = null
    }
    if (loadSub != null) {
      try {
        loadSub.remove()
      } catch {
        // Already released.
      }
      loadSub = null
    }
  }

  const finish = (result: RecoveryOutcome) => {
    if (settled) return
    settled = true
    cleanup()
    resolveOutcome(result)
  }

  // The LOAD decides the outcome, not the swap. On Android replaceAsync is
  // equivalent to replace: it settles when the item is SET, not when it has
  // loaded, so resolving off the promise would report success for a source
  // that never played.
  const onLoad = (payload?: unknown) => {
    // The app runs ONE shared player, so a load that belongs to a different
    // source must not be taken for ours — it would jump the incoming video to
    // the outgoing one's position. Stay armed and wait for the right one. A
    // payload-less or non-string source is treated as ours: dropping an
    // unidentifiable load would strand the recovery entirely.
    const loaded =
      typeof payload === "object" && payload !== null
        ? (payload as { videoSource?: unknown }).videoSource
        : undefined
    if (typeof loaded === "string" && loaded !== sourceUrl) return
    // Seek BEFORE resuming — playing first starts the viewer at zero and then
    // jumps. Mirrors VideoPlayer's `onSourceLoad = () => { seek(); play() }`.
    if (positionSeconds > 0) {
      try {
        player.currentTime = positionSeconds
      } catch {
        // Released between the swap and the load.
      }
    }
    // A resume the guard declines is still a recovery: the source is live and
    // the transport works.
    if (!shouldResume()) return finish("recovered")
    try {
      player.play()
      finish("recovered")
    } catch {
      // Released mid-recovery — the source landed but playback did not.
      finish("failed")
    }
  }

  try {
    loadSub = player.addListener("sourceLoad", onLoad)
  } catch {
    // Released before we could listen; the deadline below still settles.
  }
  deadline = setTimeout(() => finish("failed"), RECOVERY_SEEK_WINDOW_MS)

  try {
    await player.replaceAsync(sourceUrl)
  } catch {
    try {
      player.replace(sourceUrl, true)
    } catch {
      // Released, or the source is genuinely unplayable. The caller keeps the
      // error state, so the viewer still sees the failure surface.
      finish("failed")
    }
  }

  return outcome
}
