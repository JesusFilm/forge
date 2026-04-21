import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import type { SearchResult } from "@/lib/search"

type VideoCardProps = {
  result: SearchResult
  index?: number
  hrefBuilder?: (result: SearchResult) => Route
}

const defaultHrefBuilder = (result: SearchResult): Route =>
  `/${result.slug}/en` as Route

// Full tailwind class strings so JIT can extract them at build time.
// Each palette is a dark, saturated gradient that reads as intentional
// branded artwork when the CMS hasn't joined the experience's og_image.
const EXPERIENCE_PLACEHOLDER_GRADIENTS = [
  "from-violet-700 via-purple-900 to-indigo-950",
  "from-orange-600 via-amber-800 to-stone-950",
  "from-emerald-600 via-teal-800 to-stone-950",
  "from-rose-600 via-pink-800 to-purple-950",
  "from-sky-600 via-blue-800 to-indigo-950",
  "from-red-700 via-rose-900 to-stone-950",
  "from-lime-600 via-green-800 to-emerald-950",
  "from-fuchsia-600 via-purple-800 to-indigo-950",
] as const

// djb2 — used only to pick a palette slot, not for anything security-
// sensitive. Spreads "easter" vs "christmas" into different slots.
function gradientForSlug(slug: string): string {
  let hash = 5381
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash * 33) ^ slug.charCodeAt(i)) | 0
  }
  const index = Math.abs(hash) % EXPERIENCE_PLACEHOLDER_GRADIENTS.length
  return EXPERIENCE_PLACEHOLDER_GRADIENTS[index]
}

export function VideoCard({
  result,
  index = 0,
  hrefBuilder = defaultHrefBuilder,
}: VideoCardProps) {
  return (
    <Link
      href={hrefBuilder(result)}
      className="group animate-card-enter relative flex flex-col overflow-hidden rounded-2xl transition hover:scale-[1.02] hover:shadow-2xl hover:shadow-black/40"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Full-bleed thumbnail */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-stone-800">
        {result.imageUrl ? (
          <Image
            src={result.imageUrl}
            alt={result.title ?? "Video thumbnail"}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
            className="object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : result.type === "experience" ? (
          <div
            aria-hidden
            className={`relative h-full w-full overflow-hidden bg-gradient-to-br ${gradientForSlug(result.slug)}`}
          >
            {/* Decorative soft radial glow + diagonal stripes so the
                placeholder reads as intentional branded artwork rather
                than a missing asset. */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_55%)]" />
            <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.05)_0_14px,transparent_14px_32px)]" />
            <div className="absolute inset-0 flex items-center justify-center px-4">
              <span className="line-clamp-3 text-center text-2xl leading-tight font-bold tracking-tight text-white/90 select-none md:text-3xl">
                {result.title}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-stone-500">
            <svg
              className="h-12 w-12"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}

        {/* Gradient overlay for text legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-transparent" />

        {result.type === "experience" && (
          <span className="absolute top-3 left-3 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-stone-950 uppercase shadow">
            Experience
          </span>
        )}

        {/* Text content positioned over the gradient */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-4">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white drop-shadow-md">
            {result.title}
          </h3>
          {result.snippet && (
            <p className="line-clamp-2 text-xs leading-relaxed text-stone-300 drop-shadow-sm">
              {result.snippet}
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}
