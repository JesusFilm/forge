// ── Session-driven playback hook (U7) ────────────────────────────────────────
// Extracted from VideoPlayer.tsx (pure refactor — zero behavior change). This
// hook owns the block of overlay logic that ONLY activates when a watch session
// is driving the fullscreen player: the in-player menu open/close, the
// stale-session-safe `menuActive` gate, the live dub-switch (frozen-source +
// replaceAsync), the Mux auto-subtitle disabling, and the active-VTT resolution.
//
// CHARACTERIZATION — the no-session contract (NON-NEGOTIABLE INVARIANT):
// Experience-card playback calls VideoPlayerContext.playVideo(url) with NO watch
// session populated (session.video == null). In that path:
//   - `menuActive` is false (the inPlayerMenuVisible gate returns false),
//   - `desiredSource` is always the `streamingUrl` prop (which equals the frozen
//     creation source), so the dub-switch effect short-circuits on the
//     loadedUrlRef equality and never touches the player,
//   - `activeVttSrc` is null → no subtitle layer mounts,
//   - the lazy media fetch never fires.
// The Mux auto-subtitle disabling DOES run for all paths (cheap, idempotent) —
// exactly as before, so an experience-card play never surfaces a stray
// Mux-burned track either.
//
// The pure decision logic lives in playerSwitch.ts (inPlayerMenuVisible /
// shouldReplaceSource); this hook is the React wiring around it.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react"
import type { VideoPlayer as ExpoVideoPlayer } from "expo-video"
import type { Animated } from "react-native"

import { useWatchSession } from "../../contexts/WatchSessionProvider"
import { inPlayerMenuVisible, shouldReplaceSource } from "./playerSwitch"
import { validateStreamingUrl } from "../../lib/validateUrl"

/** The two sections of the in-player menu (split pills, U8). */
export type InPlayerMenuSection = "language" | "subtitles"

export type UseSessionPlaybackParams = {
  /**
   * The expo-video player instance created by the host's useVideoPlayer. The
   * dub-switch effect drives `player.replaceAsync` on this SAME instance so a
   * live dub change never recreates (and releases) the player mid-play.
   */
  player: ExpoVideoPlayer
  /**
   * The URL the overlay was OPENED with (the `streamingUrl` prop — fixed for the
   * lifetime of one playVideo). This is also the host's frozen creation source.
   * The `menuActive` gate is evaluated against it, and it is the desired source
   * for the no-session path.
   */
  streamingUrl: string
  /**
   * The host's in-flight hide-animation handle. openMenu stops it so the chrome
   * doesn't fade out from under the menu. Shared so the host's reveal/error/
   * foreground paths and this hook all manipulate the SAME handle.
   */
  hideAnimRef: MutableRefObject<Animated.CompositeAnimation | null>
  /**
   * The host's inactivity timer. openMenu clears it (auto-hide is suppressed
   * while the menu is open; the host's scheduleHide also early-returns on
   * `menuOpenRef`).
   */
  inactivityTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  /**
   * The host's seek guard. A dub switch resets the playhead to ~0, so any
   * pending seek target would never be reached again — leaving setCurrentTime
   * suppressed forever and freezing the progress bar. The switch effect clears
   * it here so timeUpdate resumes immediately.
   */
  seekTargetRef: MutableRefObject<number | null>
  /**
   * The host's stable scheduleHide ref. closeMenu re-arms auto-hide through it
   * (same indirection the host uses everywhere else).
   */
  scheduleHideRef: MutableRefObject<() => void>
  /**
   * One-shot "reveal focus" trigger. closeMenu calls this to route focus back to
   * play/pause via the host's revealFocusPending claim (mirrors Fix #5 / reveal
   * pattern). Threaded as a callback rather than reaching into the host's state
   * setter directly.
   */
  onRequestRevealFocus: () => void
}

