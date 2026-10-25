type FollowUpsProps = {
  questions: string[]
  /** Defensive only (R3): keeps the chips visible but inert. No production
   * state reaches it — a pending send replaces the last turn, and a
   * replay-blocked conversation has no hydrated turns. */
  disabled?: boolean
  onSelect: (question: string) => void
}

/**
 * The suggested follow-up questions under a finished Seeker answer (feat-366).
 * A labeled `<nav>` landmark of real `<button>`s, so the set is reachable as
 * one region and each chip is keyboard-operable. Question text is model-
 * authored and renders as React-escaped PLAIN TEXT — never through the
 * markdown allowlist, since a click sends it verbatim as the person's own
 * next message (KD4). An empty list renders nothing at all, never an empty
 * container. Placement (last turn only, finalized turns only) is the caller's
 * decision — see message-list.tsx.
 */
export function FollowUps({
  questions,
  disabled = false,
  onSelect,
}: FollowUpsProps) {
  if (questions.length === 0) return null

  return (
    <nav
      aria-label="Suggested follow-up questions"
      data-follow-ups="section"
      className="mt-3 flex flex-wrap gap-2"
    >
      {questions.map((question, index) => (
        <button
          key={`${index}-${question}`}
          type="button"
          disabled={disabled}
          data-follow-up-index={index}
          onClick={() => onSelect(question)}
          className="max-w-full rounded-full border border-linen/15 px-3.5 py-2 text-left text-sm text-vellum transition-colors duration-300 hover:bg-linen/[0.06] hover:text-linen disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
        >
          {question}
        </button>
      ))}
    </nav>
  )
}
