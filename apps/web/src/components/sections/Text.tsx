import type { FragmentOf } from "@forge/graphql"
import { textSectionFragment } from "@/lib/fragments/text-section"

export { textSectionFragment }

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
    contentParagraphs,
    textVariant: variant,
  } = data
  const Tag =
    headingLevel && HEADING_TAG[headingLevel as keyof typeof HEADING_TAG]
      ? HEADING_TAG[headingLevel as keyof typeof HEADING_TAG]
      : "h2"

  const paragraphs = Array.isArray(contentParagraphs)
    ? (contentParagraphs as string[])
    : []

  return (
    <section
      id={id ?? undefined}
      className="space-y-6 text-stone-100"
      data-testid="Text"
    >
      {heading && <Tag className="mb-0 text-4xl font-bold">{heading}</Tag>}
      {subtitle && <p className="text-xl opacity-50">{subtitle}</p>}
      {paragraphs.length > 0 && (
        <div
          className={`space-y-4 ${variant === "small" ? "text-base" : "text-xl xl:text-2xl"}`}
        >
          {paragraphs.map((text, i) => (
            <p key={i}>{text}</p>
          ))}
        </div>
      )}
    </section>
  )
}