export type UseSessionPlaybackResult = {
  /**
   * True only when a session video with variants is present AND the
   * currently-playing URL IS that session's active dub. Gates the in-player
   * menu, the dub-switch, and the subtitle layer. False for experience-card
   * playback.
   */
  menuActive: boolean
  /** Whether the in-player menu is currently open. */
  menuOpen: boolean
  /**
   * Which section the open menu shows — "language" (dub list) or "subtitles".
   * Set by openMenu; meaningless while menuOpen is false. Mirrors the details
   * page's separate Language / Subtitles pickers (U8 split pills).
   */
  menuSection: InPlayerMenuSection
  /**
   * Ref mirror of menuOpen, read synchronously by the host's scheduleHide guard
   * (which runs from native event callbacks before React commits state).
   */
  menuOpenRef: MutableRefObject<boolean>
  /** Open the in-player menu on a section — suppresses auto-hide. */
  openMenu: (section: InPlayerMenuSection) => void
  /** Close the in-player menu — re-arms auto-hide + restores focus. */
  closeMenu: () => void
  /**
   * The active subtitle VTT src for the SubtitleOverlay, or null. Null →
   * SubtitleOverlay renders nothing (also the no-session value).
   */
  activeVttSrc: string | null
  /**
   * Display name of the active dub's language ("English"), or null when the
   * session isn't driving this overlay. Feeds the top-bar status chip and the
   * Audio & Subtitles pill sub-caption (U8 player chrome).
   */
  audioLabel: string | null
  /**
   * Display name of the active subtitle language, or null when subtitles are
   * off / unresolved. Resolution mirrors activeVttSrc (active dub's loaded
   * media), falling back to the slug so the chip never lies about CC being on.
   */
  subtitleLabel: string | null
}

