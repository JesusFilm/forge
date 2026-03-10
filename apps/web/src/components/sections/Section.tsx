import type { CSSProperties } from "react"
import type { FragmentOf } from "@forge/graphql"
import { graphql } from "@forge/graphql"
import { CONTENT_WIDTH_CLASSES } from "@/lib/content-width"
import { Container } from "./Container"
import type { containerFragment } from "./Container"

export const sectionFragment = graphql(`
  fragment Section on ComponentSectionsSection @_unmask {
    id
    sectionKey
    backgroundColor
    backgroundOpacity
    blurHash
    sectionContent: content {
      __typename
      ... on ComponentSectionsContainer {
        ...Container
      }
    }
  }
`)

/** Default section background opacity when none is set in CMS (more transparent frosted look). */
const BASE_BACKGROUND_OPACITY = 0.65

const BACKGROUND_RGB: Record<string, string> = {
  default: "28 25 23", // stone-900
  light: "245 245 244", // stone-100
  dark: "12 10 9", // stone-950
  primary: "69 10 29", // rose-950
}

type SectionProps = {
  data: FragmentOf<typeof sectionFragment>
}

type SectionData = FragmentOf<typeof sectionFragment>
type SectionContentItem = NonNullable<
  NonNullable<SectionData["sectionContent"]>[number]
>

export function Section({ data }: SectionProps) {
  const { id, sectionKey, backgroundColor, backgroundOpacity, sectionContent } =
    data
  const validContent =
    sectionContent?.filter((c): c is NonNullable<typeof c> => c != null) ?? []
  if (!validContent.length) return null

  const opacity =
    backgroundOpacity != null ? backgroundOpacity : BASE_BACKGROUND_OPACITY
  const rgb =
    BACKGROUND_RGB[backgroundColor ?? "default"] ?? BACKGROUND_RGB.default

  const backgroundStyle: CSSProperties = {
    backgroundColor: `rgb(${rgb} / ${opacity})`,
  }

  return (
    <section
      id={id ?? undefined}
      data-section-key={sectionKey ?? undefined}
      data-testid="Section"
      className="relative w-full"
    >
      <div
        className="mx-auto w-full backdrop-blur-md md:max-w-[1920px]"
        style={backgroundStyle}
      >
        <div
          className={`flex flex-col items-stretch justify-center py-10 pb-16 ${CONTENT_WIDTH_CLASSES}`}
        >
          {validContent.map((item, index) =>
            item && (item as { __typename?: string }).__typename !== "Error" ? (
              <SectionContentRenderer
                key={`section-${id ?? index}-${index}`}
                item={item as SectionContentItem}
              />
            ) : null,
          )}
        </div>
      </div>
    </section>
  )
}

function SectionContentRenderer({ item }: { item: SectionContentItem }) {
  if (!item || item.__typename === "Error") return null
  if (item.__typename === "ComponentSectionsContainer") {
    return (
      <Container
        data={item as unknown as FragmentOf<typeof containerFragment>}
      />
    )
  }
  return null
}
