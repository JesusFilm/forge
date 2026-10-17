"use client"

import { Component, type ComponentProps, type ReactNode } from "react"
import dynamic from "next/dynamic"
import type { MuxVideo as MuxVideoType } from "@forge/video-player"

/**
 * The deferral seam itself. `apps/web` should reach the player through the
 * default export below rather than naming this specifier again; the only other
 * module allowed to is `components/watch/HeroPlayer.tsx`, which had its own
 * inline `next/dynamic` before this seam existed and is pinned as a second
 * owner by `src/components/__tests__/mux-video-deferral.test.ts`.
 *
 * `@forge/video-player/mux-video` pulls `@mux/mux-video-react`, which carries
 * hls.js and mux-embed — together ~646 KB decoded / ~160 KB brotli. Turbopack
 * groups a statically imported copy into a chunk the Watch routes' client entry
 * loads as a plain `<script src>`, which was about a fifth of the initial JS on
 * a listing page that needs no video engine until a hero actually plays.
 *
 * Deferring ONE call site does not move it. Measured on `next build`
 * (Turbopack, next@16.2.4): with the home carousel's import removed entirely
 * and three sibling section renderers still static, the chunk stayed in
 * `firstLoadChunkPaths` for both Watch routes at full size. It splits into an
 * async-only chunk only once EVERY importer is deferred — which is why this
 * lives in one module, and why the invariant test holds it whole-tree.
 *
 * `ssr: false` because the player is client-only anyway. Each call site stays
 * responsible for reserving its own box, so the late mount cannot shift what is
 * below it.
 *
 * See FGE-138 / feat-719.
 */
const LazyMuxVideo = dynamic(() => import("@forge/video-player/mux-video"), {
  ssr: false,
}) as typeof MuxVideoType

/**
 * Contains a failed chunk load to the player's own box.
 *
 * Without this, a rejected `import()` — a hashed chunk 404 after a redeploy
 * with a tab still open, a blocker, a flaky CDN — throws during render and
 * propagates to the route's `error.tsx`, replacing the WHOLE Watch page
 * (copy, artwork, navigation) over a video engine none of it needs. The
 * rejection is cached at both the bundler-runtime and `React.lazy` layers, so
 * a remount re-throws and the error page's reset is inert until a full reload
 * (`docs/solutions/best-practices/per-message-boundary-limits-for-media-surfaces.md`).
 *
 * Deliberately NOT a userland retry around `import()`: that is inert on
 * Turbopack, which is what builds this app.
 *
 * The fallback is `null`, so the caller owns what the box shows instead. Not
 * every caller paints a poster of its own: the home carousel does, and the
 * inline `Video` / `CarouselVideo` sections do through `DeferredVideoPoster`,
 * but `VideoHero` has never had one. A caller whose UI waits on media events
 * (a loading spinner, controls) must pass `onLoadError`: with no element
 * attached, no media event will ever arrive to end that wait.
 *
 * `onLoadError` fires from `componentDidCatch`, in the commit phase, so the
 * caller can set its own state there; never from render.
 */
class MuxVideoChunkBoundary extends Component<
  { children: ReactNode; onLoadError?: () => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onLoadError?.()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

export type DeferredMuxVideoProps = ComponentProps<typeof MuxVideoType> & {
  /** The player chunk failed to load; no media element will ever attach. */
  onLoadError?: () => void
}

export default function DeferredMuxVideo({
  onLoadError,
  ...props
}: DeferredMuxVideoProps) {
  return (
    <MuxVideoChunkBoundary onLoadError={onLoadError}>
      <LazyMuxVideo {...props} />
    </MuxVideoChunkBoundary>
  )
}
