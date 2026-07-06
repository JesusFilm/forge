import type { FragmentOf } from "@/lib/legacy-fragment-types"
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

  if (variant === "lead") {
    return (
      <section
        id={id ?? undefined}
        className="text-stone-100"
        data-testid="Text"
      >
        <div className="pt-2 2xl:pt-4">
          {subtitle && (
            <p className="text-sm font-semibold tracking-wider text-red-100/70 uppercase xl:mb-1 xl:text-base 2xl:text-lg">
              {subtitle}
            </p>
          )}
          {heading && (
            <div className="mb-3 flex items-center justify-between">
              <Tag className="mb-0 text-xl font-bold xl:text-2xl 2xl:text-3xl">
                {heading}
              </Tag>
            </div>
          )}
        </div>

        {paragraphs.length > 0 && (
          <div>
            {paragraphs.map((text, i) => (
              <p
                key={i}
                className="mt-2 text-lg leading-relaxed text-stone-200/80 xl:text-xl"
              >
                {text}
              </p>
            ))}
          </div>
        )}
      </section>
    )
  }

  return (
    <section
      id={id ?? undefined}
      className="space-y-6 text-stone-100"
      data-testid="Text"
    >
      {heading && (
        <Tag
          className={
            variant === "small"
              ? "mb-0 text-xl font-bold xl:text-2xl"
              : "mb-0 text-4xl font-bold"
          }
        >
          {heading}
        </Tag>
      )}
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
