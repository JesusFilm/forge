import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CONTENT_SCOPES,
  FEEDBACK_LANGUAGE_AREAS,
  type FeedbackCategory,
  type FeedbackContentScope,
  type FeedbackLanguageArea,
  type FeedbackSelectedElement,
} from "@/lib/feedback"
import type { WatchSearchSuggestion } from "@/lib/watch-search-client"

/*
 * A draft of whatever someone has typed into the feedback composer.
 *
 * Closing the composer used to destroy it: Escape or a backdrop click closed
 * the dialog with no warning, and because the launcher unmounts the modal on
 * close, every field went with it. Someone who spent minutes describing a bug
 * lost all of it to one stray keystroke — which costs the longest and most
 * useful reports first.
 *
 * `sessionStorage`, not `localStorage`, on purpose: a half-written report is
 * the reporter's own text and should not outlive the tab they wrote it in.
 * Cleared outright on a successful submission.
 */

const DRAFT_STORAGE_KEY = "forge.watch.feedback_draft"

/**
 * Wizard length, duplicated here on purpose: importing it from the analytics
 * module would pull that module into every consumer of this one. Pinned
 * against the real vocabulary by this module's own test.
 */
const FEEDBACK_DRAFT_STEP_COUNT = 5

/*
 * Read caps, matched to the SUBMISSION schema rather than to one shared
 * number. A draft is re-read from storage another tab (or an older build)
 * could have written, so a value restored above the schema's own bound would
 * reach the server as an opaque `invalid` — and the rate limiter runs BEFORE
 * validation, so a few retries of an unfixable field lock the reporter out.
 * Keep these in step with `feedbackSubmissionSchema` in `feedback-linear.ts`.
 */
const MAX_MESSAGE_LENGTH = 1000
const MAX_NAME_LENGTH = 100
const MAX_EMAIL_LENGTH = 254
const MAX_SHORT_FIELD_LENGTH = 200

/** The composer's own floor for a submittable message (`validation.message`). */
export const FEEDBACK_DRAFT_MIN_MESSAGE_LENGTH = 10

export type FeedbackDraft = {
  /**
   * Pathname the draft was written on. Feedback is ABOUT a page, so a draft
   * started on one page must not be restored onto another — it would attach
   * someone's report to the wrong URL. Restoring is scoped by this.
   */
  path: string
  step: number
  category: FeedbackCategory | null
  message: string
  name: string
  email: string
  languageArea: FeedbackLanguageArea | ""
  languageSlug: string
  customLanguageName: string
  useCustomLanguage: boolean
  contentScope: FeedbackContentScope | ""
  contentQuery: string
  /**
   * The two fields a reader spends the most effort on and cannot retype:
   * the video they picked out of a search, and the element they pointed at.
   * Persisted as bounded projections — enough for the payload and the
   * rendered summary, nothing else.
   */
  selectedContent: FeedbackDraftContent | null
  selectedElement: FeedbackSelectedElement | null
}

/** Exactly the `WatchSearchSuggestion` fields the payload and summary use. */
export type FeedbackDraftContent = {
  title: string
  id: string | null
  slug: string | null
  label: WatchSearchSuggestion["label"]
  description: string | null
}

function boundedString(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : ""
}

function memberOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null
}

/**
 * Re-reads a stored draft defensively. Everything here came back from storage,
 * which another tab, an extension or an older build of this app could have
 * written, so every field is re-validated against the same vocabularies the
 * form itself uses rather than trusted as the shape it was saved in.
 */
function nullableString(value: unknown, max: number): string | null {
  return typeof value === "string" && value ? value.slice(0, max) : null
}

/** Re-validated projection of a stored content selection. Title-less is nothing. */
function parseContent(value: unknown): FeedbackDraftContent | null {
  if (typeof value !== "object" || value === null) return null
  const content = value as Record<string, unknown>
  const title = boundedString(content.title, MAX_SHORT_FIELD_LENGTH)
  if (!title) return null
  return {
    title,
    id: nullableString(content.id, MAX_SHORT_FIELD_LENGTH),
    slug: nullableString(content.slug, MAX_SHORT_FIELD_LENGTH),
    // The label is a wire enum this module deliberately does not own a copy
    // of; anything non-string degrades to null rather than being trusted.
    label: (nullableString(content.label, MAX_SHORT_FIELD_LENGTH) ??
      null) as FeedbackDraftContent["label"],
    description: nullableString(content.description, MAX_SHORT_FIELD_LENGTH),
  }
}

