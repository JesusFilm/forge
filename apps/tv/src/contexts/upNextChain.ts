// Up Next chain latch (pure, React-free — see WatchSessionProvider.test.tsx
// header for why context logic lives in .ts helpers).
//
// One boolean with once-only consumption: the overlay host MARKS right before
// it dismisses the player and replaces the route with the next episode; the
// autoplay pass-through screen CONSUMES the mark inside its pop-back effect to
// tell an Up Next hop apart from a viewer exit. Without the latch, hop 2+ of a
// binge chain (whose route is itself autoplay-entered) pops the
// freshly-replaced next episode and strands the viewer on Home.

export type UpNextChainLatch = {
  /** An Up Next hop is about to dismiss the player. */
  mark: () => void
  /** True exactly once per mark, then false until the next mark. */
  consume: () => boolean
  /** Unconditional reset — playVideo calls this so a hop whose screen
   *  unmounted before consuming cannot poison the next genuine back-out. */
  clear: () => void
}

export function createUpNextChainLatch(): UpNextChainLatch {
  let pending = false
  return {
    mark() {
      pending = true
    },
    consume() {
      const wasPending = pending
      pending = false
      return wasPending
    },
    clear() {
      pending = false
    },
  }
}
