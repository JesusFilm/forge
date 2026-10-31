import type { MouseEvent as ReactMouseEvent } from "react"

/**
 * True when a click on an anchor is one the client router should own.
 *
 * Modified and non-primary clicks (new tab, new window, download, middle
 * click) never reach the client router, so a handler that rewrites the
 * destination for them would be silently ignored — those must fall through to
 * the browser with whatever the rendered `href` says.
 */
export function isUnmodifiedPrimaryNavigation(
  event: Pick<
    ReactMouseEvent<HTMLAnchorElement>,
    "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
  >,
): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}
