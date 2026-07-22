import { adminGraphql } from "../../admin"

export const adminLanguageGlobeFragment = adminGraphql(`
  fragment AdminLanguageGlobe on LanguageGlobeBlock @_unmask {
    __typename
    t
    sectionKey
    heading
    description
    backgroundColor
    languageLimit
  }
`)
