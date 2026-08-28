// TV-side single source of truth for watch-experience external content so consumers can't drift.
// SYNC: the promotional image and the call-to-action URLs below are genuinely shared — mirror
// apps/mobile useBibleVerses.ts + RelatedQuestionsRenderer.tsx and apps/web
// BibleQuotesSection.tsx, and rotate any of them across all three apps.
// BIBLE_IMAGES is NOT shared; see its own comment.

/**
 * Decorative wallpapers cycled by citation index — not curated per verse.
 *
 * Do not sync. apps/mobile no longer cycles these: it draws each citation card
 * from a still of the video being watched, and keeps its own copy only as the
 * last rung of that fallback ladder, which most videos never reach. apps/web
 * renders a derived gradient and no photograph at all.
 */
export const BIBLE_IMAGES = [
  "https://images.unsplash.com/photo-1480869799327-03916a613b29?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/16/unsplash_526360a842e20_1.JPG?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1497333558196-daaff02b56d0?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1555892727-55b51e5fceae?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1631125915973-e0d155a14e4e?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1659260145900-1ac1afc45dcf?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1535979863199-3c77338429a0?q=80&w=800&auto=format&fit=crop",
] as const

/** Fixed hero for the trailing "Join Our Bible Study" promo card. */
export const PROMO_IMAGE_URL =
  "https://images.unsplash.com/photo-1650658720644-e1588bd66de3?w=900&auto=format&fit=crop&q=60"

export const JOIN_BIBLE_STUDY_URL =
  "https://join.bsfinternational.org/?utm_source=jesusfilm-watch"

// Answer-fallback CTAs for question rows with no inline answer.
export const CHAT_WITH_PERSON_URL =
  "https://chataboutjesus.com/chat/?utm_source=jesusfilm-watch"
export const ASK_BIBLE_QUESTION_URL =
  "https://www.everystudent.com/contact.php?utm_source=jesusfilm-watch"
export const ANSWER_FALLBACK_BODY =
  "Have a private discussion with someone who is ready to listen."
