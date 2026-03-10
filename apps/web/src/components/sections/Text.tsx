import { graphql, type FragmentOf } from "@forge/graphql"

export const textSectionFragment = graphql(`
  fragment TextSection on ComponentSectionsText @_unmask {
    id
    sectionKey
    heading
    headingLevel
    subtitle
    content
    textVariant: variant
  }
`)

type TextProps = {
  data: FragmentOf<typeof textSectionFragment>
}

const HEADING_TAG = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
} as const

export function Text({ data }: TextProps) {
  const {
    id,
    heading,
    headingLevel,
    subtitle,
    content,
    textVariant: variant,
  } = data
  const Tag =
    headingLevel && HEADING_TAG[headingLevel as keyof typeof HEADING_TAG]
      ? HEADING_TAG[headingLevel as keyof typeof HEADING_TAG]
      : "h2"

  return (
    <section
      id={id ?? undefined}
      className="space-y-6 text-stone-100"
      data-testid="Text"
    >
      {heading && <Tag className="mb-0 text-4xl font-bold">{heading}</Tag>}
      {subtitle && <p className="text-xl opacity-80">{subtitle}</p>}
      {content && (
        <div
          className={
            variant === "lead"
              ? "text-xl xl:text-2xl"
              : variant === "small"
                ? "text-base"
                : "text-xl xl:text-2xl"
          }
          dangerouslySetInnerHTML={{ __html: content }}
        />
      )}
    </section>
  )
}
