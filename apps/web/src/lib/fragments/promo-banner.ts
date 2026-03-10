import { graphql } from "@forge/graphql"

export const promoBannerFragment = graphql(`
  fragment PromoBanner on ComponentSectionsPromoBanner @_unmask {
    id
    promoHeading: heading
    promoDescription: description
    intro
    promoCtaLink: ctaLink
  }
`)
