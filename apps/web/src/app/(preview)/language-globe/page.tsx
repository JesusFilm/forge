import type { Metadata } from "next"
import { LanguageGlobeExperience } from "@/components/sections/LanguageGlobeExperience"

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
      <LanguageGlobeExperience
        data={{
          sectionKey: "language-globe-preview",
          eyebrow: "Watch languages",
          title: "Choose a language",
          description:
            "Explore films and videos in languages from around the world.",
          ctaEnabled: true,
          ctaLabel: "Select your language",
          ctaLink: "/languages",
        }}
      />
    </main>
  )
}
