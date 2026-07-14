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
}: {
  children: React.ReactNode
  onClick: () => void
  ariaLabel: string
  testId: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      data-testid={testId}
      className={`flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-transparent text-white/90 transition-[color,filter,transform] duration-150 hover:scale-110 hover:text-white focus-visible:scale-110 focus-visible:text-brand-red focus-visible:ring-2 focus-visible:ring-brand-red/70 focus-visible:outline-none md:h-12 md:w-12 ${className}`}
    >
      {children}
    </button>
  )
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  return formatDuration(seconds)
}