export function useSessionPlayback({
  player,
  streamingUrl,
  hideAnimRef,
  inactivityTimerRef,
  seekTargetRef,
  scheduleHideRef,
  onRequestRevealFocus,
}: UseSessionPlaybackParams): UseSessionPlaybackResult {
  // ── Watch session (U7) ──────────────────────────────────────────────
  // The overlay is SHARED infrastructure. Experience-card playback calls
  // playVideo(url) with NO session populated (session.video == null); in that
  // path the session reads below are all empty and `menuActive` is false, so
  // the overlay behaves EXACTLY as before this unit (no in-player menu, no
  // subtitle layer, no dub-switch). Every new behavior is gated on the
  // stale-session-safe `menuActive` predicate (inPlayerMenuVisible) — true only
  // when a session video with variants is present AND the currently-playing URL
  // IS that session's active dub.
  const session = useWatchSession()
  const sessionActiveHls = session.activeVariant?.hls ?? null

  // Gate, evaluated against the URL this overlay was OPENED with (the
  // `streamingUrl` prop — fixed for the lifetime of one playVideo). On open this
  // is the session's active dub, so the gate matches. A subsequent in-player dub
  // switch changes session.activeVariant.hls to a NEW asset that no longer
  // equals `streamingUrl`, which would otherwise flip the raw gate to false and
  // tear down the menu/subtitles mid-switch. So we LATCH: once the gate is true
  // for this play, stay session-driven as long as a session video is present
  // (the details screen stays mounted behind the overlay, so session.video is
  // stable). The latch resets when the session clears (experience-card play).
  const rawGateMatch = inPlayerMenuVisible({
    sessionVideo: session.video,
    activeVariantHls: sessionActiveHls,
    currentUrl: streamingUrl,
  })
  const menuLatchedRef = useRef(false)
  if (rawGateMatch) menuLatchedRef.current = true
  if (session.video == null) menuLatchedRef.current = false
  const menuActive = session.video != null && menuLatchedRef.current

  // In-player menu open/closed. Opening suppresses auto-hide; closing returns
  // focus to play/pause via the one-shot revealFocusPending claim (set in the
  // close handler below). Only ever true while menuActive (the open controls
  // are only rendered then), but we still gate the render on both for safety.
  // menuSection records which pill opened it (Language vs Subtitles).
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuSection, setMenuSection] =
    useState<InPlayerMenuSection>("language")
  const menuOpenRef = useRef(false)
  useEffect(() => {
    menuOpenRef.current = menuOpen
  }, [menuOpen])

  // The source currently loaded into the player, tracked separately from the
  // frozen creationSource (host) so swap decisions can compare against it (by
  // Mux id).
  const loadedUrlRef = useRef(streamingUrl)

  // Guards overlapping switches: each switch bumps the token; an async
  // replaceAsync resolution only re-applies play state / re-arms if its token
  // is still the latest, so rapid dub changes never strand on a stale target.
  const switchTokenRef = useRef(0)

  // ── Live dub-switch (U7) ────────────────────────────────────────────
  // The CURRENT desired source is the session's active dub HLS when the menu is
  // active, else the `streamingUrl` prop. For experience-card playback (no
  // session) menuActive is false → desiredSource is always the prop, which is
  // also the frozen creationSource → this effect's body short-circuits on the
  // loadedUrlRef equality and never touches the player. So the no-session path
  // is unchanged.
  //
  // On a real change we decide swap-vs-noop by Mux playback id (shouldReplaceSource):
  // the same asset under two URL strings (seed vs stored hls) is a no-op so we
  // don't rebuffer; only a genuinely different asset calls replaceAsync. A
  // switch token guards overlapping switches so only the latest target resumes.
  const desiredSource = menuActive ? sessionActiveHls : streamingUrl
  useEffect(() => {
    if (!desiredSource || desiredSource === loadedUrlRef.current) return
    if (shouldReplaceSource(loadedUrlRef.current, desiredSource) === "noop") {
      // Same asset (different URL string) or an invalid/non-Mux target — keep
      // the current asset playing; just record the canonical loaded url so a
      // later real change compares correctly. Reject invalid sources entirely.
      if (validateStreamingUrl(desiredSource)) {
        loadedUrlRef.current = desiredSource
      }
      return
    }

    const target = desiredSource
    loadedUrlRef.current = target
    // A dub switch resets the playhead to ~0, so any pending seek target (set
    // by Forward/Rewind, cleared only when a timeUpdate reaches it) would never
    // be reached again — leaving setCurrentTime suppressed forever and freezing
    // the progress bar. Clear it here so timeUpdate resumes immediately.
    seekTargetRef.current = null
    const token = ++switchTokenRef.current
    // Read LIVE playing state (not React `isPaused`, which lags a tick) so the
    // resume decision reflects ground truth at switch time.
    const wasPlaying = player.playing

    const resume = () => {
      // Only the latest switch re-applies play state; a superseded switch bails.
      if (token !== switchTokenRef.current) return
      if (!wasPlaying) return
      try {
        player.play()
      } catch {
        // Player already released.
      }
    }

    // replaceAsync loads off the main thread (replace() blocks the UI thread for
    // HLS). Fall back to the synchronous path (disableWarning=true) if it rejects.
    void player
      .replaceAsync(target)
      .then(resume)
      .catch(() => {
        // resume() is token-guarded and self-wrapped in try/catch, so run it
        // unconditionally after the synchronous fallback — even if replace()
        // throws (player released), the resume attempt is a safe no-op.
        try {
          player.replace(target, true)
        } catch {
          // Player already released.
        }
        resume()
      })
  }, [desiredSource, player, seekTargetRef])

  // ── Disable Mux auto-subtitle tracks (U7) ───────────────────────────
  // Admin CMS VTT subtitles are rendered by SubtitleOverlay (in the host)
  // instead. AVPlayer can auto-select a track at source load, tracks-available,
  // or a device-locale match — these three signals cover every re-selection.
  // This runs for ALL playback paths (cheap, idempotent), so an experience-card
  // play never surfaces a stray Mux-burned track either; it does not enable our
  // overlay (that is gated on menuActive).
  useEffect(() => {
    const disable = () => {
      try {
        if (player.subtitleTrack != null) player.subtitleTrack = null
      } catch {
        // Player already released.
      }
    }
    const subs = [
      player.addListener("availableSubtitleTracksChange", disable),
      player.addListener("subtitleTrackChange", disable),
      player.addListener("sourceLoad", disable),
    ]
    disable()
    return () => {
      subs.forEach((s) => {
        try {
          s.remove()
        } catch (e) {
          console.error("[VideoPlayer] subtitleTrack listener cleanup:", e)
        }
      })
    }
  }, [player])

  // ── Lazy-load active dub media when subtitles are needed (U7) ────────
  // Only fetch the active dub's media (GET_VIDEO_DUB → subtitles) when the
  // session is driving this overlay AND captions are on. ensureActiveVariantMedia
  // is deduped per dub id, so this is safe to call on every relevant change.
  // Inert for experience-card playback (menuActive false).
  useEffect(() => {
    if (menuActive && session.subtitleEnabled) {
      session.ensureActiveVariantMedia()
    }
  }, [menuActive, session.subtitleEnabled, session.ensureActiveVariantMedia])

  // Resolve the active subtitle VTT src from the session's loaded media for the
  // active subtitle slug — null unless the session is driving this overlay AND
  // captions are on AND a matching track has loaded. Null → SubtitleOverlay
  // renders nothing.
  const activeVttSrc =
    menuActive && session.subtitleEnabled && session.activeSubtitleSlug != null
      ? (session.activeVariantMedia?.subtitles.find(
          (s) => s.languageSlug === session.activeSubtitleSlug,
        )?.vttSrc ?? null)
      : null

  // Display names for the U8 chrome (status chip + Audio & Subtitles pill).
  // Same gating as the rest of the session-driven surface: null when the
  // session isn't driving this overlay, so no-session playback shows nothing.
  const audioLabel = menuActive
    ? (session.activeVariant?.languageName ?? null)
    : null
  const activeSubtitle =
    menuActive && session.subtitleEnabled && session.activeSubtitleSlug != null
      ? session.activeVariantMedia?.subtitles.find(
          (s) => s.languageSlug === session.activeSubtitleSlug,
        )
      : null
  const subtitleLabel =
    menuActive && session.subtitleEnabled && session.activeSubtitleSlug != null
      ? (activeSubtitle?.languageName ?? session.activeSubtitleSlug)
      : null

  // ── In-player menu open/close (U7) ──────────────────────────────────
  // Opening from a hidden-chrome state is not supported (the open control is
  // only focusable while controls are visible) — the viewer reveals the chrome
  // first (D-pad), then opens the menu. Opening cancels any pending hide so the
  // chrome doesn't fade under the menu; closing re-arms auto-hide and routes
  // focus back to play/pause via the one-shot revealFocusPending claim.
  //
  // Both are useCallback-stable: closeMenu flows into InPlayerMenu's renderRow
  // deps, and the host re-renders every timeUpdate (~1Hz) during playback — an
  // unstable identity would re-render every mounted dub row each second while
  // the menu is open. Latest-ref pattern for the host callback (mirrors
  // scheduleHideRef).
  const onRequestRevealFocusRef = useRef(onRequestRevealFocus)
  onRequestRevealFocusRef.current = onRequestRevealFocus
  const openMenu = useCallback(
    (section: InPlayerMenuSection) => {
      // Stop any in-flight hide so its completion callback can't flip
      // controlsVisible=false after the menu opens (captured-handle pattern,
      // mirrors revealControls / the error + foreground paths).
      if (hideAnimRef.current != null) {
        hideAnimRef.current.stop()
        hideAnimRef.current = null
      }
      if (inactivityTimerRef.current != null) {
        clearTimeout(inactivityTimerRef.current)
        inactivityTimerRef.current = null
      }
      setMenuSection(section)
      menuOpenRef.current = true
      setMenuOpen(true)
    },
    [hideAnimRef, inactivityTimerRef],
  )
  const closeMenu = useCallback(() => {
    menuOpenRef.current = false
    setMenuOpen(false)
    // One-shot focus restore to play/pause (mirrors Fix #5 / reveal pattern).
    onRequestRevealFocusRef.current()
    scheduleHideRef.current()
  }, [scheduleHideRef])

  return {
    menuActive,
    menuOpen,
    menuSection,
    menuOpenRef,
    openMenu,
    closeMenu,
    activeVttSrc,
    audioLabel,
    subtitleLabel,
  }
}
