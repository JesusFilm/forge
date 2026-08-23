// Round 48px chrome button used by HeroPlayerControls for play, mute,
// language, fullscreen. Transparent background, white icon, full-size tap
// target. Hover/focus feedback lives here so every player icon behaves
// consistently without reintroducing the removed dark button fill.

import { formatDuration } from "@/lib/format-duration"

export function ChromeButton({
  children,
  onClick,
  ariaLabel,
  testId,
  className = "",
  disabled = false,
  tooltip,
}: {
  children: React.ReactNode
  onClick: () => void
  ariaLabel: string
  testId: string
  className?: string
  disabled?: boolean
  tooltip?: string
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) onClick()
      }}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-testid={testId}
      className={`group relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-transparent text-white/90 transition-[color,filter,transform] duration-150 hover:scale-110 hover:text-white focus-visible:scale-110 focus-visible:text-brand-red focus-visible:ring-2 focus-visible:ring-brand-red/70 focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:text-white/40 aria-disabled:hover:scale-100 aria-disabled:hover:text-white/50 aria-disabled:focus-visible:scale-100 md:h-12 md:w-12 ${className}`}
    >
      {children}
      {tooltip ? (
        <span
          aria-hidden="true"
          role="tooltip"
          className="pointer-events-none invisible absolute right-0 bottom-full z-30 mb-2 max-w-56 translate-y-1 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium whitespace-normal text-neutral-900 opacity-0 shadow-lg transition-[opacity,transform,visibility] duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:visible group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
        >
          {tooltip}
        </span>
      ) : null}
    </button>
  )
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  return formatDuration(seconds)
}
