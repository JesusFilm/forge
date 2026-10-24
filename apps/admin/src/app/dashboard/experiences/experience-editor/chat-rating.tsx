/**
 * <ChatRating> — 👍/👎 + optional comment widget rendered next to
 * ratable assistant messages in the experience-editor chat panel.
 *
 * Render gate: only mounts when `producedBy` is in
 * `RATABLE_PRODUCERS`. The parent panel makes the gate call; this
 * component still re-checks defensively so a stale producedBy can't
 * leak through.
 *
 * State: `score` (1 | 0 | null), `comment` (string), `saving`,
 * `error`. Local state seeded from `initial` and updated
 * optimistically — on failure, state reverts and an inline error
 * shows until the next thumb / comment action clears it.
 *
 * Submits via the REST endpoints in
 * apps/admin/src/app/api/experience-chat/messages/[messageId]/rating/route.ts:
 *   POST    { score, comment? }       — toggle / set
 *   DELETE                            — clear
 *
 * v1 keeps the UI minimal: two icon buttons + a one-line textarea.
 * Comment is shown inline only when a rating is active (no separate
 * "open" affordance). Pressing the active thumb again clears the
 * rating.
 */

"use client"

import { useCallback, useEffect, useState } from "react"
import { ThumbsDown, ThumbsUp } from "lucide-react"

import { isRatableProducer } from "@/services/chat-rating.constants"

export type ChatRatingState = {
  score: 1 | 0
  comment: string | null
  updatedAt: string
}

type Props = {
  messageId: string
  producedBy: string | null
  initial: ChatRatingState | null
  /**
   * Override the fetch implementation. Test seam only; production
   * callers omit it.
   */
  fetchImpl?: typeof fetch
}

const COMMENT_AUTOSAVE_DEBOUNCE_MS = 600

export function ChatRating({
  messageId,
  producedBy,
  initial,
  fetchImpl,
}: Props) {
  // All hooks must run unconditionally per the React rules-of-hooks.
  // The ratability gate is applied at render time below, NOT as an
  // early return — flipping the order would yield a different
  // hook-call sequence on subsequent renders and break state.
  const ratable = isRatableProducer(producedBy)

  const [score, setScore] = useState<1 | 0 | null>(initial?.score ?? null)
  const [comment, setComment] = useState<string>(initial?.comment ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [commentTimer, setCommentTimer] = useState<ReturnType<
    typeof setTimeout
  > | null>(null)

  const doFetch = fetchImpl ?? fetch

  // Clear any pending comment-autosave timer on unmount (and whenever a
  // new timer supersedes the previous one) so a debounced submit can't
  // fire against an unmounted component.
  useEffect(() => {
    return () => {
      if (commentTimer) clearTimeout(commentTimer)
    }
  }, [commentTimer])

  const submit = useCallback(
    async (next: 1 | 0, nextComment: string | null): Promise<void> => {
      setSaving(true)
      setError(null)
      const prevScore = score
      const prevComment = comment
      setScore(next)
      setComment(nextComment ?? "")
      try {
        const res = await doFetch(
          `/api/experience-chat/messages/${encodeURIComponent(messageId)}/rating`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ score: next, comment: nextComment }),
          },
        )
        if (!res.ok) {
          // Revert on non-2xx.
          setScore(prevScore)
          setComment(prevComment)
          const errBody = (await res.json().catch(() => null)) as {
            error?: string
          } | null
          setError(errBody?.error ?? `Could not save rating (${res.status}).`)
        }
      } catch (err) {
        setScore(prevScore)
        setComment(prevComment)
        setError(err instanceof Error ? err.message : "Network error.")
      } finally {
        setSaving(false)
      }
    },
    [comment, doFetch, messageId, score],
  )

  const clear = useCallback(async (): Promise<void> => {
    setSaving(true)
    setError(null)
    const prevScore = score
    const prevComment = comment
    setScore(null)
    setComment("")
    try {
      const res = await doFetch(
        `/api/experience-chat/messages/${encodeURIComponent(messageId)}/rating`,
        { method: "DELETE" },
      )
      if (!res.ok) {
        setScore(prevScore)
        setComment(prevComment)
        const errBody = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        setError(errBody?.error ?? `Could not clear rating (${res.status}).`)
      }
    } catch (err) {
      setScore(prevScore)
      setComment(prevComment)
      setError(err instanceof Error ? err.message : "Network error.")
    } finally {
      setSaving(false)
    }
  }, [comment, doFetch, messageId, score])

  const onThumbClick = useCallback(
    async (next: 1 | 0): Promise<void> => {
      if (saving) return
      // Clicking the active thumb clears the rating.
      if (score === next) {
        await clear()
        return
      }
      await submit(next, comment.trim() ? comment.trim() : null)
    },
    [clear, comment, saving, score, submit],
  )

  const onCommentChange = useCallback(
    (next: string): void => {
      setComment(next)
      if (score === null) {
        // No active rating: comment is captured locally but not
        // persisted until the user picks a thumb.
        return
      }
      if (commentTimer) clearTimeout(commentTimer)
      const handle = setTimeout(() => {
        void submit(score, next.trim() ? next.trim() : null)
      }, COMMENT_AUTOSAVE_DEBOUNCE_MS)
      setCommentTimer(handle)
    },
    [commentTimer, score, submit],
  )

  const upActive = score === 1
  const downActive = score === 0

  // Defense-in-depth gate (the parent panel already filters, but a
  // stale producedBy reaching here would be a bug). Returning null
  // from JSX is rules-of-hooks-safe — hooks above still ran.
  if (!ratable) return null

  return (
    <div
      data-testid={`chat-rating-${messageId}`}
      className="mt-1 flex flex-col gap-1 text-[11px] text-[var(--color-text-secondary)]"
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={upActive ? "Clear rating" : "Rate 👍"}
          aria-pressed={upActive}
          disabled={saving}
          onClick={() => void onThumbClick(1)}
          data-testid={`chat-rating-up-${messageId}`}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-sm transition-colors ${
            upActive
              ? "bg-[var(--color-surface-inset)] text-[var(--color-text-primary)]"
              : "text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-raised)]"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <ThumbsUp className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label={downActive ? "Clear rating" : "Rate 👎"}
          aria-pressed={downActive}
          disabled={saving}
          onClick={() => void onThumbClick(0)}
          data-testid={`chat-rating-down-${messageId}`}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-sm transition-colors ${
            downActive
              ? "bg-[var(--color-surface-inset)] text-[var(--color-text-primary)]"
              : "text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-raised)]"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <ThumbsDown className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        {error ? (
          <span
            role="alert"
            className="ml-1 text-[var(--color-text-warning)]"
            data-testid={`chat-rating-error-${messageId}`}
          >
            {error}
          </span>
        ) : null}
      </div>
      {score !== null ? (
        <textarea
          aria-label="Rating note (optional)"
          placeholder="Why? (optional)"
          value={comment}
          onChange={(e) => onCommentChange(e.target.value)}
          rows={1}
          maxLength={2000}
          data-testid={`chat-rating-comment-${messageId}`}
          className="w-full resize-none rounded-sm border border-[var(--color-hairline)] bg-transparent px-1.5 py-0.5 text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-hairline-strong)]"
        />
      ) : null}
    </div>
  )
}
