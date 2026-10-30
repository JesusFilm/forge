import type {
  FragmentOf,
  LegacyFragmentValue,
} from "@/lib/legacy-fragment-types"
import { infoBlocksFragment } from "@/lib/fragments/info-blocks"
import {
  Clapperboard,
  Footprints,
  Globe2,
  LibraryBig,
  UsersRound,
  Wrench,
  type LucideIcon,
} from "lucide-react"

export { infoBlocksFragment }

type InfoBlocksProps = {
  data: FragmentOf<typeof infoBlocksFragment>
}

type InfoBlocksRuntimeData = FragmentOf<typeof infoBlocksFragment> & {
  backgroundColor?: string | null
}

const iconByName: Record<string, LucideIcon> = {
  clapperboard: Clapperboard,
  globe: Globe2,
  library: LibraryBig,
  steps: Footprints,
  tools: Wrench,
  users: UsersRound,
}

export function InfoBlocks({ data }: InfoBlocksProps) {
  const {
    id,
    infoHeading: heading,
    intro,
    infoDescription: description,
    blocks,
    backgroundColor,
  } = data as InfoBlocksRuntimeData
  const filteredBlocks = (blocks ?? []).filter(
    (b: LegacyFragmentValue): b is NonNullable<typeof b> => b != null,
  )
  const isGlass = backgroundColor === "glass"
  const isDarkGlass = backgroundColor === "darkGlass"
  const isDarkTreatment = isGlass || isDarkGlass
  const sectionClass = isDarkTreatment ? "py-0 text-white" : "py-12"
  const headingClass = isDarkTreatment
    ? "mb-2 text-2xl font-bold text-white"
    : "mb-2 text-2xl font-bold"
  const mutedTextClass = isDarkTreatment ? "text-white/70" : "text-gray-600"
  const gridClass = isDarkGlass
    ? "grid gap-6 md:grid-cols-2 lg:grid-cols-3"
    : "grid gap-8 md:grid-cols-2 lg:grid-cols-3"
  const innerClass = isDarkTreatment ? "w-full" : "container mx-auto px-4"
  const cardClass = isGlass
    ? "group relative overflow-hidden rounded-lg border border-white/10 bg-white/5 p-6 backdrop-blur-sm transition-colors duration-300 hover:bg-white/10"
    : isDarkGlass
      ? "group relative overflow-hidden rounded-lg border border-white/10 bg-stone-950/20 p-6 transition-colors duration-300 hover:border-white/20 hover:bg-stone-900/60"
      : "rounded-lg border bg-white p-6 shadow-sm"

  return (
    <section id={id} className={sectionClass}>
      <div className={innerClass}>
        {heading && <h2 className={headingClass}>{heading}</h2>}
        {intro && <p className={`mb-4 ${mutedTextClass}`}>{intro}</p>}
        {description && <p className="mb-6">{description}</p>}
        {filteredBlocks.length > 0 && (
          <div className={gridClass}>
            {filteredBlocks.map((block: LegacyFragmentValue, index: number) => {
              const iconName =
                typeof block.icon === "string" ? block.icon : undefined
              const Icon = iconName ? iconByName[iconName] : undefined

              return (
                <article
                  key={block.id ?? block.title ?? index}
                  className={cardClass}
                >
                  {Icon ? (
                    <Icon
                      className={
                        isGlass
                          ? "mb-6 h-20 w-20 text-white/20 mix-blend-overlay"
                          : isDarkGlass
                            ? "mb-5 h-8 w-8 text-white/40"
                            : "mb-2 h-6 w-6 text-gray-700"
                      }
                      aria-hidden
                    />
                  ) : block.icon ? (
                    <span
                      className={`mb-2 block text-2xl ${isDarkTreatment ? "text-white/40" : ""}`}
                      aria-hidden
                    >
                      {block.icon}
                    </span>
                  ) : null}
                  {block.title && (
                    <h3
                      className={
                        isDarkTreatment
                          ? "mb-2 text-lg font-semibold text-white"
                          : "mb-2 font-semibold"
                      }
                    >
                      {block.title}
                    </h3>
                  )}
                  {block.description && (
                    <p
                      className={
                        isDarkTreatment
                          ? "text-base sm:text-sm leading-relaxed text-white/70"
                          : "text-gray-600"
                      }
                    >
                      {block.description}
                    </p>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
