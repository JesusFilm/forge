export type WatchAccountSessionSignal =
  | { status: "authenticated" }
  | { status: "unauthenticated" }
  | { status: "unavailable" }

type Listener = (signal: WatchAccountSessionSignal) => void

let latestSignal: WatchAccountSessionSignal | null = null
const listeners = new Set<Listener>()

/**
 * Shares only the result of AccountControl's existing session request. It
 * deliberately carries no identity or token data and never initiates auth IO.
 */
export function publishWatchAccountSessionSignal(
  signal: WatchAccountSessionSignal,
): void {
  latestSignal = signal
  for (const listener of listeners) listener(signal)
}

export function subscribeToWatchAccountSession(listener: Listener): () => void {
  listeners.add(listener)
  if (latestSignal) listener(latestSignal)
  return () => listeners.delete(listener)
}

export function resetWatchAccountSessionSignalForTests(): void {
  latestSignal = null
  listeners.clear()
}
