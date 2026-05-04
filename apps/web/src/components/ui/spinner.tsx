// Shared SVG spinner glyph. Two consumers:
//  - HeroPlayer (h-12 w-12 over the hero's pre-canplay black box)
//  - SearchOverlay's "Load more" button (h-4 w-4 inline with the label)
// `className` is forwarded so callers control sizing/coloring; the inner
// circle/path opacity values are baked in to keep both call sites visually
// identical to the original inline duplicates.
export function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}
