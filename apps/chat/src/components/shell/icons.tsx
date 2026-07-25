// Inline line-icons for the app shell and chat surfaces: 24×24 grid, 1.5px
// strokes, `currentColor` so callers set color via text utilities. Inlined (no
// icon dependency, no network request) and no emoji, per the Vigil rules.

type IconProps = {
  className?: string
}

const baseProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": "true" as const,
}

/** Panel/side-rail glyph — the "open/close sidebar" toggle. */
export function PanelIcon({ className }: IconProps) {
  return (
    <svg className={className} {...baseProps}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9 4v16" />
    </svg>
  )
}

/** Compose/pencil glyph — the "New conversation" action. */
export function ComposeIcon({ className }: IconProps) {
  return (
    <svg className={className} {...baseProps}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  )
}

/** Hamburger glyph — the mobile "open menu" trigger. */
export function MenuIcon({ className }: IconProps) {
  return (
    <svg className={className} {...baseProps}>
      <path d="M3 6h18" />
      <path d="M3 12h18" />
      <path d="M3 18h18" />
    </svg>
  )
}

/** Close (X) glyph — closes the mobile drawer. */
export function CloseIcon({ className }: IconProps) {
  return (
    <svg className={className} {...baseProps}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  )
}

/** Chevron (right-pointing) glyph — disclosure affordance; callers rotate it
 * via transform utilities for the open state. */
export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg className={className} {...baseProps}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

/** Up-arrow glyph — the composer's directional send affordance (feat-270). */
export function ArrowUpIcon({ className }: IconProps) {
  return (
    <svg className={className} {...baseProps}>
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  )
}

/** Stop (square) glyph — halts an in-flight reply (feat-270). */
export function StopIcon({ className }: IconProps) {
  return (
    <svg className={className} {...baseProps}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </svg>
  )
}

/** Generic person glyph — the signed-in avatar fallback (no picture, no initials). */
export function UserIcon({ className }: IconProps) {
  return (
    <svg className={className} {...baseProps}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

/** Log-in glyph — the signed-out "Sign in" affordance. */
export function SignInIcon({ className }: IconProps) {
  return (
    <svg className={className} {...baseProps}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
    </svg>
  )
}

/** Log-out glyph — the signed-in "Sign out" control. */
export function SignOutIcon({ className }: IconProps) {
  return (
    <svg className={className} {...baseProps}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}
