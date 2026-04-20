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
