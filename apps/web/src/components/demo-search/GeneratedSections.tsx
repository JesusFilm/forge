import Image from "next/image"
import Link from "next/link"
import { demoResultHref } from "@/lib/demo-href"
import type { ExperienceSectionNode } from "@/lib/experience-generator"
import type { SearchResult } from "@/lib/search"

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
      className="group flex flex-col gap-4 overflow-hidden rounded-2xl border border-stone-800 bg-stone-900/50 transition hover:border-stone-700 md:flex-row"
    >
      <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-stone-800 md:aspect-[4/3] md:w-2/5">
        {result.imageUrl ? (
          <Image
            src={result.imageUrl}
            alt={result.title ?? section.videoSlug}
            fill
            sizes="(max-width: 768px) 100vw, 40vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col justify-center gap-3 p-5">
        <span className="text-[10px] font-semibold tracking-wider text-amber-400 uppercase">
          Spotlight
        </span>
        <h4 className="text-xl font-semibold text-white">{result.title}</h4>
        <p className="text-sm leading-relaxed text-stone-300">{section.why}</p>
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
      <div className="mb-3">
        <span className="text-[10px] font-semibold tracking-wider text-amber-400 uppercase">
          Theme
        </span>
        <h4 className="mt-1 text-lg font-semibold text-white">
          {section.theme}
        </h4>
        <p className="mt-1 text-sm leading-relaxed text-stone-400">
          {section.caption}
        </p>
      </div>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {cards.map((result) => (
          <Link
            key={result.slug}
            href={demoResultHref(result)}
            className="group relative flex w-40 shrink-0 flex-col overflow-hidden rounded-xl border border-stone-800 bg-stone-900/50 transition hover:border-stone-700 sm:w-48"
          >
            <div className="relative aspect-video w-full overflow-hidden bg-stone-800">
              {result.imageUrl ? (
                <Image
                  src={result.imageUrl}
                  alt={result.title ?? result.slug}
                  fill
                  sizes="192px"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : null}
            </div>
            <div className="p-2">
              <p className="line-clamp-2 text-xs font-medium text-stone-200">
                {result.title}
              </p>
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
    <div className="rounded-2xl border border-stone-800 bg-stone-900/50 p-5">
      <span className="text-[10px] font-semibold tracking-wider text-amber-400 uppercase">
        {section.reference}
      </span>
      <blockquote className="mt-2 text-lg leading-relaxed text-stone-100 italic">
        &ldquo;{section.text}&rdquo;
      </blockquote>
      <p className="mt-3 text-sm leading-relaxed text-stone-400">
        {section.reflection}
      </p>
    </div>
  )
}
