import type { PromoBannerSection } from "@forge/experience-templates"

type PromoBannerPreviewProps = {
  section: PromoBannerSection
}

export function PromoBannerPreview({ section }: PromoBannerPreviewProps) {
  return (
    <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-5 text-center">
      {section.intro ? (
        <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">
          {section.intro}
        </p>
      ) : null}
      {section.heading ? (
        <h3 className="text-xl font-bold text-neutral-900">
          {section.heading}
        </h3>
      ) : null}
      {section.description ? (
        <p className="text-sm leading-relaxed text-neutral-700">
          {section.description}
        </p>
      ) : null}
      {section.ctaLink ? (
        <a
          href={section.ctaLink}
          rel="noopener noreferrer"
          className="inline-block rounded bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          Learn more
        </a>
      ) : null}
    </div>
  )
}
