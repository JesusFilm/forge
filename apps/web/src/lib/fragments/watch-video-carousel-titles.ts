import { adminGraphql } from "@forge/admin-graphql"

// Web-only localized card copy and poster metadata for Admin-shaped blocks.
export const watchVideoCarouselTitlesFragment = adminGraphql(`
  fragment WatchVideoCarouselTitles on ExperienceLocale @_unmask {
    blocks {
      ... on VideoCarouselBlock {
        items {
          videoImage { previewUrl blurDataUrl dominantColor }
          resolvedTitle(locale: $locale)
        }
      }
      ... on ContainerBlock {
        content {
          ... on VideoCarouselBlock {
            items {
              videoImage { previewUrl blurDataUrl dominantColor }
              resolvedTitle(locale: $locale)
            }
          }
        }
      }
      ... on SectionBlock {
        sectionContent: content {
          ... on VideoCarouselBlock {
            items {
              videoImage { previewUrl blurDataUrl dominantColor }
              resolvedTitle(locale: $locale)
            }
          }
          ... on ContainerBlock {
            content {
              ... on VideoCarouselBlock {
                items {
                  videoImage { previewUrl blurDataUrl dominantColor }
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
