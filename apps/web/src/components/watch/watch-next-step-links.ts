import type { WatchBibleCitationPassage } from "@/lib/content"

export const CHAT_WITH_PERSON_URL =
  "https://chataboutjesus.com/chat/?utm_source=jesusfilm-watch"
export const ASK_BIBLE_QUESTION_URL =
  "https://www.everystudent.com/contact.php?utm_source=jesusfilm-watch"
export const ASK_YOURS_URL =
  "https://issuesiface.com/talk?utm_source=jesusfilm-watch"
export const JOIN_BIBLE_STUDY_URL =
  "https://join.bsfinternational.org/?utm_source=jesusfilm-watch"

export function getBibleComUrl(
  passage: WatchBibleCitationPassage | null | undefined,
): string | null {
  if (
    passage == null ||
    passage.reference.trim() === "" ||
    passage.versionAbbreviation == null ||
    passage.versionAbbreviation.trim() === ""
  ) {
    return null
  }

  return `https://www.bible.com/bible/${passage.versionId}/${encodeURIComponent(
    passage.reference,
  )}.${encodeURIComponent(passage.versionAbbreviation.trim())}`
}

export function findBibleReadHref(
  passages: readonly WatchBibleCitationPassage[] | null | undefined,
): string | null {
  for (const passage of passages ?? []) {
    const href = getBibleComUrl(passage)
    if (href) return href
  }
  return null
}
