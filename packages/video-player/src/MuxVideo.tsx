"use client"

import { forwardRef } from "react"
import MuxVideoReact from "@mux/mux-video-react"
import type { ComponentPropsWithoutRef } from "react"

export type MuxVideoProps = ComponentPropsWithoutRef<typeof MuxVideoReact>
/**
 * The underlying ref shape from `@mux/mux-video-react` includes `| undefined`
 * — consumers MUST null-guard before calling any media method.
 */
export type MuxVideoRef = HTMLVideoElement | undefined

/**
 * Brand-defaulted wrapper around `@mux/mux-video-react` for `apps/web`
 * inline / hero / carousel video surfaces.
 *
 * Defaults applied:
 *  - `disableTracking={true}` — hero / inline video is excluded from full
 *    Mux Data v1 to control cost (per Key Decision: re-enable trigger is
 *    `FORGE_WATCH_PLAYER_MIGRATION === true` in prod for one release +
 *    30-day Mux invoice review). Override by passing `disableTracking={false}`.
 *  - `disableCookies={true}` — first-party only.
 *  - `playsInline` — required for iOS Safari inline playback.
 *
 * Theming / sizing is consumer-controlled — pass `className`, `style`,
 * `poster`, `muted`, `loop`, `autoPlay`, `controls` etc. directly. The ref
 * resolves to the underlying `HTMLVideoElement` (standard
 * HTMLMediaElement contract: `.muted`, `.currentTime`, `.play()`, `.pause()`).
 */
const MuxVideo = forwardRef<HTMLVideoElement | undefined, MuxVideoProps>(
  function MuxVideo(
    {
      disableTracking = true,
      disableCookies = true,
      playsInline = true,
      ...rest
    },
    ref,
  ) {
    return (
      <MuxVideoReact
        ref={ref}
        disableTracking={disableTracking}
        disableCookies={disableCookies}
        playsInline={playsInline}
        {...rest}
      />
    )
  },
)

export default MuxVideo
