// Round 44px chrome button used by HeroPlayerControls for play, mute,
// fullscreen. Black/30 background, white icon, slight darken on hover.

export function ChromeButton({
  children,
  onClick,
  ariaLabel,
  testId,
}: {
  children: React.ReactNode
  onClick: () => void
  ariaLabel: string
  testId: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      data-testid={testId}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/30 text-white transition hover:bg-black/55"
    >
      {children}
    </button>
  )
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}
