"use client"

import { useEffect, useState } from "react"

/*
 * The feedback launcher introduces itself with its label showing, then
 * settles to the icon alone so it stops competing with the page. Three
 * independent triggers retire the label, whichever fires first:
 *
 *   - the reader scrolls (they have started consuming the page),
 *   - a grace period after their first deliberate interaction,
 *   - a backstop dwell, so a page nobody touches does not keep a floating
 *     label forever.
 *
 * A minimum dwell gates all three. Without it a scroll position restored
 * on navigation, or a stray tap in the first moment, snatches the label
 * away before anyone can read it — which is the whole point of showing it.
 */
/**
 * How many SESSIONS get the label. The launcher is mounted by each Watch
 * section's own layout rather than one shared parent, so it remounts whenever
 * someone crosses between /videos, /history, /languages and the rest — a
 * regular visitor would otherwise be introduced to the same button a dozen
 * times a week. Two sessions is enough to be noticed and remembered.
 */
export const FEEDBACK_INTRO_MAX_SESSIONS = 2

/** Counts sessions that have seen the label. Survives the tab, by design. */
const INTRO_SEEN_SESSIONS_KEY = "forge.watch.feedback_intro_sessions"
/** Marks THIS tab as already counted, so remounts within it do not re-count. */
const INTRO_SESSION_MARK_KEY = "forge.watch.feedback_intro_counted"

export const FEEDBACK_INTRO_MINIMUM_DWELL_MS = 1200
export const FEEDBACK_INTRO_INTERACTION_GRACE_MS = 2000
export const FEEDBACK_INTRO_MAXIMUM_DWELL_MS = 6000
export const FEEDBACK_INTRO_SCROLL_THRESHOLD_PX = 8

/**
 * Decides whether this session still gets the introduction, and counts it if
 * so. Storage failures fall back to introducing: a reader who cannot be
 * counted should still be told what the button is.
 */
function claimIntroForThisSession(): boolean {
  try {
    if (window.sessionStorage.getItem(INTRO_SESSION_MARK_KEY) === "1") {
      // Already counted this tab — a remount crossing section layouts, not a
      // new visit. Re-introducing here is the noise this exists to stop.
      return false
    }
    const seen = Number.parseInt(
      window.localStorage.getItem(INTRO_SEEN_SESSIONS_KEY) ?? "0",
      10,
    )
    const seenSessions = Number.isFinite(seen) && seen > 0 ? seen : 0
    if (seenSessions >= FEEDBACK_INTRO_MAX_SESSIONS) return false

    window.sessionStorage.setItem(INTRO_SESSION_MARK_KEY, "1")
    window.localStorage.setItem(
      INTRO_SEEN_SESSIONS_KEY,
      String(seenSessions + 1),
    )
    return true
  } catch {
    return true
  }
}

/**
 * `true` while the launcher should render its label, `false` once it has
 * settled to icon-only (or when this reader has already been introduced
 * `FEEDBACK_INTRO_MAX_SESSIONS` times). One-way: nothing re-arms the
 * introduction for the lifetime of the mount. Hover and focus re-reveal the
 * label, but that is pure CSS on the button and does not come back through
 * here.
 *
 * Starts `false` rather than `true` so the server-rendered markup and the
 * first client render agree — the decision needs storage, which the server
 * does not have, and disagreeing would be a hydration mismatch. The label
 * therefore arrives with the button's entrance animation instead of being
 * present in the HTML, which is how it already looked.
 */
export function useFeedbackLauncherIntro(): boolean {
  const [introducing, setIntroducing] = useState(false)

  useEffect(() => {
    // Wrapped a stack frame deep to keep react-hooks/set-state-in-effect
    // quiet, matching the EasterDates precedent. The rule's cascading-render
    // concern does not apply: `[]` deps, one-shot, and it only ever sets
    // `true`. Under StrictMode the effect runs twice, which is harmless —
    // the claim is idempotent within a session, so the second run returns
    // false and changes nothing.
    const claimIntro = () => {
      if (typeof window === "undefined") return
      if (claimIntroForThisSession()) setIntroducing(true)
    }
    claimIntro()
  }, [])

  useEffect(() => {
    if (!introducing) return
    if (typeof window === "undefined") return

    // Every timer, listener and latch below is scoped to this effect run
    // rather than held in a hook-lifetime ref, so a StrictMode remount
    // re-arms from a clean baseline instead of inheriting state the
    // previous cleanup tore down.
    const timers: number[] = []
    const baselineScrollY = window.scrollY
    let readable = false
    let retireWhenReadable = false

    const retire = () => {
      if (!readable) {
        retireWhenReadable = true
        return
      }
      setIntroducing(false)
    }

    timers.push(
      window.setTimeout(() => {
        readable = true
        if (retireWhenReadable) setIntroducing(false)
      }, FEEDBACK_INTRO_MINIMUM_DWELL_MS),
    )
    timers.push(window.setTimeout(retire, FEEDBACK_INTRO_MAXIMUM_DWELL_MS))

    const handleScroll = () => {
      const travelled = Math.abs(window.scrollY - baselineScrollY)
      if (travelled < FEEDBACK_INTRO_SCROLL_THRESHOLD_PX) return
      retire()
    }

    const handleInteraction = () => {
      // First interaction only — the grace period is measured from it, and
      // a second tap must not stack another timer.
      window.removeEventListener("pointerdown", handleInteraction)
      window.removeEventListener("keydown", handleInteraction)
      timers.push(
        window.setTimeout(retire, FEEDBACK_INTRO_INTERACTION_GRACE_MS),
      )
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    window.addEventListener("pointerdown", handleInteraction, { passive: true })
    window.addEventListener("keydown", handleInteraction)

    return () => {
      window.removeEventListener("scroll", handleScroll)
      window.removeEventListener("pointerdown", handleInteraction)
      window.removeEventListener("keydown", handleInteraction)
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [introducing])

  return introducing
}
