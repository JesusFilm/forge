import { graphql } from "@forge/graphql"

export const textSectionFragment = graphql(`
  fragment TextSection on ComponentSectionsText @_unmask {
    id
    sectionKey
    heading
    headingLevel
    subtitle
    contentParagraphs
    textVariant: variant
  }
`)