/** Re-validated projection of a stored element pick. All three parts or none. */
function parseSelectedElement(value: unknown): FeedbackSelectedElement | null {
  if (typeof value !== "object" || value === null) return null
  const element = value as Record<string, unknown>
  const label = boundedString(element.label, MAX_SHORT_FIELD_LENGTH)
  const role = boundedString(element.role, MAX_SHORT_FIELD_LENGTH)
  const path = boundedString(element.path, MAX_SHORT_FIELD_LENGTH)
  if (!label || !role || !path) return null
  return { label, role, path }
}

/**
 * The step a restored draft may resume on.
 *
 * Bounded by what the draft can actually SATISFY, not just by the wizard's
 * length. A stored step past an unmet requirement would drop the reporter on
 * the Send button with a message the server will reject — and because the
 * rate limiter runs before schema validation, retrying an unfixable field
 * burns the allowance. Landing them on the step that still needs work is both
 * honest and recoverable.
 */
export function clampFeedbackDraftStep(draft: FeedbackDraft): number {
  const requested = Number.isInteger(draft.step) ? draft.step : 1
  const bounded = Math.min(Math.max(requested, 1), FEEDBACK_DRAFT_STEP_COUNT)
  if (!draft.category) return 1
  if (draft.message.trim().length < FEEDBACK_DRAFT_MIN_MESSAGE_LENGTH) {
    return Math.min(bounded, 2)
  }
  return bounded
}

function parseDraft(raw: string): FeedbackDraft | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const draft = parsed as Record<string, unknown>
  const path = boundedString(draft.path, MAX_SHORT_FIELD_LENGTH)
  if (!path) return null

  const step = draft.step
  return {
    path,
    step: typeof step === "number" && Number.isInteger(step) ? step : 1,
    category: memberOf(draft.category, FEEDBACK_CATEGORIES),
    message: boundedString(draft.message, MAX_MESSAGE_LENGTH),
    name: boundedString(draft.name, MAX_NAME_LENGTH),
    email: boundedString(draft.email, MAX_EMAIL_LENGTH),
    languageArea: memberOf(draft.languageArea, FEEDBACK_LANGUAGE_AREAS) ?? "",
    languageSlug: boundedString(draft.languageSlug, MAX_SHORT_FIELD_LENGTH),
    customLanguageName: boundedString(
      draft.customLanguageName,
      MAX_SHORT_FIELD_LENGTH,
    ),
    useCustomLanguage: draft.useCustomLanguage === true,
    contentScope: memberOf(draft.contentScope, FEEDBACK_CONTENT_SCOPES) ?? "",
    contentQuery: boundedString(draft.contentQuery, MAX_SHORT_FIELD_LENGTH),
    selectedContent: parseContent(draft.selectedContent),
    selectedElement: parseSelectedElement(draft.selectedElement),
  }
}

/** True when a draft holds anything worth restoring. */
export function feedbackDraftHasContent(draft: FeedbackDraft): boolean {
  return Boolean(
    draft.message.trim() ||
    draft.category ||
    draft.name.trim() ||
    draft.email.trim() ||
    draft.languageArea ||
    draft.contentScope,
  )
}

/**
 * The draft for `path`, or `null`. Returns nothing for a draft written on a
 * different page, and clears it — the reporter has moved on, and keeping it
 * would only wait to be restored onto a third page later.
 */
export function loadFeedbackDraft(path: string): FeedbackDraft | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return null
    const draft = parseDraft(raw)
    if (!draft) {
      clearFeedbackDraft()
      return null
    }
    if (draft.path !== path) {
      clearFeedbackDraft()
      return null
    }
    return feedbackDraftHasContent(draft) ? draft : null
  } catch {
    // Storage can be disabled, full, or partitioned. A draft is a convenience;
    // never let it break the composer.
    return null
  }
}

export function saveFeedbackDraft(draft: FeedbackDraft): void {
  if (typeof window === "undefined") return
  try {
    if (!feedbackDraftHasContent(draft)) {
      clearFeedbackDraft()
      return
    }
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // Best-effort, as above.
  }
}

export function clearFeedbackDraft(): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.removeItem(DRAFT_STORAGE_KEY)
  } catch {
    // Best-effort, as above.
  }
}
