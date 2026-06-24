// Inline line-icons for the sidebar shell: 24×24 grid, 1.5px strokes,
// `currentColor` so callers set color via text utilities. Inlined (no icon
// dependency, no network request) and no emoji, per the Vigil rules.

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
