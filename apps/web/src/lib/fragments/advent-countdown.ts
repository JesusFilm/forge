import { graphql } from "@forge/graphql"

export const adventCountdownFragment = graphql(`
  fragment AdventCountdown on ComponentSectionsAdventCountdown @_unmask {
    id
    sectionKey
    adventTitle: title
    scripture
    scriptureReference
    locale
  }
`)
