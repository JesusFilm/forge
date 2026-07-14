"use client"

import { useCallback, useEffect, useReducer, useRef } from "react"

import type { ResolvedSeriesBySlug } from "@/lib/content"
import { SeriesEpisodeCard } from "@/components/watch/SeriesEpisodeCard"
import { resolveEpisodeImageUrl } from "@/lib/episode-image"

type Episodes = NonNullable<ResolvedSeriesBySlug["video"]["children"]>
type Episode = NonNullable<Episodes[number]>

type SeriesEpisodesGridProps = {
  episodes: Episodes
  languageSlug: string
  parentSlug: string
  // Backdrop image painted behind the grid when no card is hovered.
  // Typically the series record's own poster.
  seriesPosterUrl?: string | null
}

// Two parallel stacks crossfade between hovered backdrops. The active
// stack carries the current URL at target opacity; the inactive stack
// sits at opacity 0 holding the previous URL. On hover the inactive
// stack's URL is replaced and the active flag flips, producing a
// CSS-only opacity crossfade where one fades in while the other fades
// out — never a frame where both are at 0, so rapid card-to-card hover
// never strobes through the dark stone base.
//
// Why useReducer: the swap is a read-then-write on activeStack that's
// also referenced from a hover callback. Using three useState hooks
// closed over from the callback reads stale values under React's
// concurrent batching — the callback sees the activeStack from the
// closure, not from the latest commit. A reducer encapsulates the
// read inside the reducer body so the dispatch carries no closure
// dependency on activeStack.
type BackdropState = {
  activeStack: "A" | "B"
  stackAUrl: string | null
  stackBUrl: string | null
}

type BackdropAction =
  | { type: "SWAP_TO"; url: string }
  | { type: "RESET_TO_POSTER"; posterUrl: string | null }

function backdropReducer(
  state: BackdropState,
  action: BackdropAction,
): BackdropState {
  switch (action.type) {
    case "SWAP_TO": {
      // No-op when the target matches the visible URL — saves an
      // invisible self-crossfade and a redundant render.
      const activeUrl =
        state.activeStack === "A" ? state.stackAUrl : state.stackBUrl
      if (action.url === activeUrl) return state
      // Flip activeStack and write the new URL into the now-active
      // slot. The slot was previously at opacity 0, so the URL change
      // is invisible; only the subsequent fade-in shows the new image.
      if (state.activeStack === "A") {
        return { ...state, activeStack: "B", stackBUrl: action.url }
      }
      return { ...state, activeStack: "A", stackAUrl: action.url }
    }
    case "RESET_TO_POSTER": {
      // Write the new poster into BOTH slots — idempotent, and
      // guarantees the inactive slot doesn't strand a stale URL that
      // would flash in on the next hover-out.
      return {
        ...state,
        stackAUrl: action.posterUrl,
        stackBUrl: action.posterUrl,
      }
    }
    default:
      return state
  }
}

