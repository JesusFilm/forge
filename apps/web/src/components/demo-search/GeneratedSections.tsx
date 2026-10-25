import Image from "next/image"
import Link from "next/link"
import {
  VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
  VideoThumbnailInteractionFrame,
} from "@/components/ui/video-thumbnail-interaction-frame"
import { demoResultHref } from "@/lib/demo-href"
import type { ExperienceSectionNode } from "@/lib/experience-generator"
import type { SearchResult } from "@/lib/search"
import { cn } from "@/lib/utils"

type ResultsBySlug = Map<string, SearchResult>

export function GeneratedSection({
  section,
  resultsBySlug,
}: {
  section: ExperienceSectionNode
  resultsBySlug: ResultsBySlug
}) {
  if (section.type === "spotlight") {
    return <Spotlight section={section} resultsBySlug={resultsBySlug} />
  }
  if (section.type === "theme-carousel") {
    return <ThemeCarousel section={section} resultsBySlug={resultsBySlug} />
  }
  return <BibleVerse section={section} />
}

function Spotlight({
  section,
  resultsBySlug,
}: {
  section: Extract<ExperienceSectionNode, { type: "spotlight" }>
  resultsBySlug: ResultsBySlug
}) {
  const result = resultsBySlug.get(section.videoSlug)
  if (!result) return null
  return (
    <Link
      href={demoResultHref(result)}
      className={cn(
        "group relative block overflow-hidden rounded-2xl",
        VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
      )}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-stone-800">
        {result.imageUrl ? (
          <Image
            src={result.imageUrl}
            alt={result.title ?? section.videoSlug}
            fill
            sizes="(max-width: 768px) 100vw, 720px"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            priority
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/10" />
      </div>
      <VideoThumbnailInteractionFrame data-testid="generated-spotlight-thumbnail-frame" />
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-6 md:p-8">
        <span className="w-fit rounded-full bg-amber-500/90 px-3 py-0.5 text-[10px] font-semibold tracking-[0.2em] text-stone-950 uppercase">
          Spotlight
        </span>
        <h4 className="text-2xl font-semibold text-white md:text-3xl">
          {result.title}
        </h4>
        <p className="max-w-2xl text-sm leading-relaxed text-stone-200 md:text-base">
          {section.why}
        </p>
      </div>
    </Link>
  )
}

function ThemeCarousel({
  section,
  resultsBySlug,
}: {
  section: Extract<ExperienceSectionNode, { type: "theme-carousel" }>
  resultsBySlug: ResultsBySlug
}) {
  const cards = section.videoSlugs
    .map((slug) => resultsBySlug.get(slug))
    .filter((r): r is SearchResult => r != null)
  if (cards.length === 0) return null
  return (
    <div>
      <div className="mb-4 flex items-end justify-between">
        <div>
          <span className="text-[10px] font-semibold tracking-[0.2em] text-amber-400 uppercase">
            Theme
          </span>
          <h4 className="mt-1 text-2xl font-semibold text-white">
            {section.theme}
          </h4>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-stone-400">
            {section.caption}
          </p>
        </div>
        <span className="hidden text-xs font-medium text-stone-500 sm:inline">
          {cards.length} video{cards.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="-mx-6 flex gap-4 overflow-x-auto px-6 pb-2 md:-mx-10 md:px-10">
        {cards.map((result) => (
          <Link
            key={result.slug}
            href={demoResultHref(result)}
            className={cn(
              "group relative flex w-52 shrink-0 flex-col overflow-hidden rounded-xl bg-stone-900 transition hover:bg-stone-800 sm:w-60",
              VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
            )}
          >
            <div className="relative aspect-video w-full overflow-hidden bg-stone-800">
              {result.imageUrl ? (
                <Image
                  src={result.imageUrl}
                  alt={result.title ?? result.slug}
                  fill
                  sizes="240px"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : null}
              <VideoThumbnailInteractionFrame data-testid="generated-theme-thumbnail-frame" />
            </div>
            <div className="p-3">
              <p className="line-clamp-2 text-sm font-medium text-stone-100">
                {result.title}
              </p>
              {result.snippet && (
                <p className="mt-1 line-clamp-2 text-xs text-stone-400">
                  {result.snippet}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

function BibleVerse({
  section,
}: {
  section: Extract<ExperienceSectionNode, { type: "bible-verse" }>
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-stone-800 bg-stone-900 p-8 md:p-10">
      <div className="pointer-events-none absolute top-4 left-6 font-sans text-8xl leading-none text-amber-500/20 select-none">
        &ldquo;
      </div>
      <div className="relative">
        <span className="text-[10px] font-semibold tracking-[0.25em] text-amber-400 uppercase">
          {section.reference}
        </span>
        <blockquote className="mt-3 font-sans text-2xl leading-relaxed text-stone-50 md:text-3xl">
          {section.text}
        </blockquote>
        <p className="mt-5 border-t border-stone-800 pt-4 text-sm leading-relaxed text-stone-300">
          {section.reflection}
        </p>
      </div>
    </div>
  )
}
