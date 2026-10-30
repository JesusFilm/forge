import type { WatchBibleCitationPassage } from "@/lib/content"
import {
  isDeclarableHtmlLangTag,
  slugToBcp47Tag,
  textDirectionForLocale,
} from "@/lib/locale"

/** Passage identity comes from its selected Bible version, never page/chrome locale. */
export function watchPassageTextProps(passage: WatchBibleCitationPassage) {
  const tag = passage.languageSlug ? slugToBcp47Tag(passage.languageSlug) : null
  return tag && isDeclarableHtmlLangTag(tag)
    ? { lang: tag, dir: textDirectionForLocale(tag) }
    : { lang: "", dir: "auto" as const }
}
