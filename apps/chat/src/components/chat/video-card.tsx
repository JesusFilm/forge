import { Component, type ReactNode } from "react"
import dynamic from "next/dynamic"

import { type VideoAttachment } from "@/lib/conversations"

import { UntrustedLink } from "./untrusted-link"

// ssr:false keeps hls.js + the Mux element in their own chunk: turns without a
// video never download them, and nothing renders server-side. A failed chunk
// load is session-scoped and NOT retryable — see the JSDoc below.
const MuxVideo = dynamic(() => import("@forge/video-player/mux-video"), {
  ssr: false,
})

// Every still is derived from the playback id, which toVideo pattern-gates —
// so this interpolation cannot introduce a URL shape of the wire's choosing.
function posterUrl(playbackId: string): string {
  return `https://image.mux.com/${playbackId}/thumbnail.jpg?width=1280&height=720&fit_mode=smartcrop`
}

// Bound the DISPLAY, never the row: the caption line-clamps (full text stays
// in the DOM) and the accessible name — which CSS cannot reach — truncates.
// Unit is UTF-16 code units, which is what .length and .slice measure.
const MAX_LABEL_CODE_UNITS = 200

// Whitespace-collapsed like deriveTitle so the label mirrors the RENDERED
// caption, and a trailing lone surrogate left by the cut is dropped.
// Runs inside VideoRenderBoundary's own render, so it must never throw.
function boundedLabel(title: string): string {
  const text = title.replace(/\s+/g, " ").trim()
  if (text.length <= MAX_LABEL_CODE_UNITS) return text
  const cut = text
    .slice(0, MAX_LABEL_CODE_UNITS - 1)
    .replace(/[\uD800-\uDBFF]$/, "")
  return `${cut.trimEnd()}…`
}

// m:ss, widening to h:mm:ss past the hour.
function formatDuration(totalSeconds: number): string {
  const whole = Math.floor(totalSeconds)
  const seconds = String(whole % 60).padStart(2, "0")
  const minutes = Math.floor(whole / 60) % 60
  const hours = Math.floor(whole / 3600)
  if (hours === 0) return `${minutes}:${seconds}`
  return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
}

/**
 * Containment for the player subtree (feat-328). The card renders OUTSIDE
 * `MarkdownRenderBoundary` (whose coverage is the markdown subtree) and chat
 * has no app-level boundary, so a throw from MuxVideo/hls.js — or a failed
 * lazy chunk — would otherwise unmount the whole transcript, durably once
 * replay lands. Each instance latches independently and degrades to a plain
 * line; the caption link outside still reaches the watch page.
 *
 * Scope, stated honestly: a RENDER throw or a playback error is contained to
 * the one turn that raised it. A failed CHUNK LOAD is not — the rejection is
 * cached by Turbopack's emitted runtime (per-chunk record, `loadingStarted`
 * never reset, no eviction) AND by React.lazy's module-scoped payload, so
 * every video turn in the session degrades together and recovery is a page
 * reload. Naming both layers matters: a fresh lazy instance per card, or a
 * remount with a key, is inert against the runtime cache underneath. A
 * userland retry around the import is inert for the same reason (measured:
 * it only delayed the fallback ~900ms) — verified 2026-08-04 by reading the
 * built runtime chunk on next@16.2.4/Turbopack. Bundler-scoped: webpack's
 * runtime DOES evict failed records, where a retry would work.
 *
 * `children` is a render callback so the two failure CLASSES converge on one
 * outcome: a render-phase throw (caught here) and an async playback `error`
 * event (which no error boundary can catch — the child reports it via `fail`).
 */
export class VideoRenderBoundary extends Component<
  { children: (fail: () => void) => ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  fail = () => {
    this.setState({ failed: true })
  }

  render() {
    if (this.state.failed) {
      return (
        <p data-video="unavailable" className="text-sm text-ash italic">
          This video can&rsquo;t be played here.
        </p>
      )
    }
    return this.props.children(this.fail)
  }
}

type VideoCardProps = {
  video: VideoAttachment
}

/**
 * The video the Seeker featured on one assistant turn, rendered as an inline
 * Mux player with a title + duration caption linking to the watch page. A
 * sibling block below the message text — never through the markdown element
 * allowlist (plan D2). Presentational (no hooks): it inherits the client
 * context of the modules that import it, like sources-list.
 */
export function VideoCard({ video }: VideoCardProps) {
  // typeof, not `!== null`: a future replay projection handing back undefined
  // would otherwise render "NaN:NaN".
  const duration =
    typeof video.durationSeconds === "number"
      ? formatDuration(video.durationSeconds)
      : null

  return (
    <figure className="mt-3" data-video-card>
      <VideoRenderBoundary>
        {(fail) => (
          // aspect-video sits here, not only on the lazy player, so the box
          // holds its height before the chunk resolves — and INSIDE the
          // boundary, so a failure collapses it instead of framing the message.
          <div className="aspect-video w-full overflow-hidden rounded-[12px] border border-linen/10 bg-embersoot">
            <MuxVideo
              playbackId={video.playbackId}
              poster={posterUrl(video.playbackId)}
              controls
              // "metadata", not "none": hls.js attaches MediaSource at setup
              // either way, and with "none" nothing ever loads, so Chrome's
              // native controls spin forever (HeroPlayer uses the same value).
              preload="metadata"
              aria-label={boundedLabel(video.title)}
              onError={fail}
              // Mux receives ONLY the pattern-gated playbackId and this origin.
              // Both flags are passed EXPLICITLY, never inherited from the
              // package defaults; no metadata/viewer-id prop is ever passed.
              disableTracking
              disableCookies
              className="block h-full w-full"
            />
          </div>
        )}
      </VideoRenderBoundary>
      {/* line-clamp-2 needs its own display: ANY display utility here silently
          unclamps it (browser-caught in feat-269). Verified by hand 2026-08-04,
          HeadlessChrome 149: 2 lines, duration inline on line 1. */}
      <figcaption
        data-video-caption
        className="mt-2 line-clamp-2 text-sm text-ash"
      >
        <UntrustedLink
          href={video.watchUrl}
          fallback={<span className="text-vellum">{video.title}</span>}
        >
          {video.title}
        </UntrustedLink>
        {duration ? <span data-video-duration> · {duration}</span> : null}
      </figcaption>
    </figure>
  )
}