export function SeriesEpisodesGrid({
  episodes,
  languageSlug,
  parentSlug,
  seriesPosterUrl = null,
}: SeriesEpisodesGridProps) {
  const [state, dispatch] = useReducer(backdropReducer, {
    activeStack: "A" as const,
    stackAUrl: seriesPosterUrl,
    stackBUrl: seriesPosterUrl,
  })

  // Ref the grid container so onBlur/onPointerOut handlers can check
  // whether focus/pointer is leaving the grid entirely vs. just moving
  // between cards. The relatedTarget read on the synthetic event lets
  // us no-op intra-grid transitions, which is the whole reason
  // delegation replaces per-card handlers (avoids strobe + reduces work).
  const gridRef = useRef<HTMLDivElement | null>(null)

  // Keep both slots in sync when the prop changes (e.g. a parent swap
  // of the series). RESET_TO_POSTER is idempotent so a single dep on
  // the prop is sufficient — no activeStack read here.
  useEffect(() => {
    dispatch({ type: "RESET_TO_POSTER", posterUrl: seriesPosterUrl })
  }, [seriesPosterUrl])

  const handleCardHover = useCallback(
    (url: string | null) => {
      const targetUrl = url ?? seriesPosterUrl
      if (!targetUrl) return
      dispatch({ type: "SWAP_TO", url: targetUrl })
    },
    [seriesPosterUrl],
  )

  // Read the hovered/focused card's backdrop URL from a data attribute
  // on the card root. Centralizing this lookup keeps the four delegated
  // handlers identical and means we don't allocate per-card arrow
  // wrappers (which were the root cause of per-tab strobing and the
  // per-render allocation finding).
  const readBackdropFromEvent = useCallback(
    (target: EventTarget | null): string | null => {
      if (!(target instanceof Element)) return null
      const card = target.closest(
        '[data-testid="series-episode-card"]',
      ) as HTMLElement | null
      if (!card) return null
      const url = card.getAttribute("data-backdrop-url")
      return url && url.length > 0 ? url : null
    },
    [],
  )

  const handleGridPointerOver = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const url = readBackdropFromEvent(event.target)
      if (url) handleCardHover(url)
    },
    [readBackdropFromEvent, handleCardHover],
  )

  // pointerout/blur fire on every intra-grid transition; we no-op when
  // the relatedTarget is still inside the grid so tab-through and
  // card-to-card pointer moves never thrash the backdrop reducer.
  const handleGridPointerOut = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const next = event.relatedTarget as Node | null
      if (next && gridRef.current?.contains(next)) return
      handleCardHover(null)
    },
    [handleCardHover],
  )

  const handleGridFocusCapture = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const url = readBackdropFromEvent(event.target)
      if (url) handleCardHover(url)
    },
    [readBackdropFromEvent, handleCardHover],
  )

  const handleGridBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget as Node | null
      if (next && gridRef.current?.contains(next)) return
      handleCardHover(null)
    },
    [handleCardHover],
  )

  const visibleEpisodes = episodes.filter(
    (episode): episode is Episode => episode != null && Boolean(episode.slug),
  )

  // Derive hasBackdrop from the currently visible stack, not from the
  // prop — once a hover has loaded a card's image into a stack, the
  // wrapper should report active even if seriesPosterUrl is null.
  const visibleUrl =
    state.activeStack === "A" ? state.stackAUrl : state.stackBUrl
  const hasBackdrop = visibleUrl != null

  const stackALayerBg = state.stackAUrl
    ? { backgroundImage: `url(${state.stackAUrl})` }
    : undefined
  const stackBLayerBg = state.stackBUrl
    ? { backgroundImage: `url(${state.stackBUrl})` }
    : undefined

  const stackAVisible = state.activeStack === "A" && state.stackAUrl != null
  const stackBVisible = state.activeStack === "B" && state.stackBUrl != null

  return (
    <section
      data-testid="series-episodes-grid-wrapper"
      data-active={hasBackdrop ? "true" : "false"}
      className="relative z-20 isolate overflow-hidden bg-stone-900 px-5 pt-16 pb-16 md:px-16 md:pt-20 md:pb-20 xl:px-24"
    >
      {/* Stack A — one of two parallel three-layer image sets that
          crossfade on hover. Layer 0 is a normal-blend base; without
          it the mix-blend-overlay layers below collapse to near-black
          against bg-stone-900. Layer 1 is a soft mix-blend-overlay
          accent. Layer 2 is the pan-zoom atmospheric: bg-size 200%
          200% pairs with the keyframe's translateX range so the image
          scrolls horizontally over 28s with a 1 → 1.3 → 1 Ken-Burns
          scale pulse. */}
      <div
        aria-hidden="true"
        data-testid="series-episodes-grid-backdrop-A-layer-0"
        className={`absolute inset-0 z-0 bg-cover bg-center bg-no-repeat blur-lg filter transition-opacity duration-700 ease-in-out ${
          stackAVisible ? "opacity-50" : "opacity-0"
        }`}
        style={stackALayerBg}
      />
      <div
        aria-hidden="true"
        data-testid="series-episodes-grid-backdrop-A-layer-1"
        className={`absolute inset-0 z-0 bg-cover bg-center bg-no-repeat blur-md filter transition-opacity duration-700 ease-in-out mix-blend-overlay ${
          stackAVisible ? "opacity-30" : "opacity-0"
        }`}
        style={stackALayerBg}
      />
      {/* Layer 2 is split: the outer wrapper carries the keyframe and
          the opacity transition; the inner div carries the background
          image. Changing background-image resets the CSS animation
          timeline on some browser/GPU paths, so isolating the URL onto
          a non-animated child keeps the pan-zoom cycle continuous
          across URL swaps. */}
      <div
        aria-hidden="true"
        data-testid="series-episodes-grid-backdrop-A-layer-2"
        className={`animate-watch-backdrop-pan-zoom absolute inset-0 z-0 transition-opacity duration-700 ease-in-out ${
          stackAVisible ? "opacity-40" : "opacity-0"
        }`}
      >
        <div
          data-testid="series-episodes-grid-backdrop-A-layer-2-image"
          className="absolute inset-0 bg-no-repeat blur-xl brightness-[.5] saturate-200 filter mix-blend-overlay"
          style={
            state.stackAUrl
              ? {
                  backgroundImage: `url(${state.stackAUrl})`,
                  backgroundSize: "200% 200%",
                  backgroundPosition: "center",
                }
              : undefined
          }
        />
      </div>

      {/* Stack B — same three layers as Stack A, painted alongside it
          so the inactive slot can be pre-loaded with the next image
          and faded in via opacity. */}
      <div
        aria-hidden="true"
        data-testid="series-episodes-grid-backdrop-B-layer-0"
        className={`absolute inset-0 z-0 bg-cover bg-center bg-no-repeat blur-lg filter transition-opacity duration-700 ease-in-out ${
          stackBVisible ? "opacity-50" : "opacity-0"
        }`}
        style={stackBLayerBg}
      />
      <div
        aria-hidden="true"
        data-testid="series-episodes-grid-backdrop-B-layer-1"
        className={`absolute inset-0 z-0 bg-cover bg-center bg-no-repeat blur-md filter transition-opacity duration-700 ease-in-out mix-blend-overlay ${
          stackBVisible ? "opacity-30" : "opacity-0"
        }`}
        style={stackBLayerBg}
      />
      {/* Stack B layer 2 — split wrapper for the same reason as Stack
          A: animation lives on the outer div, URL on the inner div. */}
      <div
        aria-hidden="true"
        data-testid="series-episodes-grid-backdrop-B-layer-2"
        className={`animate-watch-backdrop-pan-zoom absolute inset-0 z-0 transition-opacity duration-700 ease-in-out ${
          stackBVisible ? "opacity-40" : "opacity-0"
        }`}
      >
        <div
          data-testid="series-episodes-grid-backdrop-B-layer-2-image"
          className="absolute inset-0 bg-no-repeat blur-xl brightness-[.5] saturate-200 filter mix-blend-overlay"
          style={
            state.stackBUrl
              ? {
                  backgroundImage: `url(${state.stackBUrl})`,
                  backgroundSize: "200% 200%",
                  backgroundPosition: "center",
                }
              : undefined
          }
        />
      </div>

      {/* Purple-to-stone gradient tint. Always visible. Pulls the warm
          tones from the image stacks toward the page's stone/purple
          palette so the backdrop feels intentional rather than
          thumbnail-leaked. mix-blend-multiply lets the underlying
          colors show through where the gradient is light. */}
      <div
        aria-hidden="true"
        data-testid="series-episodes-grid-backdrop-tint"
        className="pointer-events-none absolute inset-0 z-0 bg-linear-to-tr from-purple-950/10 via-purple-950/10 to-stone-950/50 mix-blend-multiply"
      />

      <div
        ref={gridRef}
        data-testid="series-episodes-grid"
        className="relative z-10 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        onPointerOver={handleGridPointerOver}
        onPointerOut={handleGridPointerOut}
        onFocusCapture={handleGridFocusCapture}
        onBlur={handleGridBlur}
      >
        {visibleEpisodes.map((episode, index) => (
          <SeriesEpisodeCard
            key={episode.documentId}
            episode={episode}
            index={index}
            languageSlug={languageSlug}
            parentSlug={parentSlug}
            backdropUrl={resolveEpisodeImageUrl(episode)}
          />
        ))}
      </div>
    </section>
  )
}
