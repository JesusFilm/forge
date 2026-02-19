import { graphql, type FragmentOf } from "@forge/graphql"

export const promoBannerFragment = graphql(`
  fragment PromoBanner on ComponentSectionsPromoBanner @_unmask {
    id
    promoHeading: heading
    promoDescription: description
    intro
    promoCtaLink: ctaLink
  }
`)

type PromoBannerProps = {
  data: FragmentOf<typeof promoBannerFragment>
}

export function PromoBanner({ data }: PromoBannerProps) {
  const {
    id,
    promoHeading: heading,
    promoDescription: description,
    intro,
    promoCtaLink: ctaLink,
  } = data
  return (
    <section id={id} className="bg-blue-50 py-12">
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
            Learn more
          </a>
        )}
      </div>
    </section>
  )
}
