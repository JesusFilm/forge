/**
 * The root player's REQUEST store (U6) — what the one hoisted player should
 * own right now, and where its video view sits.
 *
 * It is deliberately separate from `store.ts`. That store owns a mini-player
 * SESSION, which exists only once a video has earned a window; this one owns
 * the mechanical inputs a surface hands to the player (source, poster,
 * subtitles, progress identity) and the measured rect its view is drawn at.
 * Keeping them apart is what lets the series trailer play through the same
 * single player without ever creating a session (R19, AE14).
 *
 * React-native-free by construction, like the other modules in this folder:
 * surfaces attach as numbered SLOTS and the newest admissible slot owns the
 * player. That is what makes a stacked pair of watch screens deterministic —
 * the top screen owns the player, and popping it hands ownership back without
 * the lower screen having to re-render.
 */

import {
  getMiniPlayerStore,
  sessionIdentityKey,
  type MiniPlayerStore,
} from "./store"
import { canOriginateRoutePattern } from "./presentation"
import { extractMuxPlaybackId } from "../muxThumbnail"

/** Window coordinates of the surface the video view is drawn into (KTD17). */
export type PlaybackRect = {
  x: number
  y: number
  width: number
  height: number
}

/**
 * What a surface publishes about the session its video may become. `null` on a
 * request means the surface NEVER originates a session — the series trailer,
 * and any future R19-excluded surface.
 */
export type PlaybackSessionDescriptor = {
  videoId: string | null
  videoSlug: string
  title: string
  posterUrl: string | null
  languageSlug: string | null
  /** The route pattern this session would originate from (R19). */
  originPattern: string
}

/** The bounded snapshot a surface pushes up, rather than the root pulling. */
export type PlaybackRequest = {
  streamingUrl: string | null
  posterUrl: string | null
  subtitleVttSrc: string | null
  fullscreen: boolean
  autostart: boolean
  resumeAtSeconds: number | null
  /** Progress identity, flattened: a nested object would defeat the
   *  shallow-equality gate that keeps a re-rendering screen from re-publishing. */
  progressVideoId: string | null
  progressVideoSlug: string | null
  progressLanguageSlug: string | null
  onToggleFullscreen: (() => void) | null
  session: PlaybackSessionDescriptor | null
}

/**
 * Live playback facts, read at detach time. Getters rather than values: a
 * position pushed on every poll tick would notify every consumer once a second
 * (KTD2's whole reason for a store), and the only moment this is read is the
 * one where the answer must be current.
 */
export type PlaybackFactsSource = {
  hasPlaybackStarted: () => boolean
  /** Whether this video already ran to its end. The window's own ending is a
   *  session PHASE; this is the same fact for a video that never had one. */
  hasReachedEnd: () => boolean
  readPosition: () => number
  readDuration: () => number
}

export type PlaybackRequestSnapshot = {
  request: PlaybackRequest | null
  /** Null while no mounted slot owns the request — the state a backed-out
   *  video is in until U7's window gives its view a frame again. */
  rect: PlaybackRect | null
  /** The slot that owns the request, so a slot can tell whether it is the one
   *  being drawn into (a refused trailer shows its poster instead). */
  slotId: number | null
  /** Published by the host from the player's own status, so the full view and
   *  the window both read one failure state (R22). */
  loadFailed: boolean
}

export type PlaybackRequestStore = ReturnType<typeof createPlaybackRequestStore>

const EMPTY_FACTS: PlaybackFactsSource = {
  hasPlaybackStarted: () => false,
  hasReachedEnd: () => false,
  readPosition: () => 0,
  readDuration: () => 0,
}

/**
 * The admission predicate (U6). Keyed on playback HAVING STARTED, never on a
 * source string existing: the watch screen accepts a back press in five
 * pre-playback states, and a window for a video that never played is AE10's
 * regression.
 *
 * A video that already reached its end is refused for the same reason a video
 * that never played is: there is nothing left to continue watching.
 *
 * So is a surface that never had a stream: `hasPlaybackStarted` reads the LIVE
 * player, which may still be running ANOTHER route's video (the series trailer
 * beneath, the outgoing episode of an Up Next replace).
 */
export function shouldOriginateSession(input: {
  hasPlaybackStarted: boolean
  hasReachedEnd: boolean
  hasSource: boolean
  session: PlaybackSessionDescriptor | null
}): boolean {
  if (!input.hasPlaybackStarted) return false
  if (input.hasReachedEnd) return false
  if (!input.hasSource) return false
  if (input.session == null) return false
  return canOriginateRoutePattern(input.session.originPattern)
}

/**
 * Same video, whichever key each side happens to carry. A remounted screen can
 * name a video by slug before its record lands and by id afterwards, so an
 * id-only compare reads one video as two.
 */
export function sameSessionContent(
  a: Pick<PlaybackSessionDescriptor, "videoId" | "videoSlug">,
  b: Pick<PlaybackSessionDescriptor, "videoId" | "videoSlug">,
): boolean {
  if (a.videoId != null && b.videoId != null) return a.videoId === b.videoId
  return a.videoSlug === b.videoSlug
}

