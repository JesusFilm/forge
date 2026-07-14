// Inline SVG icons for the HeroPlayer chrome.
//
// Two visual families:
//   - Chrome controls and the pre-reveal Watch now pill use 24px fill-based glyphs
//     styled by the parent button's text color.
//   - The Tap to Unmute recovery pill uses a larger 22px stroke-based speaker
//     that matches the pill's lock-up.

type GlyphProps = { path: string }

function ChromeGlyph({ path }: GlyphProps) {
  return (
    <svg
      aria-hidden="true"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d={path} />
    </svg>
  )
}

export function PlayIcon() {
  return <ChromeGlyph path="M8 5v14l11-7z" />
}

export function PauseIcon() {
  return <ChromeGlyph path="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
}

export function ChromeVolumeIcon() {
  return (
    <ChromeGlyph path="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
  )
}

export function AudioLanguagesIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={22}
      height={22}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
    >
      <line x1="3" y1="10" x2="3" y2="14" />
      <line x1="7.5" y1="6" x2="7.5" y2="18" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="16.5" y1="6" x2="16.5" y2="18" />
      <line x1="21" y1="10" x2="21" y2="14" />
    </svg>
  )
}

export function ChromeMutedIcon() {
  return (
    <ChromeGlyph path="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
  )
}

export function EnterFullscreenIcon() {
  return (
    <ChromeGlyph path="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
  )
}

export function ExitFullscreenIcon() {
  return (
    <ChromeGlyph path="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
  )
}

export function MutedSpeakerIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={22}
      height={22}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  )
}
