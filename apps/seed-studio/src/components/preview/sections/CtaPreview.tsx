import type { CTASection } from "@forge/experience-templates"

import { cn } from "@/lib/cn"

type CtaPreviewProps = {
  section: CTASection
}

export function CtaPreview({ section }: CtaPreviewProps) {
  const variant = section.variant ?? "primary"

  const buttonClass =
    variant === "primary"
      ? "bg-blue-600 text-white hover:bg-blue-700"
      : "border border-neutral-900 text-neutral-900 hover:bg-neutral-900 hover:text-white"

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-5 text-center">
      {section.heading ? (
        <h3 className="text-lg font-bold text-neutral-900">
          {section.heading}
        </h3>
      ) : null}
      {section.body ? (
        <p className="text-sm text-neutral-700">{section.body}</p>
      ) : null}
      {section.buttonLabel ? (
        <a
          href={section.buttonLink ?? "#"}
          className={cn(
            "inline-block rounded px-5 py-2 text-sm font-semibold transition",
            buttonClass,
          )}
          rel="noopener noreferrer"
        >
          {section.buttonLabel}
        </a>
      ) : null}
    </div>
  )
}
