import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import type { SearchResult } from "@/lib/search"

type VideoCardProps = {
  result: SearchResult
  index?: number
}

export function VideoCard({ result, index = 0 }: VideoCardProps) {
  return (
    <Link
      href={`/${result.slug}/en` as Route}
      className="group animate-card-enter flex flex-col overflow-hidden rounded-2xl bg-stone-800 transition hover:brightness-110"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-stone-700">
        {result.imageUrl ? (
          <Image
            src={result.imageUrl}
            alt={result.title ?? "Video thumbnail"}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
            className="object-cover transition group-hover:scale-105"
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
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="line-clamp-1 text-sm font-semibold text-stone-100">
          {result.title}
        </h3>
        {result.snippet && (
          <p className="line-clamp-2 text-xs leading-relaxed text-stone-400">
            {result.snippet}
          </p>
        )}
      </div>
    </Link>
  )
}
