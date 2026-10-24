"use client"

import dynamic from "next/dynamic"
import { useState } from "react"
import Link from "next/link"
import type { WatchShareFilm } from "@/lib/watch-share-kit"
import { hasWatchGrowReturnIntent } from "@/lib/watch-grow-return-intent"

import {
  languageVideosIndexPath,
  languagesIndexPath,
  localizedHistoryPath,
  localizedLanguagesPath,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchVideoPath,
} from "@/lib/routes"
import {
  WATCH_AUDIENCE_CODE_CONFIG,
  getWatchAudienceRole,
  isSafeWatchAudienceTarget,
  type WatchAudienceConfig,
  type WatchAudienceCurrentVideoTarget,
} from "@/lib/watch-audience-config"
import { WatchFindLauncher } from "./WatchFindLauncher"
import { useWatchRole } from "./watch-role"
import {
  WatchRoleJourney,
  type WatchJourneyAction,
  type WatchJourneyDestination,
} from "./WatchRoleJourney"
import { WatchRoleTabs } from "./WatchRoleTabs"

const WatchShareIdeas = dynamic(() =>
  import("./WatchShareIdeas").then((module) => module.WatchShareIdeas),
)

const WatchPartnerPanel = dynamic(() =>
  import("./WatchPartnerPanel").then((module) => module.WatchPartnerPanel),
)

const WatchGrow = dynamic(() =>
  import("./WatchGrow").then((module) => module.WatchGrow),
)

export type WatchNextStepsProps = {
  shareFilm?: WatchShareFilm | null
  onRequestShareLanguages?: () => void
  languageSlug?: string
  locale?: string
  config?: WatchAudienceConfig
  currentVideoActions?: Partial<
    Record<WatchAudienceCurrentVideoTarget, () => void>
  >
}

/** Shared home/video frame. The host supplies only controls that work here. */
export function WatchNextSteps({
  shareFilm = null,
  onRequestShareLanguages,
  languageSlug,
  locale,
  config = WATCH_AUDIENCE_CODE_CONFIG,
  currentVideoActions = {},
}: WatchNextStepsProps) {
  const { role } = useWatchRole()
  const [growReturn] = useState(() => hasWatchGrowReturnIntent())
  const [partnerReturn] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("partnerPanel") ===
        "account",
  )
  const definition = getWatchAudienceRole(config, role)
  const language = languageSlug ? tryAsLocaleSlug(languageSlug) : null
  const actions: WatchJourneyAction[] = (definition?.actions ?? []).flatMap(
    (action) => {
      if (!isSafeWatchAudienceTarget(action.target)) return []
      const target = action.target
      let destination: WatchJourneyDestination
      switch (target.kind) {
        case "video": {
          const slug = tryAsContentSlug(target.slug)
          if (!slug || !language) return []
          destination = { kind: "watch", href: watchVideoPath(slug, language) }
          break
        }
        case "history":
          if (!language) return []
          destination = { kind: "watch", href: localizedHistoryPath(language) }
          break
        case "languages":
          destination = {
            kind: "watch",
            href: language
              ? localizedLanguagesPath(language)
              : languagesIndexPath(),
          }
          break
        case "current-video": {
          const onClick = currentVideoActions[target.target]
          if (!onClick) return []
          destination = { kind: "control", onClick }
          break
        }
        case "resource":
          destination = { kind: "resource", href: target.url }
          break
      }
      return [{ ...action, destination }]
    },
  )
  const englishResources =
    (locale != null && locale.split("-")[0] !== "en") ||
    (language != null && language !== "english")

  return (
    <section
      aria-label="Find your next step"
      data-testid="watch-next-steps"
      data-role={role}
      className="w-full py-6 text-white md:py-8"
    >
      {englishResources ? (
        <p lang="en" className="mb-4 text-sm text-white/60">
          English resources
        </p>
      ) : null}
      <div lang="en" dir="ltr">
        <WatchRoleTabs config={config}>
          {definition ? (
            <WatchRoleJourney
              key={role}
              definition={definition}
              actions={actions}
              afterResult={
                role === "explore" && language && locale ? (
                  <div className="mt-6">
                    <WatchFindLauncher
                      languageSlug={language}
                      locale={locale}
                    />
                  </div>
                ) : role === "share" ? (
                  <WatchShareIdeas
                    film={shareFilm}
                    onShareClick={currentVideoActions.share}
                    onRequestLanguageOptions={onRequestShareLanguages}
                    collection={
                      language ? (
                        <Link
                          href={languageVideosIndexPath(language)}
                          prefetch={false}
                          className="inline-flex min-h-11 items-center underline underline-offset-4"
                        >
                          Browse films in this audio language
                        </Link>
                      ) : null
                    }
                  />
                ) : role === "grow" && !growReturn ? (
                  <WatchGrow />
                ) : role === "partner" &&
                  !partnerReturn &&
                  language &&
                  locale ? (
                  <WatchPartnerPanel languageSlug={language} locale={locale} />
                ) : null
              }
            />
          ) : null}
          {role === "partner" && partnerReturn && language && locale ? (
            <WatchPartnerPanel languageSlug={language} locale={locale} />
          ) : null}
          {role === "grow" && growReturn ? <WatchGrow /> : null}
        </WatchRoleTabs>
      </div>
    </section>
  )
}
