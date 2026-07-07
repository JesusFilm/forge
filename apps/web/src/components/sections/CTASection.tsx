import type { FragmentOf } from "@/lib/legacy-fragment-types"
import { ctaSectionFragment } from "@/lib/fragments/cta-section"

export { ctaSectionFragment }

type CTASectionProps = {
  data: FragmentOf<typeof ctaSectionFragment>
}

type CTASectionRuntimeData = FragmentOf<typeof ctaSectionFragment> & {
  backgroundColor?: string | null
  ctaVariant?: "primary" | "secondary" | null
}

export function CTASection({ data }: CTASectionProps) {
  const {
    id,
    ctaHeading: heading,
    body,
    buttonLabel,
    buttonLink,
    backgroundColor,
    ctaVariant,
  } = data as CTASectionRuntimeData
  const isTransparent = backgroundColor === "transparent"
  const isSecondary = ctaVariant === "secondary"
  const sectionClass = isTransparent
    ? "py-12 text-white"
    : "bg-gray-100 py-12 text-gray-900"
  const bodyClass = isTransparent
    ? "mx-auto mb-8 max-w-2xl text-lg text-white/80 lg:text-xl"
    : "mb-6 text-gray-700"
  const buttonClass =
    isTransparent || isSecondary
      ? "inline-flex h-12 items-center justify-center rounded-md bg-white px-10 py-3 text-base font-medium text-black transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      : "inline-block rounded bg-gray-800 px-6 py-3 font-medium text-white hover:bg-gray-900"
  const innerClass = isTransparent
    ? "w-full text-center"
    : "container mx-auto px-4 text-center"

  return (
    <section id={id} className={sectionClass}>
      <div className={innerClass}>
        <h2 className="mb-4 text-3xl font-semibold">{heading}</h2>
        <p className={bodyClass}>{body}</p>
        {buttonLink && (
          <a
            href={buttonLink}
            rel="noopener noreferrer"
            className={buttonClass}
          >
            {buttonLabel}
          </a>
        )}
      </div>
    </section>
  )
}
