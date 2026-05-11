import type { TextBlock } from "./block-types"

type TextProps = {
  data: TextBlock
}

const HEADING_TAG = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
} as const

function BoldLeadParagraph({ text }: { text: string }) {
  const words = text.split(" ")
  const boldPart = words.slice(0, 3).join(" ")
  const rest = text.slice(boldPart.length)
  return (
    <p className="mt-2 text-lg leading-relaxed text-stone-200/80 xl:text-xl">
      <span className="font-bold text-white">{boldPart}</span>
      {rest}
    </p>
  )
}

export function Text({ data }: TextProps) {
  const {
    heading,
    headingLevel,
    subtitle,
    contentParagraphs,
    variant,
    sectionKey,
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
        id={sectionKey ?? undefined}
        data-section-key={sectionKey ?? undefined}
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
              <Tag className="mb-0 text-2xl font-bold xl:text-3xl 2xl:text-4xl">
                {heading}
              </Tag>
            </div>
          )}
        </div>

        {paragraphs.length > 0 && (
          <div>
            {paragraphs.map((text, i) => (
              <BoldLeadParagraph key={i} text={text} />
            ))}
          </div>
        )}
      </section>
    )
  }

  return (
    <section
      id={sectionKey ?? undefined}
      data-section-key={sectionKey ?? undefined}
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
