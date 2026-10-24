import type { Route } from "next"
import { Languages } from "lucide-react"

import { LanguageGlobeSection } from "./LanguageGlobeSection"

export type LanguageGlobeExperienceData = {
  readonly sectionKey?: string | null
  readonly eyebrow?: string | null
  readonly title?: string | null
  readonly description?: string | null
  readonly ctaEnabled?: boolean | null
  readonly ctaLabel?: string | null
  readonly ctaLink?: string | null
}

type LanguageGlobeExperienceProps = {
  data: LanguageGlobeExperienceData
}

function headingIdForSection(sectionKey: string | null | undefined) {
  const normalized = sectionKey
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return `${normalized || "language-globe"}-heading`
}

export function LanguageGlobeExperience({
  data,
}: LanguageGlobeExperienceProps) {
  const title = data.title?.trim()
  if (!title) return null

  const ctaLabel = data.ctaLabel?.trim()
  const ctaLink = data.ctaLink?.trim()
  const showCta = data.ctaEnabled !== false && ctaLabel && ctaLink

  return (
    <LanguageGlobeSection
      actions={
        showCta
          ? [
              {
                href: ctaLink as Route,
                icon: <Languages aria-hidden="true" className="h-5 w-5" />,
                label: ctaLabel,
              },
            ]
          : []
      }
      actionsLabel={title}
      deferGlobe
      description={data.description?.trim() || undefined}
      eyebrow={data.eyebrow?.trim() || undefined}
      headingId={headingIdForSection(data.sectionKey)}
      sectionKey={data.sectionKey?.trim() || undefined}
      title={title}
    />
  )
}