/**
 * Same underlying stream, tolerant of the seed-vs-canonical URL split: two Mux
 * URLs naming one playbackId are one asset; non-Mux URLs (offline files)
 * compare exactly. This is what lets admission trust a live `player.playing`
 * read — the state is only evidence about the video it was read FOR.
 */
export function sameStreamSource(a: string, b: string): boolean {
  const aId = extractMuxPlaybackId(a)
  const bId = extractMuxPlaybackId(b)
  if (aId != null && bId != null) return aId === bId
  return a === b
}

/** What the player currently holds, and for which dub. */
export type LoadedSource = { url: string; languageSlug: string | null }

/**
 * R4: which URL the player should hold for an incoming request.
 *
 * A screen that remounts onto a video already playing resolves its source chain
 * (`offlineSource ?? activeVariant?.hls ?? video?.streamingUrl ?? seed`) from a
 * different starting state, so it can name the SAME video with a different URL.
 * Handing that to the player reloads it, which restarts playback from zero —
 * the opposite of expanding back to where playback had reached.
 *
 * A dub switch is the case that must still reach the player, and it is
 * distinguishable: it NAMES a language, and a different one. A request that
 * names none is a half-resolved remount, never a choice the viewer made.
 */
export function sourceForRequest(input: {
  requested: string | null
  loaded: LoadedSource | null
  language: string | null
  /** A live session already owns this content — the expand case, and the only
   *  one where the player is guaranteed to hold this video already. */
  adoptable: boolean
}): string | null {
  if (!input.adoptable) return input.requested
  if (input.loaded == null || input.requested == null) return input.requested
  if (input.language != null && input.language !== input.loaded.languageSlug)
    return input.requested
  return input.loaded.url
}

/** Field-wise equality, so a screen that re-renders does not re-publish. */
export function samePlaybackRequest(
  a: PlaybackRequest,
  b: PlaybackRequest,
): boolean {
  return (
    a.streamingUrl === b.streamingUrl &&
    a.posterUrl === b.posterUrl &&
    a.subtitleVttSrc === b.subtitleVttSrc &&
    a.fullscreen === b.fullscreen &&
    a.autostart === b.autostart &&
    a.resumeAtSeconds === b.resumeAtSeconds &&
    a.progressVideoId === b.progressVideoId &&
    a.progressVideoSlug === b.progressVideoSlug &&
    a.progressLanguageSlug === b.progressLanguageSlug &&
    a.onToggleFullscreen === b.onToggleFullscreen &&
    sameSession(a.session, b.session)
  )
}

function sameSession(
  a: PlaybackSessionDescriptor | null,
  b: PlaybackSessionDescriptor | null,
): boolean {
  if (a == null || b == null) return a === b
  return (
    a.videoId === b.videoId &&
    a.videoSlug === b.videoSlug &&
    a.title === b.title &&
    a.posterUrl === b.posterUrl &&
    a.languageSlug === b.languageSlug &&
    a.originPattern === b.originPattern
  )
}

type Slot = { request: PlaybackRequest; rect: PlaybackRect | null }

