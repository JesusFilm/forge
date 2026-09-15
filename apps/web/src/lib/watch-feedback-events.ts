/**
 * Cross-tree trigger for the global Watch feedback composer.
 *
 * `FeedbackLauncher` is rendered by `WatchChromeShell` as a SIBLING of the
 * page tree, not an ancestor, so a React context cannot reach page-level
 * CTAs. Follows the same window-event pattern as
 * `watch-player-chrome-events.ts`: the launcher listens, any page surface
 * dispatches. Dispatching while the search overlay is open is a no-op —
 * the launcher keeps ownership of that precedence rule.
 */
export const WATCH_FEEDBACK_OPEN_EVENT = "watch-feedback-open"

export function requestWatchFeedback(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(WATCH_FEEDBACK_OPEN_EVENT))
}
