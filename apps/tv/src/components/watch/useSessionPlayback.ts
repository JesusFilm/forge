// ── Session-driven playback hook (U7) ────────────────────────────────────────
// Overlay logic active only when a watch session drives the fullscreen player.
// NON-NEGOTIABLE: no-session card playback (session.video == null) is unchanged
// (menuActive false, only the idempotent Mux auto-subtitle disable). See playerSwitch.ts.

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
   * The host's player. The dub-switch effect drives `player.replaceAsync` on
   * this SAME instance so a live dub change never recreates/releases it mid-play.
   */
  player: ExpoVideoPlayer
  /**
   * The URL the overlay was OPENED with (fixed for one playVideo, == host's
   * frozen creation source). The `menuActive` gate is evaluated against it; it's
   * also the desired source for the no-session path.
   */
  streamingUrl: string
  /**
   * Host's in-flight hide-animation handle. openMenu stops it so the chrome can't
   * fade out from under the menu; shared so all host paths manipulate one handle.
   */
  hideAnimRef: MutableRefObject<Animated.CompositeAnimation | null>
  /**
   * Host's inactivity timer. openMenu clears it (auto-hide is suppressed while
   * the menu is open; host's scheduleHide also early-returns on `menuOpenRef`).
   */
  inactivityTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  /**
   * Host's seek guard. A dub switch resets the playhead to ~0, so a pending seek
   * target would never be reached — freezing the progress bar. The switch effect
   * clears it here so timeUpdate resumes immediately.
   */
  seekTargetRef: MutableRefObject<number | null>
  /**
   * Host's stable scheduleHide ref. closeMenu re-arms auto-hide through it (same
   * indirection the host uses everywhere else).
   */
  scheduleHideRef: MutableRefObject<() => void>
  /**
   * One-shot "reveal focus" trigger. closeMenu calls this to route focus back to
   * play/pause via the host's revealFocusPending claim (mirrors Fix #5). Threaded
   * as a callback rather than reaching into the host's state setter directly.
   */
  onRequestRevealFocus: () => void
}

export type UseSessionPlaybackResult = {
  /**
   * True only when a session video with variants is present AND the playing URL
   * IS that session's active dub. Gates the menu, dub-switch, and subtitle layer.
   * False for experience-card playback.
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
  /** Active subtitle VTT src for SubtitleOverlay, or null (renders nothing; also the no-session value). */
  activeVttSrc: string | null
  /**
   * Display name of the active dub's language, or null when the session isn't
   * driving this overlay. Feeds the Language pill's sub-caption (U8 chrome).
   */
  audioLabel: string | null
  /**
   * Display name of the active subtitle language, or null when off/unresolved.
   * Resolution mirrors activeVttSrc, falling back to the slug so the Subtitles
   * pill never lies about CC being on.
   */
  subtitleLabel: string | null
  /**
   * True while a dub/language source swap is in flight (before replaceAsync +
   * until it settles). The host's QoE rebuffer gate reads this so the spurious
   * statusChange:"loading" a swap fires is NOT counted as a real rebuffer.
   */
  sourceSwappingRef: MutableRefObject<boolean>
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
  // Shared overlay: experience-card playVideo has no session, so reads below are
  // empty and menuActive is false (no menu/subtitle/dub-switch). Every new
  // behavior gates on the stale-safe `menuActive` predicate (inPlayerMenuVisible).
  const session = useWatchSession()
  const sessionActiveHls = session.activeVariant?.hls ?? null

  // Gate is on the OPENED url (streamingUrl, fixed per playVideo). A mid-play dub
  // switch makes activeVariant.hls != streamingUrl, flipping the raw gate false and
  // tearing down menu/subtitles. So LATCH: session-driven while video present; reset on clear.
  const rawGateMatch = inPlayerMenuVisible({
    sessionVideo: session.video,
    activeVariantHls: sessionActiveHls,
    currentUrl: streamingUrl,
  })
  const menuLatchedRef = useRef(false)
  if (rawGateMatch) menuLatchedRef.current = true
  if (session.video == null) menuLatchedRef.current = false
  const menuActive = session.video != null && menuLatchedRef.current

  // In-player menu open/closed. Opening suppresses auto-hide; closing restores
  // focus to play/pause via the one-shot revealFocusPending claim. Only true
  // while menuActive; menuSection records which pill opened it.
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

  // True while a swap is loading a new source. The host's QoE rebuffer gate
  // reads it so a swap's spurious statusChange:"loading" isn't miscounted.
  const sourceSwappingRef = useRef(false)

  // ── Live dub-switch (U7) ────────────────────────────────────────────
  // Desired source = active dub HLS when menuActive, else streamingUrl (no-session
  // path no-ops on loadedUrlRef equality). Swap-vs-noop is by Mux playback id
  // (shouldReplaceSource) so same asset under two URLs doesn't rebuffer; token guards overlap.
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
    // A dub switch resets the playhead to ~0, so a pending seek target would
    // never be reached — freezing the progress bar. Clear it so timeUpdate resumes.
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

    // Mark the swap in flight so the host's QoE rebuffer gate ignores the
    // spurious statusChange:"loading" this source change fires.
    sourceSwappingRef.current = true
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
      .finally(() => {
        // Only the latest swap clears the flag — a superseded swap settling must
        // not clear it while a newer swap is still loading (miscounts a rebuffer).
        if (token === switchTokenRef.current) sourceSwappingRef.current = false
      })
  }, [desiredSource, player, seekTargetRef])

  // ── Disable Mux auto-subtitle tracks (U7) ───────────────────────────
  // CMS VTT subtitles render via SubtitleOverlay instead. AVPlayer auto-selects a
  // track at sourceLoad / tracks-available / device-locale, so we listen on all
  // three. Runs for ALL paths (idempotent) but never enables our overlay (gated on menuActive).
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

  // Resolve the active subtitle TRACK for the active slug — undefined unless
  // menuActive AND captions on AND a matching track loaded. One guarded lookup
  // feeds both the VTT src and the label, so the label can't diverge from the track.
  const subtitlesOn =
    menuActive && session.subtitleEnabled && session.activeSubtitleSlug != null
  const activeSubtitle = subtitlesOn
    ? session.activeVariantMedia?.subtitles.find(
        (s) => s.languageSlug === session.activeSubtitleSlug,
      )
    : undefined

  // Null → SubtitleOverlay renders nothing (also the no-session value).
  const activeVttSrc = activeSubtitle?.vttSrc ?? null

  // Display names for the U8 chrome (Language / Subtitles pill sub-captions).
  // Same gating as the rest of the session-driven surface: null when the
  // session isn't driving this overlay, so no-session playback shows nothing.
  const audioLabel = menuActive
    ? (session.activeVariant?.languageName ?? null)
    : null
  const subtitleLabel = subtitlesOn
    ? (activeSubtitle?.languageName ?? session.activeSubtitleSlug)
    : null

  // ── In-player menu open/close (U7) ──────────────────────────────────
  // Opening cancels any pending hide so chrome can't fade under the menu; closing
  // re-arms auto-hide and restores focus via revealFocusPending. Both useCallback-stable
  // (closeMenu feeds InPlayerMenu renderRow deps); latest-ref for host callback mirrors scheduleHideRef.
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
    sourceSwappingRef,
  }
}
