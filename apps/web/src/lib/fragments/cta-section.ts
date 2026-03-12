import { graphql } from "@forge/graphql"

export const ctaSectionFragment = graphql(`
  fragment CTASection on ComponentSectionsCta @_unmask {
    id
    ctaHeading: heading
    body
    buttonLabel
    buttonLink
    variant
    actionType
    badge
    modalIframeSrc
  }
`)
