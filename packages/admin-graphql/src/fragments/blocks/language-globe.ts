import { adminGraphql } from "../../admin"

export const adminLanguageGlobeFragment = adminGraphql(`
  fragment AdminLanguageGlobe on LanguageGlobeBlock @_unmask {
    t
    sectionKey
    eyebrow
    title
    description
    ctaEnabled
    ctaLabel
    ctaLink
  }
`)
