"use client"

import { reportDatadogRumAction } from "@/components/DatadogRum"
import {
  WATCH_HOME_SECTION_CTA_ACTION,
  watchHomeCtaAnalyticsContext,
} from "@/lib/watch-home-cta"

export function reportWatchHomeSectionCtaClick({
  href,
  sectionKey,
}: {
  href: string
  sectionKey: string | null | undefined
}) {
  try {
    reportDatadogRumAction(
      WATCH_HOME_SECTION_CTA_ACTION,
      watchHomeCtaAnalyticsContext({ href, sectionKey }),
    )
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[watch-home-cta] failed to report action:", error)
    }
  }
}
