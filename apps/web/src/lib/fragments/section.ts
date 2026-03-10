import { graphql } from "@forge/graphql"

export const sectionFragment = graphql(`
  fragment Section on ComponentSectionsSection @_unmask {
    id
    sectionKey
    backgroundColor
    backgroundOpacity
    blurHash
    sectionContent: content {
      __typename
      ... on ComponentSectionsContainer {
        ...Container
      }
    }
  }
`)
