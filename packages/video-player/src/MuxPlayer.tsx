"use client"

import { forwardRef } from "react"
import MuxPlayerReact from "@mux/mux-player-react"
import type { ComponentPropsWithoutRef, ComponentRef } from "react"

export type MuxPlayerProps = ComponentPropsWithoutRef<typeof MuxPlayerReact>
/**
 * Ref type for the wrapper. The underlying `<MuxPlayer>` from
 * `@mux/mux-player-react` forwards a `MuxPlayerElement` (custom element
 * that extends `HTMLMediaElement` and mixes in HTMLVideoElement-shaped
 * properties via Mux's `VideoApiAttributes`). We use `ComponentRef` to pull
 * the type without importing `@mux/mux-player` directly — that package is a
 * transitive dependency exposed only via `@mux/mux-player-react`'s public
 * type surface, and a direct import would require listing it as a dependency
 * here too.
 *
 * Properties on the ref (assignable):
 *   - `.muted`, `.currentTime`, `.paused`, `.volume`, `.loop`, `.src`,
 *     `.playbackRate`, `.playsInline`
 * Methods on the ref:
 *   - `.play(): Promise<void>`, `.pause(): void`, `.requestFullscreen()`
 *
 * Keep this alias anchored to the React wrapper type so consumers do not need
 * to import Mux's lower-level custom-element package directly.
 */
export type MuxPlayerRef = ComponentRef<typeof MuxPlayerReact>

/**
 * Brand-themed wrapper around `@mux/mux-player-react` for `apps/web`
 * watch-page consumers.
 *
 * Defaults applied:
 *  - `disableCookies={true}` — first-party-only viewer-id model (per the
 *    watch-page Key Decision; consumers attach a localStorage UUID via the
 *    `metadata.viewer_user_id` prop). Override by passing `disableCookies={false}`.
 *  - `playsInline` — required for iOS Safari inline playback.
 *
 * Theming is applied via Tailwind / CSS Custom Properties on the underlying
 * `<mux-player>` custom element. Pass `style={{ "--controls": "none", … }}`
 * (or any of the documented `--top-controls`, `--center-controls`,
 * `--bottom-controls`, `--media-accent-color` properties) from the consumer
 * to override chrome / accent color. See:
 *   https://github.com/muxinc/elements/blob/main/packages/mux-player/REFERENCE.md
 *
 * The wrapper does NOT inject any default Tailwind classes onto the player
 * itself — it forwards the consumer's `className` verbatim. This keeps
 * theming controllable from the watch-page surface.
 */
const MuxPlayer = forwardRef<MuxPlayerRef, MuxPlayerProps>(function MuxPlayer(
  { disableCookies = true, playsInline = true, ...rest },
  ref,
) {
  return (
    <MuxPlayerReact
      ref={ref}
      disableCookies={disableCookies}
      playsInline={playsInline}
      {...rest}
    />
  )
})

export default MuxPlayer
