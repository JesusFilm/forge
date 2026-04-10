import type { TextSection } from "@/lib/ai/experience-schema"

type TextSectionPreviewProps = {
  section: TextSection
}

export function TextSectionPreview({ section }: TextSectionPreviewProps) {
  return (
    <div className="space-y-3">
      {section.heading ? (
        <h4 className="text-sm font-semibold text-neutral-900">
          {section.heading}
        </h4>
      ) : null}
      {section.subtitle ? (
        <p className="text-xs font-medium text-neutral-500">
          {section.subtitle}
        </p>
      ) : null}
      <div className="space-y-2">
        {section.contentParagraphs.map((paragraph, i) => (
          <p key={i} className="text-sm leading-relaxed text-neutral-700">
            {paragraph}
          </p>
        ))}
      </div>
    </div>
  )
}
