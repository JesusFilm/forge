import type { Metadata } from "next"
import type { Route } from "next"
import { Languages } from "lucide-react"
import { LanguageGlobeSection } from "@/components/sections/LanguageGlobeSection"

export const metadata: Metadata = {
  title: "Matthew 24:14 Globe Preview | Watch",
  description:
    "Standalone preview of Matthew 24:14 rendered as an animated multilingual globe.",
  robots: {
    index: false,
    follow: false,
  },
}

export default function LanguageGlobePreviewPage() {
  return (
    <main>
      <LanguageGlobeSection
        actions={[
          {
            href: "/languages" as Route,
            icon: <Languages aria-hidden="true" className="h-5 w-5" />,
            label: "Select your language",
          },
        ]}
        actionsLabel="Language selection"
        description="Explore films and videos in languages from around the world."
        eyebrow="Watch languages"
        headingId="language-globe-preview-heading"
        title="Choose a language"
      />
    </main>
  )
}
