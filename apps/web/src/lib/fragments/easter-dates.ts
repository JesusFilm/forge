import { graphql } from "@forge/graphql"

export const easterDatesFragment = graphql(`
  fragment EasterDates on ComponentSectionsEasterDates @_unmask {
    id
    sectionKey
    easterDatesTitle
    westernEasterLabel
    orthodoxEasterLabel
    passoverLabel
    locale
  }
`)
