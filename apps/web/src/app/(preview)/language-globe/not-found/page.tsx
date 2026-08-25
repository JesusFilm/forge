import type { Metadata } from "next"
import { ArrowLeft, Clapperboard } from "lucide-react"

import { LanguageGlobeSection } from "@/components/sections/LanguageGlobeSection"
import { languagesIndexPath, searchPath } from "@/lib/routes"

export const metadata: Metadata = {
  title: "Language Globe 404 Preview | Watch",
  description: "Standalone preview of the Watch language-globe 404 section.",
  robots: {
    index: false,
    follow: false,
  },
}

export default function LanguageGlobeNotFoundPreviewPage() {
  return (
    <main className="min-h-svh overflow-x-hidden overflow-y-auto bg-black">
      <LanguageGlobeSection
        actions={[
          {
            href: searchPath(),
            icon: <ArrowLeft aria-hidden="true" className="h-5 w-5" />,
            label: "Back to Watch",
          },
          {
            href: languagesIndexPath(),
            icon: <Clapperboard aria-hidden="true" className="h-5 w-5" />,
            label: "Browse videos",
            variant: "secondary",
          },
        ]}
        actionsLabel="Page not found actions"
        description="We couldn't find the page you're looking for, but the story continues in films and videos from languages around the world."
        eyebrow="Page not found"
        headingId="language-globe-not-found-preview-heading"
        headingLevel="h1"
        title={
          <>
            <span className="sr-only">Page not found: </span>
            This scene isn&apos;t here.
          </>
        }
        variant="not-found"
        watermark="404"
      >
        <p>Explore languages by region or browse the full list.</p>
      </LanguageGlobeSection>
    </main>
  )
}
