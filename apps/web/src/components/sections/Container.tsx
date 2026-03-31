import type { FragmentOf } from "@forge/graphql"
import { containerFragment } from "@/lib/fragments/container"
import type { textSectionFragment } from "@/lib/fragments/text-section"
import type { adventCountdownFragment } from "@/lib/fragments/advent-countdown"
import type { easterDatesFragment } from "@/lib/fragments/easter-dates"
import type { mediaCollectionFragment } from "@/lib/fragments/media-collection"
import type { ctaSectionFragment } from "@/lib/fragments/cta-section"
import type { videoSectionFragment } from "@/lib/fragments/video-section"
import type { relatedQuestionsFragment } from "@/lib/fragments/related-questions"
import { Text } from "./Text"
import { AdventCountdown } from "./AdventCountdown"
import { EasterDates } from "./EasterDates"
import { MediaCollection } from "./MediaCollection"
import { CTASection } from "./CTASection"
import { Video } from "./Video"
import { RelatedQuestions } from "./RelatedQuestions"

export { containerFragment }

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
    case "ComponentSectionsAdventCountdown":
      return (
        <AdventCountdown
          data={item as unknown as FragmentOf<typeof adventCountdownFragment>}
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
    case "ComponentSectionsVideo":
      return (
        <Video
          data={item as unknown as FragmentOf<typeof videoSectionFragment>}
        />
      )
    case "ComponentSectionsRelatedQuestions":
      return (
        <RelatedQuestions
          data={item as unknown as FragmentOf<typeof relatedQuestionsFragment>}
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
