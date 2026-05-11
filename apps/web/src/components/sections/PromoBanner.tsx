import type { PromoBannerBlock } from "./block-types"

type PromoBannerProps = {
  data: PromoBannerBlock
}

export function PromoBanner({ data }: PromoBannerProps) {
  const { sectionKey, heading, description, intro, ctaLink, ctaLabel } = data
  return (
    <section
      id={sectionKey ?? undefined}
      data-section-key={sectionKey ?? undefined}
      className="bg-blue-50 py-12"
    >
      <div className="container mx-auto px-4 text-center">
        {intro && (
          <p className="mb-2 text-sm uppercase tracking-wide text-blue-600">
            {intro}
          </p>
        )}
        <h2 className="mb-4 text-3xl font-bold">{heading}</h2>
        <p className="mb-6 text-gray-700">{description}</p>
        {ctaLink && (
          <a
            href={ctaLink}
            rel="noopener noreferrer"
            className="inline-block rounded bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
          >
            {ctaLabel ?? "Learn more"}
          </a>
        )}
      </div>
    </section>
  )
}
