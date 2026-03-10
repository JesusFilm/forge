import { graphql } from "@forge/graphql"

export const infoBlocksFragment = graphql(`
  fragment InfoBlocks on ComponentSectionsInfoBlocks @_unmask {
    id
    infoHeading: heading
    intro
    infoDescription: description
    blocks {
      id
      title
      description
      icon
    }
  }
`)
