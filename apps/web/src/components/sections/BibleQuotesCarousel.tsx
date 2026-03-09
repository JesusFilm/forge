import { graphql, type FragmentOf } from "@forge/graphql"

export const bibleQuotesCarouselFragment = graphql(`
  fragment BibleQuotesCarousel on ComponentSectionsBibleQuotesCarousel
  @_unmask {
    id
    heading
  }
`)
type BibleQuotesCarouselProps = {
  data: FragmentOf<typeof bibleQuotesCarouselFragment>
}

export function BibleQuotesCarousel({ data }: BibleQuotesCarouselProps) {
  const { id, heading } = data
  return (
    <section id={id} className="bg-gray-100 py-12">
      <div className="container mx-auto px-4 text-center">
        <h2 className="mb-4 text-2xl font-bold">{heading}</h2>
      </div>
    </section>
  )
}
