/**
 * `chat-thumb-rating` scorer — the logical bucket for human 👍/👎
 * ratings recorded against workflow-generated assistant messages in
 * the experience-editor AI chat panel.
 *
 * This is NOT a `createScorer(...).generateScore(...)` style automated
 * evaluator. We never run an LLM judge here. The id and descriptor
 * below are passed directly into Mastra storage's `saveScore({...})`
 * call as the `scorerId` + `scorer` fields, so the human-feedback
 * records can be queried via `listScoresByScorerId(...)`.
 *
 * Why a stable id + descriptor instead of `createScorer(...)`:
 * - `saveScore`'s payload takes both `scorerId: string` (the
 *   queryable key) and `scorer: Record<string, unknown>` (the
 *   descriptor object Mastra Studio renders). Both must be present
 *   on every write; the values must be identical across writes so a
 *   later `listScoresByScorerId('chat-thumb-rating')` returns the
 *   full set.
 * - The `@mastra/core/evals` `createScorer(...)` API is designed for
 *   the LLM-driven evaluation flow where `.generateScore(...)` is
 *   invoked against an agent run. Shoe-horning human clicks into that
 *   shape adds ceremony with no payoff — we already know the score.
 *
 * Score values:
 *   - `1` = 👍
 *   - `0` = 👎
 *   - "cleared" state is encoded via `metadata.cleared: true` on the
 *     latest record (score stays a number; Mastra's `SaveScorePayload`
 *     schema requires `score: number`, not nullable). The read path
 *     in `chat-rating.service` resolves "current" as the latest
 *     record's score IFF `metadata.cleared !== true`.
 *
 * Required `SaveScorePayload` fields the rating service must populate
 * on every write — kept as a comment here so the contract is
 * discoverable from the scorer module:
 *
 *   {
 *     scorerId: CHAT_THUMB_RATING_SCORER_ID,
 *     scorer:   chatThumbRatingScorerDescriptor,
 *     source:   "LIVE" (or "TEST" in test fixtures),
 *     runId:    workflowRunId ?? messageId,   // synthetic when chat-agent
 *     entityId: messageId,                    // ExperienceChatMessage.id
 *     entity:   { messageId, producedBy },
 *     score:    1 | 0,
 *     output:   { messageId },
 *     metadata: {
 *       raterUserId, comment, producedBy,
 *       cleared?: true,                       // present only on clear-rating records
 *       entityKind: "experience_chat_message" // narrow tag in metadata since
 *                                             // Mastra's `entityType` enum is
 *                                             // closed to {AGENT, WORKFLOW, ...}
 *     },
 *   }
 *
 * The `entityType` field on `SaveScorePayload` is a closed enum at
 * `@mastra/core@1.33.1` (`AGENT | WORKFLOW | TRAJECTORY | STEP |
 * ...SpanType`). We intentionally omit it and tag our entity kind
 * in `metadata.entityKind` instead — the closed enum has no
 * `message`-shaped value, and inventing one would break Zod
 * validation at the storage layer.
 *
 * Read path: use `listScoresByScorerId({scorerId, entityId,
 * pagination})` rather than `listScoresByEntityId({entityId,
 * entityType, ...})`. The latter requires the closed `entityType`
 * enum we can't persist; the former takes both as optional filters
 * keyed by the scorer id we own and yields the same result.
 */

/**
 * Stable scorer id. Used as `scorerId` on every saveScore call and as
 * the query key for `listScoresByScorerId`. NEVER rename without a
 * data migration — every persisted score row carries this string.
 */
export const CHAT_THUMB_RATING_SCORER_ID = "chat-thumb-rating" as const

/**
 * Human-readable name shown in Mastra Studio's scores view.
 */
export const CHAT_THUMB_RATING_SCORER_NAME = "Chat thumb rating" as const

/**
 * Descriptor object copied into the `scorer` field of every
 * `saveScore` payload. `saveScorePayloadSchema` requires
 * `scorer: Record<string, unknown>`; the shape is otherwise free.
 * Keeping a single exported descriptor means every write uses the
 * identical object, which Studio renders uniformly.
 */
export const chatThumbRatingScorerDescriptor = {
  id: CHAT_THUMB_RATING_SCORER_ID,
  name: CHAT_THUMB_RATING_SCORER_NAME,
} as const

/**
 * Tag stored in `metadata.entityKind` on every rating record. Mastra's
 * `entityType` enum is closed and does not include a message-shaped
 * value — we tag our own kind in metadata so consumers can filter on
 * it. The string is a stable contract; changing it would orphan
 * existing rating rows from the read path.
 */
export const CHAT_RATING_ENTITY_KIND = "experience_chat_message" as const

// ---------------------------------------------------------------------------
// Mastra Studio registration
// ---------------------------------------------------------------------------

import { createScorer } from "@mastra/core/evals"

/**
 * MastraScorer instance for Studio registration.
 *
 * The chat-rating service does NOT invoke this object's `.run()` /
 * `.generateScore()` — human 👍/👎 clicks are written directly via
 * `storage.saveScore({ scorerId, ... })` from `chat-rating.service`.
 * The scorer is constructed and registered with the Mastra instance
 * (`new Mastra({ scorers: { ... } })` in `../index.ts`) solely so
 * Mastra Studio's "Scorers" view recognises the `chat-thumb-rating`
 * id and surfaces the records that already land in
 * `mastra.mastra_scorers` under it.
 *
 * The `generateScore` step is a hard error — if Mastra ever calls
 * it, that means something invoked the scorer through the eval
 * pipeline (which we explicitly don't do), and the operator should
 * find out fast rather than silently producing a synthetic score.
 */
export const chatThumbRatingScorer = createScorer({
  id: CHAT_THUMB_RATING_SCORER_ID,
  name: CHAT_THUMB_RATING_SCORER_NAME,
  description:
    "Human 👍/👎 ratings on AI chat panel assistant messages. Records are " +
    "written directly via storage.saveScore from the chat-rating service; " +
    "no LLM judge is run.",
}).generateScore(() => {
  throw new Error(
    "chat-thumb-rating is human-driven; generateScore must never be invoked " +
      "(records are written via storage.saveScore from chat-rating.service).",
  )
})

/**
 * Score values written on click. The cleared state is NOT encoded in
 * the numeric score — see `metadata.cleared` above.
 */
export const CHAT_RATING_SCORE_UP = 1 as const
export const CHAT_RATING_SCORE_DOWN = 0 as const

export type ChatRatingScore =
  | typeof CHAT_RATING_SCORE_UP
  | typeof CHAT_RATING_SCORE_DOWN
