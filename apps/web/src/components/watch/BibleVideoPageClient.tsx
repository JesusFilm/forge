"use client"

import type { ComponentProps } from "react"

import { WatchPageClient } from "@/components/watch/WatchPageClient"
import { bibleVideoPath } from "@/lib/routes"

type BibleVideoPageClientProps = Omit<
  ComponentProps<typeof WatchPageClient>,
  "videoPathBuilder"
>

export function BibleVideoPageClient(props: BibleVideoPageClientProps) {
  return (
    <WatchPageClient
      {...props}
      videoPathBuilder={bibleVideoPath}
      showRelatedQuestions={false}
      showHeroCta={false}
      showHeroOverlay={false}
      showHeroTitle={false}
    />
  )
}
