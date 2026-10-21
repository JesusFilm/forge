import { isSameMuxAsset } from "../muxThumbnail"
import { sameQualityConstraint } from "../streamQuality"
import type { MuxViewIdentity } from "./viewData"

/** What the player holds, and the data of its open view. */
export type LoadedStream = {
  url: string
  /** Null when the stream entered without a `muxData` option (the trailer). */
  identity: MuxViewIdentity | null
}

export type NextStream = {
  /** Null when the request brings no URL; only its data can change then. */
  url: string | null
  /** Null when the request carries no `muxData` option. */
  identity: MuxViewIdentity | null
  /** An error reload is a new stream, also for an unchanged URL (R11). */
  errorReload?: boolean
}

export type StreamTransitionInput = {
  current: LoadedStream | null
  next: NextStream
  downloadedPlaysMonitored: boolean
  /** `validateLocalMediaUrl(url, OFFLINE_ROOT)`, injected to keep this pure. */
  isLocal: (url: string) => boolean
}

/**
 * The before-load phase runs for every swap, because the winning swap is not
 * known yet. `stage` only stages the next view's data on an attached monitor.
 */
export type BeforeLoadAction = "none" | "attach" | "detach" | "stage"

export type StreamTransition = {
  /** Merged data for the OPEN view, applied before anything else. */
  openViewUpdate: MuxViewIdentity | null
  beforeLoad: BeforeLoadAction
  /** A stream loads. Every load supersedes the settle of an earlier one. */
  loads: boolean
  /** The settle phase opens a new view, if the swap is still the latest. */
  newViewAtSettle: boolean
  /** What the player holds afterwards: the `current` of the next call. */
  loaded: LoadedStream | null
}

/** A stream reaches Mux only with a `muxData` option, and a download only
 *  when the backend can keep its local path out of every field (R20). */
export function isMonitoredStream(
  stream: LoadedStream | null,
  downloadedPlaysMonitored: boolean,
  isLocal: (url: string) => boolean,
): stream is LoadedStream {
  return (
    stream != null &&
    stream.identity != null &&
    (downloadedPlaysMonitored || !isLocal(stream.url))
  )
}

/** Mirrors the adapter's admission: one asset under one constraint is the
 *  stream the player already holds, so nothing reloads. */
function loadsNewStream(
  previousUrl: string | null,
  nextUrl: string,
  errorReload: boolean,
): boolean {
  if (errorReload || previousUrl == null) return true
  if (previousUrl === nextUrl) return false
  return !(
    isSameMuxAsset(previousUrl, nextUrl) &&
    sameQualityConstraint(previousUrl, nextUrl)
  )
}

/** The slug-tolerant rule of `sameSessionContent`: the seed path knows the
 *  slug before the id, and the Experience routes know only the id. */
function sameVideo(a: MuxViewIdentity, b: MuxViewIdentity): boolean {
  if (a.videoId && b.videoId) return a.videoId === b.videoId
  return (
    a.videoSlug != null && a.videoSlug !== "" && a.videoSlug === b.videoSlug
  )
}

/** A late value fills in; an empty one never clears a known value (KTD6). */
function merge(open: MuxViewIdentity, next: MuxViewIdentity): MuxViewIdentity {
  return {
    videoId: next.videoId || open.videoId,
    videoSlug: next.videoSlug || open.videoSlug,
    title: next.title || open.title,
  }
}

function sameIdentity(a: MuxViewIdentity, b: MuxViewIdentity): boolean {
  return (
    a.videoId === b.videoId &&
    a.videoSlug === b.videoSlug &&
    a.title === b.title
  )
}

/**
 * The one predicate for both phases of a view boundary (KTD5). An id or title
 * that arrives with a new stream goes to the open view first only for the same
 * video (a dub, quality, or container swap); a new video's data goes to its
 * new view, so the open view keeps its own id.
 */
export function planStreamTransition(
  input: StreamTransitionInput,
): StreamTransition {
  const { current, next } = input
  const monitored = (stream: LoadedStream | null) =>
    isMonitoredStream(stream, input.downloadedPlaysMonitored, input.isLocal)
  const wasMonitored = monitored(current)

  const open = current?.identity ?? null
  const merged =
    open != null && next.identity != null && sameVideo(open, next.identity)
      ? merge(open, next.identity)
      : null
  const openViewUpdate =
    wasMonitored &&
    open != null &&
    merged != null &&
    !sameIdentity(merged, open)
      ? merged
      : null

  if (
    next.url == null ||
    !loadsNewStream(current?.url ?? null, next.url, next.errorReload === true)
  ) {
    // No stream enters, so no attach or detach: a request that loses its
    // option keeps the open view until a stream enters.
    const loaded =
      current == null
        ? null
        : { url: next.url ?? current.url, identity: merged ?? open }
    return {
      openViewUpdate,
      beforeLoad: "none",
      loads: false,
      newViewAtSettle: false,
      loaded,
    }
  }

  const loaded: LoadedStream = {
    url: next.url,
    identity: merged ?? next.identity,
  }
  const willMonitor = monitored(loaded)
  let beforeLoad: BeforeLoadAction = "none"
  if (wasMonitored && willMonitor) beforeLoad = "stage"
  else if (wasMonitored) beforeLoad = "detach"
  else if (willMonitor) beforeLoad = "attach"
  return {
    openViewUpdate,
    beforeLoad,
    loads: true,
    // A fresh attach opens its first view at the first play request.
    newViewAtSettle: beforeLoad === "stage",
    loaded,
  }
}

/** The settle phase: a superseded swap opens no view (KTD5). */
export function settleAction(
  transition: Pick<StreamTransition, "newViewAtSettle">,
  swap: { token: number; latestToken: number },
): "newView" | "none" {
  return transition.newViewAtSettle && swap.token === swap.latestToken
    ? "newView"
    : "none"
}
