import type { FragmentOf } from "@forge/graphql"
import { graphql } from "@forge/graphql"
import { Text } from "./Text"
import { EasterDates } from "./EasterDates"
import { MediaCollection } from "./MediaCollection"
import { CTASection } from "./CTASection"
import type { textSectionFragment } from "./Text"
import type { easterDatesFragment } from "./easterDatesFragment"
import type { mediaCollectionFragment } from "./MediaCollection"
import type { ctaSectionFragment } from "./CTASection"

export const containerFragment = graphql(`
  fragment Container on ComponentSectionsContainer @_unmask {
    id
    sectionKey
    slots {
      id
      gridSpan
      content {
        __typename
        ... on ComponentSectionsText {
          id
          sectionKey
          heading
          headingLevel
          subtitle
          content
          textVariant: variant
        }
        ... on ComponentSectionsEasterDates {
          id
          sectionKey
          easterDatesTitle
          westernEasterLabel
          orthodoxEasterLabel
          passoverLabel
          locale
        }
        ... on ComponentSectionsMediaCollection {
          id
          title
          subtitle
          mediaDescription: description
          categoryLabel
          mediaCtaLink: ctaLink
          showItemNumbers
          mediaCollectionVariant: variant
          items {
            id
            titleOverride
            subtitleOverride
            imageOverride {
              url
            }
            video {
              documentId
              title
              slug
              image {
                url
              }
            }
          }
        }
        ... on ComponentSectionsCta {
          id
          ctaHeading: heading
          body
          buttonLabel
          buttonLink
        }
      }
    }
  }
`)

type ContainerProps = {
  data: FragmentOf<typeof containerFragment>
}

type ContainerData = FragmentOf<typeof containerFragment>
type Slot = NonNullable<NonNullable<ContainerData["slots"]>[number]>
type SlotContentItem = NonNullable<NonNullable<Slot["content"]>[number]>

function SlotContentRenderer({ item }: { item: SlotContentItem }) {
  if (!item || item.__typename === "Error") return null
  switch (item.__typename) {
    case "ComponentSectionsText":
      return (
        <Text
          data={item as unknown as FragmentOf<typeof textSectionFragment>}
        />
      )
    case "ComponentSectionsEasterDates":
      return (
        <EasterDates
          data={item as unknown as FragmentOf<typeof easterDatesFragment>}
        />
      )
    case "ComponentSectionsMediaCollection":
      return (
        <MediaCollection
          data={item as unknown as FragmentOf<typeof mediaCollectionFragment>}
        />
      )
    case "ComponentSectionsCta":
      return (
        <CTASection
          data={item as unknown as FragmentOf<typeof ctaSectionFragment>}
        />
      )
    default:
      return null
  }
}

export function Container({ data }: ContainerProps) {
  const { id, slots } = data
  const validSlots =
    slots?.filter((s): s is NonNullable<typeof s> => s != null) ?? []
  if (!validSlots.length) return null

  return (
    <section
      id={id ?? undefined}
      className="grid w-full grid-cols-1 gap-10 py-8 text-stone-100 md:grid-cols-2 md:gap-6"
      data-testid="Container"
    >
      {validSlots.map((slot) => (
        <div key={slot.id} className="min-w-0 space-y-10 md:space-y-6">
          {slot.content?.map((item, index) => {
            if (
              !item ||
              (item as { __typename?: string }).__typename === "Error"
            ) {
              return null
            }
            return (
              <SlotContentRenderer
                key={`${slot.id}-${index}`}
                item={item as SlotContentItem}
              />
            )
          })}
        </div>
      ))}
    </section>
  )
}
