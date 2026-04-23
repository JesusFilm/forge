import type { CardSection } from "@forge/experience-templates"

import { cn } from "@/lib/cn"
import { fixImageUrl } from "@/lib/mux"

type CardPreviewProps = {
  section: CardSection
}

type MediaShape = { url?: string | null } | null | undefined

function getMediaUrl(media: unknown): string | undefined {
  if (!media || typeof media !== "object") return undefined
  const shape = media as MediaShape
  return fixImageUrl(shape?.url ?? undefined)
}

export function CardPreview({ section }: CardPreviewProps) {
  const variant = section.variant ?? "default"
  const mediaUrl = getMediaUrl(section.media)

  const containerClass =
    variant === "featured"
      ? "p-6 border-l-4 border-blue-600 shadow-md"
      : "p-4 shadow-sm"

  const Wrapper = (section.link ? "a" : "article") as "a" | "article"

  return (
    <Wrapper
      {...(section.link ? { href: section.link } : {})}
      className={cn(
        "block space-y-3 overflow-hidden rounded-lg border border-neutral-200 bg-white",
        containerClass,
      )}
    >
      {mediaUrl ? (
        <div className="aspect-video overflow-hidden rounded bg-neutral-200">
          <img
            src={mediaUrl}
            alt={section.title}
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}
      {section.title ? (
        <h4
          className={cn(
            "font-semibold text-neutral-900",
            variant === "featured" ? "text-lg" : "text-sm",
          )}
        >
          {section.title}
        </h4>
      ) : null}
      {section.description ? (
        <p className="text-sm leading-relaxed text-neutral-700">
          {section.description}
        </p>
      ) : null}
    </Wrapper>
  )
}
