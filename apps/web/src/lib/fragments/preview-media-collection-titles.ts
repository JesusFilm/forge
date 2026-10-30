import { adminGraphql } from "@forge/admin-graphql"

// Preview-side twin of `watchMediaCollectionTitlesFragment`. Same four nesting
// paths, different parent type and different Admin field.
//
// The published overlay passes `resolvedTitle(locale: $locale)`, but a preview
// operation has no locale to bind — `experiencePreview(token:)` returns the
// locale as a field of its own result, and GraphQL cannot feed one field's
// value into a sibling field's argument. Admin therefore exposes
// `previewResolvedTitle`, which takes no argument and resolves against the
// locale of the Experience being previewed.
//
// The `resolvedTitle:` alias is load-bearing, not cosmetic: `enrichMediaItem`
// in `lib/enrichment.ts` reads `resolvedTitle`, so the alias is what lets the
// preview and published paths share one renderer and one enriched item shape.
//
// Kept out of the canonical AdminMediaCollection fragment so Mobile and TV do
// not select or execute either title resolver.
export const previewMediaCollectionTitlesFragment = adminGraphql(`
  fragment PreviewMediaCollectionTitles on ExperiencePreview @_unmask {
    blocks {
      ... on MediaCollectionBlock {
        items {
          resolvedTitle: previewResolvedTitle
        }
      }
      ... on ContainerBlock {
        content {
          ... on MediaCollectionBlock {
            items {
              resolvedTitle: previewResolvedTitle
            }
          }
        }
      }
      ... on SectionBlock {
        sectionContent: content {
          ... on MediaCollectionBlock {
            items {
              resolvedTitle: previewResolvedTitle
            }
          }
          ... on ContainerBlock {
            content {
              ... on MediaCollectionBlock {
                items {
                  resolvedTitle: previewResolvedTitle
                }
              }
            }
          }
        }
      }
    }
  }
`)
