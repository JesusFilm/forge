/**
 * The collapsed-rail style policy in one place. Every collapsed presentation is
 * `md:`-scoped (collapse is desktop-only; the mobile drawer always shows full
 * content), so each slot is empty unless `collapsed` is set. Sidebar computes
 * this once and hands the relevant slots to its sub-components, replacing the
 * `collapsed && …` fragments that were dispersed across the JSX.
 */
export type CollapsedStyles = {
  /** Header row: drop horizontal padding so the icon-rail centers. */
  header: string | false
  /** Brand container: center the mark in the narrow rail. */
  brand: string | false
  /** Brand mark: fade out on hover/focus to reveal the expand toggle beneath. */
  brandMark: string | false
  /** Wordmark: hidden in the icon rail. */
  wordmark: string | false
  /** New-conversation wrapper: drop padding to center the icon button. */
  newButtonWrap: string | false
  /** New-conversation button: shrink to a centered icon-only target. */
  newButton: string | false
  /** New-conversation label: hidden in the icon rail. */
  newButtonLabel: string | false
  /** Conversation nav: hidden entirely in the icon rail. */
  nav: string | false
}

/** Build the collapsed-style slot map for the current collapsed flag. */
export function collapsedStyles(collapsed: boolean): CollapsedStyles {
  return {
    header: collapsed && "md:px-0",
    brand: collapsed && "md:justify-center",
    brandMark:
      collapsed &&
      "md:transition-opacity md:duration-300 md:group-hover/brand:opacity-0 md:group-focus-within/brand:opacity-0",
    wordmark: collapsed && "md:hidden",
    newButtonWrap: collapsed && "md:px-0",
    newButton:
      collapsed &&
      "md:mx-auto md:w-10 md:justify-center md:gap-0 md:border-transparent md:p-0 md:py-2.5 md:hover:border-transparent",
    newButtonLabel: collapsed && "md:hidden",
    nav: collapsed && "md:hidden",
  }
}
