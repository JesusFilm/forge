import type { ReactNode } from "react"
import type { FragmentOf } from "@/lib/legacy-fragment-types"
import Markdown, { defaultUrlTransform, type Components } from "react-markdown"
import { textSectionFragment } from "@/lib/fragments/text-section"
import { normalizeWatchRootHref } from "@/lib/watch-paths"

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

const PROMOTIONAL_SUBHEADING_CLASS =
  "mt-10 text-xl leading-snug font-semibold tracking-[-0.01em] text-white first:mt-0 sm:text-2xl"

const PromotionalSubheading = ({ children }: { children?: ReactNode }) => (
  <h3 className={PROMOTIONAL_SUBHEADING_CLASS}>{children}</h3>
)

const PromotionalPageSubheading = ({ children }: { children?: ReactNode }) => (
  <h2 className={PROMOTIONAL_SUBHEADING_CLASS}>{children}</h2>
)

const PROMOTIONAL_MARKDOWN_COMPONENTS = {
  h1: PromotionalSubheading,
  h2: PromotionalSubheading,
  h3: PromotionalSubheading,
  h4: ({ children }) => (
    <h4 className="mt-8 text-lg font-semibold text-white">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="mt-7 text-base font-semibold text-white">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="mt-7 text-sm font-semibold tracking-wide text-white uppercase">
      {children}
    </h6>
  ),
  p: ({ children }) => (
    <p className="mt-5 text-base leading-8 text-white/76 first:mt-0 sm:text-lg sm:leading-9">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mt-6 grid list-none gap-3 text-base leading-7 text-white/78 sm:text-lg [&>li]:relative [&>li]:pl-5 [&>li]:before:absolute [&>li]:before:top-[0.78em] [&>li]:before:left-0 [&>li]:before:h-px [&>li]:before:w-2.5 [&>li]:before:bg-red-100/60">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-6 list-decimal space-y-3 pl-6 text-base leading-7 text-white/78 marker:font-semibold marker:text-red-100/80 sm:text-lg">
      {children}
    </ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mt-8 border-l border-red-100/50 pl-5 text-lg italic text-white/82 sm:pl-7 sm:text-xl">
      {children}
    </blockquote>
  ),
  a: ({ children, href }) => (
    <a
      href={normalizeWatchRootHref(href)}
      rel="noopener noreferrer"
      className="font-semibold text-red-100 underline decoration-red-100/35 underline-offset-4 transition-colors hover:text-white hover:decoration-white/70 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-white">{children}</strong>
  ),
  em: ({ children }) => <em className="text-white/90">{children}</em>,
  hr: () => <hr className="my-10 border-white/15" />,
} satisfies Components

const PROMOTIONAL_PAGE_MARKDOWN_COMPONENTS = {
  ...PROMOTIONAL_MARKDOWN_COMPONENTS,
  h1: PromotionalPageSubheading,
  h2: PromotionalPageSubheading,
  h3: PromotionalPageSubheading,
} satisfies Components

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
  const hasHeading = typeof heading === "string" && heading.trim().length > 0

  if (variant === "promotional") {
    const markdown = paragraphs
      .filter((paragraph) => paragraph.trim().length > 0)
      .join("\n\n")

    return (
      <section
        id={id ?? undefined}
        className="relative py-8 text-stone-100 sm:py-12 lg:py-16"
        data-testid="Text"
        data-variant="promotional"
      >
        <div className="grid gap-x-10 gap-y-10 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] xl:gap-x-24 xl:gap-y-0">
          <header className="relative max-w-2xl xl:contents">
            <div
              className="xl:col-start-1 xl:row-start-1"
              data-testid="promotional-eyebrow-row"
            >
              {subtitle && (
                <p className="mb-4 text-xs font-semibold tracking-[0.28em] text-red-100/70 uppercase sm:text-sm">
                  {subtitle}
                </p>
              )}
            </div>
            {hasHeading && (
              <Tag className="text-3xl leading-[1.08] font-semibold tracking-[-0.025em] text-white sm:text-4xl lg:text-4xl xl:col-start-1 xl:row-start-2 xl:pr-4 xl:text-5xl">
                {heading}
              </Tag>
            )}
          </header>

          {markdown && (
            <div
              className="max-w-3xl xl:col-start-2 xl:row-start-2 xl:self-start"
              data-testid="promotional-markdown"
            >
              <Markdown
                components={
                  headingLevel === "h1"
                    ? PROMOTIONAL_PAGE_MARKDOWN_COMPONENTS
                    : PROMOTIONAL_MARKDOWN_COMPONENTS
                }
                urlTransform={defaultUrlTransform}
              >
                {markdown}
              </Markdown>
            </div>
          )}
        </div>
      </section>
    )
  }

  if (variant === "lead") {
    return (
      <section
        id={id ?? undefined}
        className="text-stone-100"
        data-testid="Text"
      >
        <div className="pt-2 2xl:pt-4">
          {subtitle && (
            <p className="text-sm font-semibold tracking-eyebrow text-red-100/70 uppercase xl:mb-1 xl:text-base 2xl:text-lg">
              {subtitle}
            </p>
          )}
          {hasHeading && (
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
      {hasHeading && (
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
