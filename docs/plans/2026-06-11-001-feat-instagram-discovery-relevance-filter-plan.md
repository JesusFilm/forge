---
title: "feat: Instagram discovery relevance filter (exclusion keywords + AI relevance check)"
type: feat
status: active
created: 2026-06-11
depth: standard
---

# feat: Instagram Discovery Relevance Filter

## Problem & Context

The deployed `instagram-ai-christian-discovery` workflow (commit `d2505c5a`,
`apps/mastra`) uses keyword matching: a post qualifies if its caption contains
any AI keyword AND any Christian keyword. Live runs show this surfaces a lot of
**commentary about** AI Christian content (news, reactions, "here's my Veo 3
prompt" tutorials, bloggers discussing AI music) rather than **actual AI-made
Christian video creations**. Real-world precision was ~3 good out of 12.

Root cause: keyword matching can't tell a _creation_ from _talk about_
creations — both contain the same words. The fix is two added filtering stages:

1. **Exclusion keyword filter** (cheap, deterministic): drop posts whose caption
   clearly reads as commentary/news/tutorial.
2. **AI relevance check** (the real fix): an LLM reads each surviving caption and
   judges "actual AI-made Christian video to feature, or commentary?" — keep only
   real creations.

Both run **after** the existing AI+Christian keyword qualify, narrowing the kept
set. The AI check is opt-in and degrades gracefully when no LLM key is present.

## Requirements

- R1. Add a commentary exclusion filter: a post that otherwise qualifies is
  dropped if its caption signals commentary/news/tutorial/reaction.
- R2. Add an AI relevance check that judges each keyword-qualified, non-excluded
  post and keeps only genuine AI-made Christian video creations.
- R3. The AI check is controllable: an input flag (default on) and graceful skip
  when no OpenRouter key is configured (no crash, no failure — just behaves like
  keyword-only).
- R4. The run report records _why_ posts were dropped (commentary vs. AI-judged
  not-relevant) and the relevance reason per kept post, for operator insight.
- R5. New env vars are optional/defaulted and not added to
  `assertMastraRuntimeEnv()`.

Success criteria: on a realistic run, the kept set is dominated by actual
creations (commentary/tutorial posts largely removed). With the AI key absent,
the workflow still runs (keyword + exclusion only) and never crashes.

## Key Technical Decisions

- **Exclusion filter lives in the classifier** (`classifier.ts`), as a new
  `COMMENTARY_KEYWORDS` list + an `isCommentary()` check folded into the qualify
  decision. Deterministic, no cost, conservative word list to avoid dropping
  genuine creations (e.g. don't exclude on "AI" or "video").
- **AI relevance check is a new service** mirroring the existing OpenRouter
  judge: `apps/mastra/src/services/offline-search-eval/judge.ts` is the pattern
  (attempt loop, `AbortSignal.timeout`, `retry-after`, `json_schema` structured
  output, typed error). One **batched** call per run (numbered captions in,
  per-index verdicts out) to keep cost/latency low for ≤50 posts.
- **Graceful opt-in**: input flag `aiRelevanceCheck` (default `true`). If the
  flag is on but no OpenRouter key is configured, skip the AI step and continue
  (do not fail the run). This mirrors the discovery workflow's "missing optional
  dependency degrades, not crashes" posture.
- **Ordering**: keyword qualify → exclusion filter → cap at `maxResults` →
  AI relevance check on the (already small) survivor set. Running the AI step
  last on the smallest set minimizes LLM calls/cost.
- **Reuse `OPENROUTER_API_KEY`** (already in env) plus a new optional
  `INSTAGRAM_DISCOVERY_RELEVANCE_MODEL` (default `anthropic/claude-haiku-4-5`,
  matching the existing eval judge default).

## Patterns To Follow

- OpenRouter chat-completions client w/ retry/timeout/typed error and
  `response_format: json_schema`: `apps/mastra/src/services/offline-search-eval/judge.ts`.
- Keyword lists + pure matcher: `apps/mastra/src/services/instagram-discovery/classifier.ts`.
- Workflow step wiring + discriminated-union output + injectable core
  (`runInstagramDiscovery`): `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.ts`.
- Env schema + getter + `emptyToUndefined`: `apps/mastra/src/config/env.ts`.

## Implementation Units

### U1. Commentary exclusion filter in the classifier

**Goal:** Drop otherwise-qualifying posts that read as commentary/news/tutorial.
**Requirements:** R1.
**Dependencies:** none.
**Files:** `apps/mastra/src/services/instagram-discovery/classifier.ts`, `apps/mastra/src/services/instagram-discovery/classifier.test.ts`.
**Approach:** Add `COMMENTARY_KEYWORDS` (conservative: `reaction`, `my thoughts`, `should we`, `is it ok`, `debate`, `controversy`, `going viral`, `went viral`, `trend`, `here's how`, `here's my`, `prompt to make`, `chatgpt conversation`, `explained`, `explains`, `news`, `breaking`, `blogger`, `tutorial`, `how i made`, `how to make`). Add `isCommentary(post)` returning matched terms. Export a combined decision: a post is kept only if `isAiGenerated && isChristian && !isCommentary`. Keep `classifyPost` returning the signals (now incl. `matchedCommentary`); add the commentary check to `qualifies()` or a new `qualifiesForDiscovery()`. Update `MatchSignals` type.
**Patterns to follow:** existing keyword matching (word-boundary helper) in the same file.
**Test scenarios:**

- "Here's my EXACT ChatGPT conversation to make these Veo 3 prompts" (AI+Christian words present) → excluded as commentary.
- "should we be listening to AI generated Christian music?" → excluded.
- "I recreated the story of Jesus' crucifixion using cinematic AI storytelling" → NOT excluded (genuine creation).
- A post with no commentary words → unaffected.
- Word-boundary guard so "trends" in a normal sentence doesn't over-trigger (decide: match `trend` as a whole word).

### U2. AI relevance judge service

**Goal:** LLM judges which captions are genuine AI-made Christian video creations.
**Requirements:** R2, R3.
**Dependencies:** U4 (env getter) — can be built in parallel; uses `OPENROUTER_API_KEY`.
**Files:** `apps/mastra/src/services/instagram-discovery/relevance-judge.ts`, `apps/mastra/src/services/instagram-discovery/relevance-judge.test.ts`.
**Approach:** Export `class RelevanceJudgeError` (codes `missing_credentials | transport | request_failed | validation`) and `judgeInstagramRelevance(items, options)` where `items: { index, caption }[]`. One batched OpenRouter chat call: system prompt = "Keep only posts that ARE an AI-generated Christian video/creation; reject commentary, news, reactions, tutorials, prompt walk-throughs, and posts merely discussing AI." `response_format: json_schema` → `{ verdicts: [{ index, relevant: boolean, reason: string }] }`. Validate every input index has a verdict; on validation failure, treat as "keep" (fail-open, since this is an additive precision filter, not a safety gate) and record the error. Injectable `apiKey`, `model`, `timeoutMs`, `fetchImpl`, `sleep`, `maxAttempts`. Throw `missing_credentials` when no key.
**Patterns to follow:** `offline-search-eval/judge.ts` near-verbatim (request loop, extractText, json parse, schema validate).
**Test scenarios (inject `fetchImpl`):**

- Happy path: batched response keeps the creations, drops the commentary; returns per-index verdicts.
- Missing apiKey → throws `missing_credentials` before fetch.
- 429 then success → retried. 5xx exhausted → `request_failed`. Malformed/ën­valid JSON → `validation`.
- Verdict array missing an index → fail-open (that item kept) + error surfaced.

### U3. Wire both filters into the workflow

**Goal:** Apply exclusion + AI relevance in `runInstagramDiscovery` and the Studio workflow steps.
**Requirements:** R2, R3, R4.
**Dependencies:** U1, U2.
**Files:** `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.ts`, `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.test.ts`, `apps/mastra/src/services/instagram-discovery/types.ts`, `apps/mastra/src/services/instagram-discovery/artifacts.ts`.
**Approach:**

- Input schema: add `aiRelevanceCheck: z.boolean().default(true)`.
- `selectQualifyingPosts`: apply the U1 commentary exclusion (kept = AI && Christian && !commentary). Add `excludedCommentary` count to totals.
- `runInstagramDiscovery`: after qualify+cap, if `aiRelevanceCheck` and an OpenRouter key is available (or injected `relevanceJudge`), run U2 over the survivors; keep `relevant`; annotate each kept post with `relevanceReason`. If no key → skip (log + proceed). Add `relevanceFiltered` count to totals.
- Inject `relevanceJudge?` via `InstagramDiscoveryOptions` for tests.
- Studio workflow: add an `ai-relevance-filter` step between `parse-and-filter-posts` and `report-and-persist` (or extend filter step) calling the same helper with real deps; graceful skip if no key.
- Extend `DiscoveryTotalsSchema` (excludedCommentary, relevanceFiltered) and `InstagramPostSchema` (optional `relevanceReason`), and `DiscoveryTotals` / `InstagramPost` types.
  **Patterns to follow:** existing step + `runInstagramDiscovery` composition; discriminated-union outputs; failure-prefix throw helper.
  **Test scenarios:**
- `runInstagramDiscovery` with injected `relevanceJudge`: commentary post excluded by U1, a "creation" kept, an AI-judged-irrelevant post dropped; totals reflect `excludedCommentary` and `relevanceFiltered`; kept posts carry `relevanceReason`.
- `aiRelevanceCheck: false` → AI step skipped entirely (judge not called).
- AI enabled but no key and no injected judge → skipped gracefully, run still `ok:true`.
- Schema round-trips with the new optional fields.

### U4. Env + config + docs

**Goal:** Optional model env var + getter; document the new behavior.
**Requirements:** R5.
**Dependencies:** none.
**Files:** `apps/mastra/src/config/env.ts`, `apps/mastra/src/config/env.test.ts`, `apps/mastra/.env.example`, `apps/mastra/CLAUDE.md`.
**Approach:** Add `INSTAGRAM_DISCOVERY_RELEVANCE_MODEL` (`z.string().min(1).default("anthropic/claude-haiku-4-5")`). Add `getInstagramRelevanceConfig()` → `{ apiKey: env.OPENROUTER_API_KEY, baseUrl: OpenRouter chat URL, model }`. Do not add to `assertMastraRuntimeEnv()`. Update `.env.example` + the CLAUDE.md "Instagram AI/Christian discovery" section (note exclusion filter, AI relevance check, opt-in flag, graceful skip).
**Patterns to follow:** existing optional getters (`getFirecrawlConfig`).
**Test scenarios:**

- `getInstagramRelevanceConfig()` returns the default model + the OpenRouter key when set.
- Production assert does not require the relevance vars (regression guard).

## System-Wide Impact

- Additive precision filter on an existing opt-in tool; no change to required env.
- New optional LLM dependency (OpenRouter), already present in the app for evals;
  graceful skip keeps default behavior when absent.
- Small per-run cost when enabled (one batched LLM call over ≤50 captions).
- No schema/codegen changes outside `apps/mastra`.

## Scope Boundaries

### In scope

- Exclusion keyword filter, AI relevance check, opt-in flag, report counts/reasons, env + docs.

### Deferred to Follow-Up Work

- Trusted-accounts follow-list (separate, larger effort; needs an Instagram data source).
- Cross-run memory / website approval queue (separate website-side work).
- Near-duplicate "same video re-uploaded" detection beyond exact-caption dedupe.

### Non-goals

- Watching/inspecting the actual video (only captions are judged).
- Auto-publishing.

## Verification

- `pnpm --filter @forge/mastra test` (new suites for classifier exclusion, relevance judge with injected fetch, workflow integration), `typecheck`, `lint` all clean.
- Local smoke: run `runInstagramDiscovery` with an injected judge over the real "3 good of 12" sample captions; confirm commentary/tutorial posts are removed and creations kept.
- Studio smoke (if key present): run the workflow, confirm the new `ai-relevance-filter` step appears and the kept set is cleaner; with the key unset, confirm it still completes (keyword + exclusion only).
