import { graphql, type FragmentOf } from "@forge/graphql"

export const ctaSectionFragment = graphql(`
  fragment CTASection on ComponentSectionsCta @_unmask {
    id
    ctaHeading: heading
    body
    buttonLabel
    buttonLink
  }
`)

type CTASectionProps = {
  data: FragmentOf<typeof ctaSectionFragment>
}

export function CTASection({ data }: CTASectionProps) {
  const { id, ctaHeading: heading, body, buttonLabel, buttonLink } = data
  return (
    <section id={id} className="bg-gray-100 py-12">
      <div className="container mx-auto px-4 text-center">
        <h2 className="mb-4 text-2xl font-bold">{heading}</h2>
        <p className="mb-6 text-gray-700">{body}</p>
        {buttonLink && (
          <a
            href={buttonLink}
            rel="noopener noreferrer"
            className="inline-block rounded bg-gray-800 px-6 py-3 font-medium text-white hover:bg-gray-900"
          >
            {buttonLabel}
          </a>
        )}
      </div>
    </section>
  )
}
