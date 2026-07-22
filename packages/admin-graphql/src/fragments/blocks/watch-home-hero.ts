import { adminGraphql } from "../../admin"

export const adminWatchHomeHeroFragment = adminGraphql(`
  fragment AdminWatchHomeHero on WatchHomeHeroBlock @_unmask {
    t
    sectionKey
    program {
      intro {
        id
        playbackId
        durationSeconds
        posterUrl
        label
        title
        description
        showLogo
        primaryAction {
          label
          href
          icon
        }
        secondaryAction {
          label
          href
          icon
        }
      }
      buckets {
        __typename
        ... on WatchHomeVideoBucket {
          kind
          id
          label
          items {
            id
            videoId
            coreId
          }
        }
        ... on WatchHomePromoBucket {
          kind
          id
          label
          items {
            id
            playbackId
            durationSeconds
            posterUrl
            label
            title
            description
            showLogo
            primaryAction {
              label
              href
              icon
            }
            secondaryAction {
              label
              href
              icon
            }
          }
        }
      }
      rotation
    }
  }
`)