export function createPlaybackRequestStore(deps: {
  sessionStore: MiniPlayerStore
}) {
  const { sessionStore } = deps
  const slots = new Map<number, Slot>()
  const listeners = new Set<() => void>()
  let nextSlotId = 1
  let facts: PlaybackFactsSource = EMPTY_FACTS
  let loadFailed = false
  // The request of a video whose slot has gone but whose session still owns the
  // player. This is what makes the player outlive the route (R1, R4).
  let retained: PlaybackRequest | null = null
  let version = 0
  let cachedVersion = -1
  let cachedSnapshot: PlaybackRequestSnapshot = {
    request: null,
    rect: null,
    slotId: null,
    loadFailed: false,
  }
  let reconciling = false
  let depth = 0

  /**
   * A surface that cannot originate a session may not TAKE the player from a
   * live one. This is AE14's silence: the series trailer shows its poster while
   * a window holds playback, rather than racing it for the decoder.
   */
  function admissible(request: PlaybackRequest): boolean {
    if (request.session != null) return true
    return sessionStore.getSnapshot().session == null
  }

  function currentSlotId(): number | null {
    let best: number | null = null
    for (const [id, slot] of slots) {
      if (!admissible(slot.request)) continue
      if (best == null || id > best) best = id
    }
    return best
  }

  /**
   * The surface that would take the player back on a detach, for admission
   * only. It must carry a session: a session-less surface beneath (the series
   * trailer) is admissible only while no session exists, so counting it would
   * swallow the window the departing video just earned (R1).
   */
  function successorSlotId(): number | null {
    let best: number | null = null
    for (const [id, slot] of slots) {
      if (slot.request.session == null) continue
      if (best == null || id > best) best = id
    }
    return best
  }

  function build(): PlaybackRequestSnapshot {
    const id = currentSlotId()
    if (id != null) {
      const slot = slots.get(id) as Slot
      return { request: slot.request, rect: slot.rect, slotId: id, loadFailed }
    }
    return { request: retained, rect: null, slotId: null, loadFailed }
  }

  /**
   * A different video taking the player over ends the session in place (R12).
   * Inside the commit, before any listener is notified, so the "replaced" flush
   * still lands on the departing video's recorder — U5's ordering hazard.
   */
  function reconcileSession(next: PlaybackRequest | null) {
    if (reconciling) return
    const session = sessionStore.getSnapshot().session
    if (session == null || next == null) return
    if (
      next.session != null &&
      sessionIdentityKey(next.session) === sessionIdentityKey(session)
    )
      return
    reconciling = true
    try {
      sessionStore.end("replaced")
    } finally {
      reconciling = false
    }
  }

  /** Reconciling ends a session, which re-enters through the subscription
   *  below. Depth-guarded so that lands as ONE notification carrying the
   *  settled state, never two carrying the same one. */
  function commit() {
    version += 1
    depth += 1
    try {
      reconcileSession(build().request)
    } finally {
      depth -= 1
    }
    if (depth > 0) return
    for (const listener of listeners) listener()
  }

  // A session that ends releases the player it was holding; without this the
  // retained request would keep a dismissed video loaded forever.
  sessionStore.subscribe(() => {
    if (sessionStore.getSnapshot().session != null) return
    if (retained == null) return
    retained = null
    commit()
  })

  return {
    getSnapshot(): PlaybackRequestSnapshot {
      if (cachedVersion !== version) {
        cachedSnapshot = build()
        cachedVersion = version
      }
      return cachedSnapshot
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /** Mount a surface that wants the player. The newest one wins. */
    attachSlot(request: PlaybackRequest): number {
      const id = nextSlotId++
      slots.set(id, { request, rect: null })
      commit()
      return id
    },

    /** Republish from a re-rendering surface; equal requests do nothing. */
    updateSlot(id: number, request: PlaybackRequest): void {
      const slot = slots.get(id)
      if (slot == null) return
      if (samePlaybackRequest(slot.request, request)) return
      slots.set(id, { request, rect: slot.rect })
      commit()
    },

    setSlotRect(id: number, rect: PlaybackRect | null): void {
      const slot = slots.get(id)
      if (slot == null) return
      const previous = slot.rect
      if (
        previous != null &&
        rect != null &&
        previous.x === rect.x &&
        previous.y === rect.y &&
        previous.width === rect.width &&
        previous.height === rect.height
      )
        return
      slots.set(id, { request: slot.request, rect })
      commit()
    },

    /**
     * The surface goes away. THIS is the committed back press: a swipe released
     * without committing never unmounts the screen, so it can never publish a
     * session (AE18's cancel path costs no extra machinery).
     */
    detachSlot(id: number): void {
      const slot = slots.get(id)
      if (slot == null) return
      const wasCurrent = currentSlotId() === id
      slots.delete(id)
      if (wasCurrent) {
        // A stacked watch screen is waiting to take the player back. No window
        // is owed there — the screen beneath resumes, exactly as it does today.
        const successor = successorSlotId()
        const descriptor = slot.request.session
        if (
          successor == null &&
          descriptor != null &&
          shouldOriginateSession({
            hasPlaybackStarted: facts.hasPlaybackStarted(),
            hasReachedEnd: facts.hasReachedEnd(),
            hasSource: slot.request.streamingUrl != null,
            session: descriptor,
          })
        ) {
          sessionStore.start({
            videoId: descriptor.videoId,
            videoSlug: descriptor.videoSlug,
            languageSlug: descriptor.languageSlug,
            title: descriptor.title,
            posterUrl: descriptor.posterUrl,
            originPattern: descriptor.originPattern,
            positionSeconds: facts.readPosition(),
            durationSeconds: facts.readDuration(),
            // Admission just verified started-and-unfinished playback; a dead
            // stream is the one ending admission cannot see, so it gates this.
            playbackLive: !loadFailed,
          })
          retained = slot.request
        } else if (retained === slot.request) {
          retained = null
        }
      }
      commit()
    },

    setPlaybackFactsSource(source: PlaybackFactsSource | null): void {
      facts = source ?? EMPTY_FACTS
    },

    setLoadFailed(next: boolean): void {
      if (loadFailed === next) return
      loadFailed = next
      commit()
    },

    /** Module singletons outlive a test file; this is the seam that clears one
     *  without reaching into its internals. */
    reset(): void {
      slots.clear()
      retained = null
      facts = EMPTY_FACTS
      loadFailed = false
      commit()
    },
  }
}

let store: PlaybackRequestStore | null = null

/** The app-wide root-playback request store. */
export function getPlaybackRequestStore(): PlaybackRequestStore {
  if (!store)
    store = createPlaybackRequestStore({ sessionStore: getMiniPlayerStore() })
  return store
}
