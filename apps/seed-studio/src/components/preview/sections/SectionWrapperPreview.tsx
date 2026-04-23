import type {
  BackgroundColor,
  SectionBlock,
  SectionWrapper,
} from "@forge/experience-templates"

import { cn } from "@/lib/cn"

import { SectionRenderer } from "../SectionRenderer"

type SectionWrapperPreviewProps = {
  section: SectionWrapper
}

const SECTION_BG_CLASSES: Record<BackgroundColor, string> = {
  default: "bg-white",
  light: "bg-neutral-50",
  dark: "bg-stone-900 text-white",
  primary: "bg-blue-900 text-white",
  cosmic: "bg-indigo-950 text-white",
  purple: "bg-purple-900 text-white",
}

export function SectionWrapperPreview({ section }: SectionWrapperPreviewProps) {
  const bgKey: BackgroundColor = section.backgroundColor ?? "default"
  const bgClass = SECTION_BG_CLASSES[bgKey] ?? SECTION_BG_CLASSES.default

  const content = (section.content ?? []).filter(
    (block): block is NonNullable<typeof block> => block != null,
  )

  if (content.length === 0) return null

  const opacity = section.backgroundOpacity
  const hasOverlay = section.staticOverlay === true

  return (
    <section
      id={section.sectionKey}
      data-section-key={section.sectionKey}
      className={cn("relative w-full", bgClass)}
      style={
        opacity != null && opacity >= 0 && opacity <= 1
          ? { opacity }
          : undefined
      }
    >
      {hasOverlay ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-black/10"
        />
      ) : null}
      <div
        className={cn(
          "relative flex flex-col gap-6 p-5",
          hasOverlay ? "z-10" : undefined,
        )}
      >
        {content.map((block, i) => (
          <SectionRenderer
            key={`${section.sectionKey}-${i}`}
            block={block as SectionBlock}
          />
        ))}
      </div>
    </section>
  )
}
