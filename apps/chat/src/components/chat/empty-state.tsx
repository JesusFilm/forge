"use client"

// The chat empty state: display-serif prompt + a few starter questions. Copy
// follows the Vigil charter (second person, no exclamation marks, no emoji).
// The intro line is flag-aware: it states the real reply source (Seeker vs the
// dev stub) so a dogfooder is never told "no agent" while talking to Seeker.

const STARTERS = [
  "I can't feel God anymore. Am I doing something wrong?",
  "What does Jesus actually say about money?",
  "My friend is grieving. I don't know what to say.",
  "Is doubt a sin?",
] as const

export function EmptyState({
  onPick,
  seekerEnabled = false,
}: {
  onPick: (question: string) => void
  seekerEnabled?: boolean
}) {
  return (
    <div className="pt-20 pb-10">
      <h1 className="font-display text-[28px] leading-tight font-normal tracking-[-0.01em] text-linen">
        What would you like to ask?
      </h1>
      <p className="mt-3 max-w-[480px] text-[15px] leading-relaxed text-ash">
        Scripture, doubt, prayer, next steps — ask anything.{" "}
        {seekerEnabled
          ? "Answers come from Seeker, grounded in cited sources."
          : "Replies come from a stub for now; no agent is connected yet."}
      </p>
      <div className="mt-10 border-t border-linen/5">
        {STARTERS.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => onPick(question)}
            className="group flex w-full items-center justify-between border-b border-linen/5 py-[18px] text-left transition-[padding] duration-300 hover:pl-1"
          >
            <span className="font-display text-[19px] tracking-[-0.005em] text-vellum transition-colors duration-300 group-hover:text-linen">
              {question}
            </span>
            <span className="text-ash">→</span>
          </button>
        ))}
      </div>
    </div>
  )
}
