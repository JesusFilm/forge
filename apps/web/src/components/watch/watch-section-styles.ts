import { ListVideo } from "lucide-react"

export const WATCH_SECTION_EYEBROW_CLASS =
  "text-base font-medium tracking-eyebrow text-red-100/70 uppercase sm:text-sm xl:text-base 2xl:text-lg"

export const WATCH_MEDIA_SECTION_VERTICAL_PADDING_CLASS = "py-10 md:py-16"

export const WATCH_PILL_BUTTON_CLASS =
  "cursor-pointer gap-1.5 px-3 py-2 text-xs tracking-[0.06em] sm:gap-2 sm:px-5 sm:py-3.5 sm:text-xs sm:tracking-wider [&_*]:pointer-events-none [&_*]:cursor-pointer [&_svg]:size-3.5 sm:[&_svg]:size-4"

// The single-video page's intro meta-row tag ("2,267 audio translations",
// "57 subtitles"). Shared so the /videos language-collection sidebars render
// the same counts with the same typography instead of a copied class string
// that can drift. Lives here, not in HeroPlayer.tsx, because that module is
// `"use client"` and the /videos sidebar is a Server Component — every export
// of a client module becomes a client reference under RSC.
export const WATCH_LANGUAGE_TAG_CLASS =
  "inline-flex items-center gap-1 px-1 text-xs font-normal text-white/85 md:text-sm"

// The glyph for "the full video library" — the floating header's control and
// the watch-home "See all video collections" CTA both point at the language
// video index, so they share one icon reference rather than each naming a
// lucide import that can drift apart.
export const WatchLibraryIcon = ListVideo

// The immersive blurred-artwork backdrop used by authored Experience collection
// sections (`MediaCollection`) and by the /videos collection sidebars. Shared so
// the two surfaces cannot drift on blur radius, brightness, or base colour.
export const WATCH_IMMERSIVE_BACKGROUND_COLOR = "#1A1815"
export const WATCH_IMMERSIVE_BACKGROUND_BRIGHTNESS_CLASS = "brightness-50"
export const WATCH_IMMERSIVE_BACKGROUND_SATURATION_CLASS = "saturate-75"
export const WATCH_IMMERSIVE_BACKDROP_CLASS =
  "absolute inset-0 z-0 scale-105 bg-cover bg-center bg-no-repeat blur-2xl"
