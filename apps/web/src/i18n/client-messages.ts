import type englishMessages from "../../messages/en.json"
import type { UiLocale } from "@/lib/locale"

export type ClientMessageNamespace = keyof typeof englishMessages

type MessageCatalog = typeof englishMessages

export const GLOBAL_CLIENT_MESSAGE_NAMESPACES = [
  "AccountControl",
  "BetaTesterModal",
  "ExperienceError",
  "Feedback",
  "FloatingSearch",
  "LanguageCombobox",
  "LanguagePickerModal",
  "SearchOverlay",
  "SearchResultCard",
  "VideoLabels",
  "WatchModal",
  "WatchNotFound",
] as const satisfies readonly ClientMessageNamespace[]

export const WATCH_HOME_CLIENT_MESSAGE_NAMESPACES = [
  "BibleQuotes",
  "ExperienceError",
  "ExperienceSkeleton",
  "HeroPlayerControls",
  "LanguageCombobox",
  "LanguagePickerModal",
  "SearchResultCard",
  "VideoLabels",
  "VideoRecommendations",
  "WatchFooter",
  "WatchHome",
  "WatchHomeCategories",
  "WatchHomePromo",
  "WatchHomeSections",
  "WatchModal",
  "WatchStudyQuestions",
] as const satisfies readonly ClientMessageNamespace[]

export const WATCH_CONTENT_CLIENT_MESSAGE_NAMESPACES = [
  "BibleQuotes",
  "CollectionDownloadModal",
  "DownloadButton",
  "DownloadModal",
  "ExperienceError",
  "ExperienceSkeleton",
  "HeroPlayer",
  "HeroPlayerControls",
  "LanguageCombobox",
  "LanguagePickerModal",
  "SearchResultCard",
  "SeriesPage",
  "ShareModal",
  "SiblingCarousel",
  "SubtitleTranscript",
  "VideoLabels",
  "VideoRecommendations",
  "WatchFooter",
  "WatchHome",
  "WatchHomeSections",
  "WatchModal",
  "WatchQuestionPanel",
  "WatchStudyQuestions",
] as const satisfies readonly ClientMessageNamespace[]

export const LANGUAGE_INVENTORY_CLIENT_MESSAGE_NAMESPACES = [
  "LanguageCombobox",
  "LanguageInventory",
  "VideoLabels",
  "WatchHome",
] as const satisfies readonly ClientMessageNamespace[]

export const LANGUAGE_INDEX_CLIENT_MESSAGE_NAMESPACES = [
  "WatchLanguageIndex",
] as const satisfies readonly ClientMessageNamespace[]

export const WATCH_HISTORY_CLIENT_MESSAGE_NAMESPACES = [
  "VideoLabels",
  "WatchHistory",
] as const satisfies readonly ClientMessageNamespace[]

export function pickClientMessages(
  messages: MessageCatalog,
  namespaces: readonly ClientMessageNamespace[],
): Partial<MessageCatalog> {
  return Object.fromEntries(
    namespaces.map((namespace) => [namespace, messages[namespace]]),
  ) as Partial<MessageCatalog>
}

export async function loadClientMessages(
  locale: UiLocale,
  namespaces: readonly ClientMessageNamespace[],
): Promise<Partial<MessageCatalog>> {
  const messages = (await import(`../../messages/${locale}.json`))
    .default as MessageCatalog
  return pickClientMessages(messages, namespaces)
}
