import type { InfoBlocksBlock } from "./block-types"

type InfoBlocksProps = {
  data: InfoBlocksBlock
}

export function InfoBlocks({ data }: InfoBlocksProps) {
  const { sectionKey, heading, intro, description, blocks } = data
  const filteredBlocks = (blocks ?? []).filter(
    (b): b is NonNullable<typeof b> => b != null,
  )
  return (
    <section
      id={sectionKey ?? undefined}
      data-section-key={sectionKey ?? undefined}
      className="py-12"
    >
      <div className="container mx-auto px-4">
        {heading && <h2 className="mb-2 text-2xl font-bold">{heading}</h2>}
        {intro && <p className="mb-4 text-gray-600">{intro}</p>}
        {description && <p className="mb-6">{description}</p>}
        {filteredBlocks.length > 0 && (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredBlocks.map((block) => (
              <article
                key={`${block.icon}-${block.title}`}
                className="rounded-lg border bg-white p-6 shadow-sm"
              >
                {block.icon && (
                  <span className="mb-2 block text-2xl" aria-hidden>
                    {block.icon}
                  </span>
                )}
                {block.title && (
                  <h3 className="mb-2 font-semibold">{block.title}</h3>
                )}
                {block.description && (
                  <p className="text-gray-600">{block.description}</p>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
