type Block = {
  id: string
  title: string
  description: string
  icon: string
}

type InfoBlocksProps = {
  id: string
  heading?: string | null
  intro?: string | null
  description?: string | null
  blocks: Block[]
}

export function InfoBlocks({
  id,
  heading,
  intro,
  description,
  blocks,
}: InfoBlocksProps) {
  return (
    <section id={id} className="py-12">
      <div className="container mx-auto px-4">
        {heading && <h2 className="mb-2 text-2xl font-bold">{heading}</h2>}
        {intro && <p className="mb-4 text-gray-600">{intro}</p>}
        {description && <p className="mb-6">{description}</p>}
        {blocks.length > 0 && (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {blocks.map((block) => (
              <article
                key={block.id}
                className="rounded-lg border bg-white p-6 shadow-sm"
              >
                {block.icon && (
                  <span className="mb-2 block text-2xl" aria-hidden>
                    {block.icon}
                  </span>
                )}
                <h3 className="mb-2 font-semibold">{block.title}</h3>
                <p className="text-gray-600">{block.description}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
