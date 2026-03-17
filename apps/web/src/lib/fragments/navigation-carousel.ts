import { graphql } from "@forge/graphql"

export const navigationCarouselFragment = graphql(`
  fragment NavigationCarousel on ComponentSectionsNavigationCarousel @_unmask {
    id
    sectionKey
    items {
      id
      contentId
      title
      category
      imageUrl
      backgroundColor
    }
  }
`)
