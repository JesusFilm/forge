import { adminGraphql } from "@forge/admin-graphql"

// Web-only extension for locale-aware media collection item titles. Keep this
// out of the canonical AdminMediaCollection fragment so Mobile and TV do not
// select or execute the resolvedTitle field.
export const watchMediaCollectionTitlesFragment = adminGraphql(`
  fragment WatchMediaCollectionTitles on ExperienceLocale @_unmask {
    blocks {
      ... on MediaCollectionBlock {
        items {
          resolvedTitle(locale: $locale)
        }
      }
      ... on ContainerBlock {
        content {
          ... on MediaCollectionBlock {
            items {
              resolvedTitle(locale: $locale)
            }
          }
        }
      }
      ... on SectionBlock {
        sectionContent: content {
          ... on MediaCollectionBlock {
            items {
              resolvedTitle(locale: $locale)
            }
          }
          ... on ContainerBlock {
            content {
              ... on MediaCollectionBlock {
                items {
                  resolvedTitle(locale: $locale)
                }
              }
            }
          }
        }
      }
    }
  }
`)
