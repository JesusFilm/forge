// Resolves a configuration action for the page it is shown on. Shared by the
// home band and the video page's "What's next" zone; kept out of both so home
// does not load the video zone's modules.

import {
  ArrowRight,
  BookOpen,
  Download,
  Globe,
  History,
  Play,
  Send,
  type LucideIcon,
} from "lucide-react"
import type { Route } from "next"

import {
  languagesIndexPath,
  localizedHistoryPath,
  localizedLanguagesPath,
  tryAsContentSlug,
  watchVideoPath,
  type LocaleSlug,
} from "@/lib/routes"
import {
  isSafeWatchAudienceTarget,
  type WatchAudienceActionTarget,
  type WatchAudienceCurrentVideoTarget,
} from "@/lib/watch-audience-config"

export type WatchJourneyDestination =
  | { kind: "watch"; href: Route }
  | { kind: "resource"; href: string }
  | { kind: "control"; onClick: () => void }

/** The icon a resolved action carries; the configuration holds none. */
export function watchAudienceActionIcon(
  target: WatchAudienceActionTarget,
): LucideIcon {
  switch (target.kind) {
    case "video":
      return Play
    case "history":
      return History
    case "languages":
      return Globe
    case "resource":
      return BookOpen
    case "current-video":
      return target.target === "download"
        ? Download
        : target.target === "share"
          ? Send
          : target.target === "next-episode"
            ? ArrowRight
            : BookOpen
  }
}

/**
 * Where an action goes on this page, or null when the page cannot serve it.
 * Every href is a canonical Watch route in the visitor's audio language or a
 * validated https resource.
 */
export function resolveWatchAudienceDestination(
  target: WatchAudienceActionTarget,
  language: LocaleSlug | null,
  currentVideoActions: Partial<
    Record<WatchAudienceCurrentVideoTarget, () => void>
  >,
  /** The next film in the current series, in the visitor's audio language. */
  nextEpisodeHref?: Route | null,
): WatchJourneyDestination | null {
  if (!isSafeWatchAudienceTarget(target)) return null
  switch (target.kind) {
    case "video": {
      const slug = tryAsContentSlug(target.slug)
      if (!slug || !language) return null
      return { kind: "watch", href: watchVideoPath(slug, language) }
    }
    case "history":
      if (!language) return null
      return { kind: "watch", href: localizedHistoryPath(language) }
    case "languages":
      return {
        kind: "watch",
        href: language
          ? localizedLanguagesPath(language)
          : languagesIndexPath(),
      }
    case "current-video": {
      const onClick = currentVideoActions[target.target]
      if (onClick) return { kind: "control", onClick }
      if (target.target === "next-episode" && nextEpisodeHref) {
        return { kind: "watch", href: nextEpisodeHref }
      }
      return null
    }
    case "resource":
      return { kind: "resource", href: target.url }
  }
}
