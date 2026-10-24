"use client"

// The video page's intent-forked "What's next" zone: the role tabs, then one
// panel holding the persona journey and that persona's own module. The
// section/panel markup is copied from the prototype (prototype-parity
// manifest); actions resolve from the published audience configuration to
// canonical routes, existing page controls or reviewed external resources —
// a target this page cannot serve is omitted, never linked to a placeholder.

import dynamic from "next/dynamic"
import Link from "next/link"
import { Suspense, useId } from "react"

import type { WatchShareFilm } from "@/lib/watch-share-kit"
import { languageVideosIndexPath, tryAsLocaleSlug } from "@/lib/routes"
import {
  WATCH_AUDIENCE_CODE_CONFIG,
  getWatchAudienceRole,
  type WatchAudienceAction,
  type WatchAudienceConfig,
  type WatchAudienceCurrentVideoTarget,
} from "@/lib/watch-audience-config"
import { textDirectionForLocale } from "@/lib/locale"
import { cn } from "@/lib/utils"
import { useRegisterWatchAudiencePresence } from "./watch-audience-presence"
import type { WatchGrowFilmContext } from "./watch-grow-film-context"
import {
  resolveWatchAudienceDestination,
  watchAudienceActionIcon,
  type WatchJourneyDestination,
} from "./watch-audience-actions"
import { WatchFindFlowHost } from "./WatchFindLauncher"
import { useWatchRole } from "./watch-role"
import { WatchRoleJourney, type JourneyAction } from "./WatchRoleJourney"
import { WatchRoleTabs, watchRolePanelProps } from "./WatchRoleTabs"

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
  /** Resolved published locale, including English fallback; distinct from page locale. */
  questionnaireLocale?: string
  config?: WatchAudienceConfig
  currentVideoActions?: Partial<
    Record<WatchAudienceCurrentVideoTarget, () => void>
  >
  /** The current film for Grow and the next-episode action; absent off a video. */
  growFilm?: WatchGrowFilmContext | null
  /**
   * Set when the host renders the role tabs itself (the video page draws them
   * above its persona band); the panel then labels itself by those tabs.
   */
  tabsIdBase?: string
}

/** Bridges a resolved action to the journey's render-prop cards. */
function toJourneyAction(
  action: WatchAudienceAction,
  destination: WatchJourneyDestination,
): JourneyAction {
  return {
    id: action.id,
    Icon: watchAudienceActionIcon(action.target),
    title: action.title,
    body: action.body,
    render: ({ className, children }) => {
      switch (destination.kind) {
        case "control":
          return (
            <button
              type="button"
              data-action-id={action.id}
              className={className}
              onClick={destination.onClick}
            >
              {children}
            </button>
          )
        case "resource":
          return (
            <a
              data-action-id={action.id}
              className={className}
              href={destination.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          )
        case "watch":
          return (
            <Link
              data-action-id={action.id}
              className={className}
              href={destination.href}
              prefetch={false}
            >
              {children}
            </Link>
          )
      }
    },
  }
}

export function WatchNextSteps({
  shareFilm = null,
  onRequestShareLanguages,
  languageSlug,
  locale,
  config = WATCH_AUDIENCE_CODE_CONFIG,
  questionnaireLocale = "en",
  currentVideoActions = {},
  growFilm = null,
  tabsIdBase,
}: WatchNextStepsProps) {
  const { role: mode, hydrated } = useWatchRole()
  const ownIdBase = useId()
  const idBase = tabsIdBase ?? ownIdBase
  const definition = getWatchAudienceRole(config, mode)
  const language = languageSlug ? tryAsLocaleSlug(languageSlug) : null
  useRegisterWatchAudiencePresence(config, language)
  const actions = (definition?.actions ?? []).flatMap((action) => {
    const destination = resolveWatchAudienceDestination(
      action.target,
      language,
      currentVideoActions,
      growFilm?.nextEpisode?.href,
    )
    return destination ? [toJourneyAction(action, destination)] : []
  })
  const englishResources =
    (locale != null && locale.split("-")[0] !== "en") ||
    (language != null && language !== "english")
  const journey = definition ? (
    <WatchRoleJourney
      key={mode}
      definition={definition}
      actions={actions}
      locale={questionnaireLocale}
    />
  ) : null

  const panel = (
    <section
      aria-labelledby={`${ownIdBase}-heading`}
      data-testid="watch-next-steps"
      data-mode={mode}
      data-role={mode}
      className={cn(
        "w-full py-6 text-stone-100 transition-opacity duration-300 md:py-8",
        hydrated ? "opacity-100" : "opacity-0",
      )}
    >
      <h2 id={`${ownIdBase}-heading`} lang="en" dir="ltr" className="sr-only">
        What’s next
      </h2>

      <div
        {...watchRolePanelProps(idBase, mode)}
        data-testid="watch-next-steps-panel"
        className="relative min-w-0 text-white"
      >
        <div
          data-testid="watch-next-steps-reveal"
          className={cn(
            "grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.2,0.9,0.2,1)]",
            "grid-rows-[1fr]",
          )}
        >
          <div className="min-h-0 min-w-0">
            <div className={cn("grid min-w-0 grid-cols-1 gap-6")}>
              {/* Persona journey — on the Partner tab the panel shows it
                  only behind the real account session, so a signed-out
                  visitor sees only the promo + log-in. */}
              {mode === "partner" ? null : journey}

              {/* A first visit may suspend while a persona chunk loads. Keep
                  that wait inside the panel, rather than hiding the route's
                  player and page behind its outer loading boundary. */}
              <Suspense fallback={null}>
                {mode !== "explore" ? (
                  <div lang="en" dir="ltr">
                    {mode === "grow" ? <WatchGrow {...growFilm} /> : null}

                    {mode === "share" ? (
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
                    ) : null}

                    {/* Partner tab: promo for everyone, journey and materials only
                  once the real session says signed-in. */}
                    {mode === "partner" && language && locale ? (
                      <WatchPartnerPanel
                        languageSlug={language}
                        locale={locale}
                        journey={journey}
                      />
                    ) : null}
                  </div>
                ) : null}
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </section>
  )

  return (
    <div
      lang={questionnaireLocale}
      dir={textDirectionForLocale(questionnaireLocale)}
      className="min-w-0"
    >
      {englishResources ? (
        <p lang="en" dir="ltr" className="mb-4 text-sm text-white/60">
          English resources
        </p>
      ) : null}
      {tabsIdBase ? (
        panel
      ) : (
        <>
          <WatchRoleTabs className="mt-2" idBase={idBase} config={config} />
          {/* Standalone frame: it owns the page's one finder host (Grow opens it). */}
          {language && locale ? (
            <WatchFindFlowHost languageSlug={language} locale={locale} />
          ) : null}
          <div className="pt-8">{panel}</div>
        </>
      )}
    </div>
  )
}
