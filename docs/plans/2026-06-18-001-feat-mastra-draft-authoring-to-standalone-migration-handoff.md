# Migration Handoff: Move AI Experience Draft-Authoring Mastra Agents + Workflows from `apps/admin` into `apps/mastra`

**Start here.** This is a self-contained handoff for a fresh Claude Code session in the JesusFilm forge monorepo. It captures every verified fact, path, contract, and open decision needed to plan or execute the migration of the synchronous AI experience **draft-authoring** Mastra agents + workflows out of the in-process `apps/admin/src/mastra/` singleton and into the standalone `apps/mastra` (`@forge/mastra`) service — without re-investigating the codebase. Reference this file, then run `/ce-plan` to deepen the "Suggested Implementation Units" skeleton below, or `/ce-work` to start executing unit by unit. All paths are repo-relative and were verified by parallel readers against current source on branch `fix/budgets-test-chatturn-90s`. Before writing code, read `apps/admin/CLAUDE.md` and `apps/mastra/CLAUDE.md` (the latter's hard rule "do not import from apps/admin" is the central constraint).

---

## Goal & Why

Today the AI experience draft/chat agents run **in-process** inside the Next.js admin app via a lazy Mastra singleton (`apps/admin/src/mastra/index.ts`, `getMastra()`). The standalone `apps/mastra` Railway service already hosts the embedding, eval, smart-crop, firecrawl, and subtitle workflows behind authenticated `/forge-*` HTTP routes. Consolidating the LLM/agent runtime in `apps/mastra` removes the heavy AI-SDK + provider + Mastra dependency surface from the admin Next.js process, gives draft authoring its own deploy/scale/observability boundary, and matches the established direction of every other AI workflow.

The hard parts are: (1) the chat path **streams** tokens to the editor (no existing `/forge-*` route streams — all buffer); (2) the agent's three tools read admin Postgres **in-process** and must be re-homed to HTTP callbacks; (3) a new sync streaming contract must be designed alongside reusing the existing buffered one-shot contract. The just-shipped exemplar feature, validation/normalization, ABAC, persistence, and chat-message storage **stay in admin** — `apps/mastra` generates, admin owns storage and the editor surface.

---

## Scope — Move / Stay

| Item                                                             | Path                                                                                                 | Verdict                                 | Why                                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `experience-default-chat` agent                                  | `apps/admin/src/mastra/agents/default-chat-agent.ts`                                                 | **MOVE**                                | The streaming chat turn target; binds memory + full tool catalog.                                                                                                                                                        |
| 8 specialized agents                                             | `apps/admin/src/mastra/agents/specialized-agents.ts`                                                 | **MOVE**                                | `draft-experience` / `add-section` / `rewrite-copy` (editor-facing) + `experience-planner` / `experience-critic` / `experience-reviser` / `experience-skeleton` / `experience-fill` (workflow-only, memory-less by R12). |
| `multi-step-draft` + `quick-draft` workflows                     | `apps/admin/src/mastra/workflows/multi-step-draft-workflow.ts`                                       | **MOVE**                                | plan→skeleton→fill→critique→revise. Heaviest `@/services/experience-ai` coupling.                                                                                                                                        |
| Draft/chat prompts                                               | `apps/admin/src/mastra/prompts/` (all except `auto-enrich-prompt.ts`)                                | **MOVE**                                | Pure import-free string constants — cleanest to move. `PromptId` union travels.                                                                                                                                          |
| 3 agent tools                                                    | `apps/admin/src/mastra/tools/{search-videos,lookup-bible-verse,fetch-video-image,index}.ts`          | **MOVE but REWRITE**                    | Agents need them, but all 3 import admin `prisma`; must become HTTP callbacks into admin. Net-new, not a copy.                                                                                                           |
| `budgets.ts`                                                     | `apps/admin/src/mastra/budgets.ts`                                                                   | **SHARED-DUP**                          | Pure constants. Move with workflow; admin keeps its own copy for the outbound-timeout caller (which must stay strictly larger than mastra's internal budget).                                                            |
| Chat-model providers                                             | `apps/admin/src/mastra/providers.ts`                                                                 | **MOVE (chat parts)**                   | AI-SDK LanguageModel factories. `apps/mastra` has NO chat-model registry today (only raw-fetch `embedding-provider.ts`).                                                                                                 |
| `gateway-constants.ts`                                           | `apps/admin/src/mastra/gateway-constants.ts`                                                         | **SHARED-DUP**                          | Import-free chat base-URL + UA literals; trivially duplicated.                                                                                                                                                           |
| Mastra `Memory` primitive                                        | `apps/admin/src/mastra/memory.ts`                                                                    | **MOVE CONCEPT, NOT FILE**              | `apps/mastra` has ZERO `@mastra/memory` usage today. Chat memory must be built fresh there.                                                                                                                              |
| `experience-ai.schemas` / `extract-json-object` / `coerce-draft` | `apps/admin/src/services/experience-ai/*`                                                            | **EXTRACT or DUP (decision)**           | Workflow can't validate without `DraftExperienceSchema`/`SkeletonSchema`/`getFillSchemaForType`/`validateSkeleton`. Either shared package or local Zod dup in `apps/mastra`.                                             |
| `auto-enrich-agent`                                              | `apps/admin/src/mastra/agents/auto-enrich-agent.ts`                                                  | **STAY**                                | Background, integration-deferred, no production consumer. Out of scope.                                                                                                                                                  |
| `chat-thumb-rating` scorer                                       | `apps/admin/src/mastra/scorers/chat-thumb-rating.ts`                                                 | **STAY**                                | Human 👍/👎 bucket (no LLM). Depends on admin's Mastra `scores` storage; written/read by admin rating routes.                                                                                                            |
| `chat-stream-event.ts` (wire contract)                           | `apps/admin/src/mastra/chat-stream-event.ts`                                                         | **STAY (admin-owned)**                  | The editor SSE wire contract. Panel/route stay in admin.                                                                                                                                                                 |
| `streaming-bridge.ts`                                            | `apps/admin/src/mastra/streaming-bridge.ts`                                                          | **SHARED-DUP / seam**                   | Becomes the admin↔mastra stream-translation seam.                                                                                                                                                                        |
| Exemplar selection + outline                                     | `apps/admin/src/services/experience-ai/experience-ai-exemplar*.ts`                                   | **STAY**                                | Needs admin pgvector. Result crosses the wire as an optional `exemplar` string.                                                                                                                                          |
| Video candidate loading                                          | `apps/admin/src/services/experience-ai/experience-ai.service.ts` (`loadExperienceAiVideoCandidates`) | **STAY**                                | Needs admin Prisma + hybrid search. Result crosses the wire as `candidates[]`.                                                                                                                                           |
| Draft validate/normalize                                         | `apps/admin/src/services/experience-ai/{experience-ai.schemas,experience-ai-normalize}.ts`           | **STAY**                                | Defense-in-depth re-validation after the wire; needs admin candidate set + `BlocksSchema`. Last gate before persist.                                                                                                     |
| Chat history + persistence + ABAC                                | `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts`                                | **STAY**                                | `experienceChatMessage` reads/writes, `canEditExperienceLocale`, `ExperienceService.applyChatMutation`.                                                                                                                  |
| Admin Mastra registry                                            | `apps/admin/src/mastra/index.ts`                                                                     | **STAY (sheds 9 agents + 2 workflows)** | Keeps `auto-enrich` + scorer + storage.                                                                                                                                                                                  |
| Target registry                                                  | `apps/mastra/src/mastra/index.ts`                                                                    | **EXTEND**                              | Add 9 agents, 2 workflows, chat Memory, chat providers, 3 HTTP tools, new `/forge-*` routes.                                                                                                                             |

---

## Current State

### Two in-process entry points, both feeding the editor

**1. Streaming chat turn** (the "Send" button):

- Route `apps/admin/src/app/api/experience-chat/stream/route.ts` (`POST /api/experience-chat/stream`).
- Service `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts` — `streamChatTurn` (async generator) + `runMastraChat`.

**2. One-shot "Generate full page" / "Quick draft"** (no token streaming):

- Server action `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts` — `runGenerateDraftAction`.

Both reach Mastra via `getMastra()` → `buildMastraInstance()` in `apps/admin/src/mastra/index.ts`.

### How a token reaches the browser today (the streaming path — it is _simulated_ streaming)

1. Browser client `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-stream-client.ts` (`openChatStream`) does `fetch('POST /api/experience-chat/stream')`, reads the SSE body, splits on `\n\n` frames into typed `ChatStreamEvent`s (known types: `token_delta | mutation_applied | error | done`).
2. The route authenticates (rate-limit → `resolvePrincipalFromRequest` → `hasPermission(principal, "write:experiences")`), parses `{ threadId, prompt, confirmedAcrossLocales?, confirmedBrief? }`, wraps `streamChatTurn(...)` in a `ReadableStream`. `encodeSseFrame` serializes each event as `event: <type>\n` + `data: <JSON minus type>\n\n`. `request.signal` threads in as `abortSignal`.
3. `streamChatTurn` resolves thread + locale via Prisma, runs ABAC (`canEditExperienceLocale`), persists the USER message, loads chat history (`prisma.experienceChatMessage.findMany({ where:{threadId}, take:200 })`) + video candidates (`loadExperienceAiVideoCandidates`, `CANDIDATE_LIMIT = 8`), builds the prompt (`buildChatPrompt`).
4. **Key fact:** it calls `runMastraChat` → `getMastra().getAgentById("experience-default-chat").generate(prompt, { abortSignal, maxSteps: STEP_CAPS.toolCallingTurn })`. This is `generate()`, **NOT `stream()`** — the full reply is produced synchronously, then handed to `onToken(buffer)` **once** as a single chunk, yielded as one `token_delta`. There is no per-token streaming. The inline comment confirms `generate()` is used because Mastra's `textStream` can be empty during structured-output/tool-call cycles; true token streaming needs the U3 UIMessageStream bridge.
5. `runMastraChat` extracts/parses JSON (`extractJsonObject`, `jsonrepair` fallback), translates the Mastra `{ diff }` envelope → legacy `{ mutations }` (`translateMastraEnvelopeToLegacy`, `normalizeBlockFieldAliases`, `coerceScalarDiffInPlace`), returns `{ kind:"envelope", raw }`.
6. Back in `streamChatTurn`: Zod-validate (`ChatMutationEnvelopeSchema`), cross-locale guard, then **apply in-process** via `new ExperienceService(prisma).applyChatMutation(...)` (ABAC + ContentRevision + optimistic-concurrency guard). Compute diff (`computeDiff`), persist ASSISTANT `experienceChatMessage` (`producedBy:"experience-default-chat"`), yield `mutation_applied` then `done`.

So today the LLM call, tool calls, envelope parsing, AND the DB mutation all happen inside the admin process.

### Budgets and the abort-resolves-empty quirk

`runMastraChat` composes `budgetSignal = AbortSignal.timeout(TIME_BUDGET_MS.chatTurn)` (= **90_000**, in `apps/admin/src/mastra/budgets.ts`) with the caller's `abortSignal` via `AbortSignal.any([...])`. The AI SDK **resolves** an aborted `generate()` with empty text rather than rejecting, so there is an explicit post-`generate()` guard: `if(budgetSignal.aborted)` → `{kind:"error",code:"timeout"}`; `if(abortSignal?.aborted)` → `code:"cancelled"` — checked before empty-buffer handling so an aborted turn isn't misreported as DRAFT REJECTED. (This is exactly the `b2f00f2e`/`b42a0dce`/`b3f9a1d8` fixes on this branch.) `STEP_CAPS.toolCallingTurn = 8` bounds tool recursion. 90s stays under the Cloudflare ~100s 524 ceiling (gateway Qwen from-scratch draft runs ~37–45s).

### The one-shot workflow path

`runGenerateDraftAction` calls `getMastra()` twice: `getWorkflowById("quick-draft" | "multi-step-draft").createRun().start({ inputData:{ prompt, locale, candidates, exemplar } })` wrapped in `withTimeout(..., ACTION_BUDGET_MS = TIME_BUDGET_MS.multiStepWorkflow = 180_000)`; and again inside `normalizeWithRepair` → `repairDraft({ mastra:getMastra(), ... })` (`apps/admin/src/services/experience-ai/repair-draft.ts`, `REPAIR_AGENT_ID`). The workflow chains plan→skeleton→fill→critique→revise, each step calling `mastra.getAgentById(...).generate(...)` via the **injected** `mastra` (not the module import, avoids cycle). On `ActionTimeoutError` it best-effort `activeRun.cancel()`s. The workflow uses `toolChoice:"none"` (the gateway's LiteLLM 500s on tool round-trips), so **only the chat path needs the re-homed tools**.

### Dormant streaming bridge + divergent event types

`apps/admin/src/mastra/streaming-bridge.ts` (`adaptMastraStream`) maps `MastraStreamPart` → `ChatStreamEvent` but has **zero non-test consumers**. There are **two divergent `ChatStreamEvent` declarations**: the richer one in `chat-stream-event.ts` (`mutation_proposal`, `tool_call_*`, different `ChatErrorCode`) and the one actually wired in `experience-ai-chat.service.ts` (line ~54: `token_delta | mutation_applied | error | done`). Consolidation is pending.

---

## Hard Problems

### 1. Streaming proxy (the single largest structural delta)

Every existing `/forge-*` route on `apps/mastra` returns one buffered `new Response(JSON.stringify(...))`; both admin clients (`launchMastraExperienceEmbedding`, `callAdminEmbeddingIngest`) `await response.json()` **once**. The chat path must instead:

- `admin → mastra`: a `/forge-*` route returning a `ReadableStream`/SSE body (chunked). **Unproven** in this codebase — must validate that a `registerApiRoute` handler can stream through the `@mastra/core/server` Hono layer, and what streaming primitive the Mastra agent exposes (`.stream()`/`textStream` vs the UIMessageStream bridge).
- `mastra → admin`: admin reads the response body as a stream (`response.body.getReader()` / async iteration), not `response.json()`.
- `admin → browser`: admin re-emits over its existing editor SSE channel — admin becomes a stream **proxy**.
- `AbortSignal.timeout(...)` is wrong for a long-lived stream (it would kill it at the deadline). Need idle/heartbeat-based abort + browser-disconnect propagation through both legs so a closed tab cancels the upstream agent run. Per the outbound-timeout-shorter-than-caller-budget learning, a remote timeout must classify as `timeout`, not a generic network error, or retries storm.

### 2. Tool re-homing / DB binding

The `experience-default-chat` agent's three tools each `import { prisma } from "@/db/client"` and query admin's DB inside the tool-call loop. `apps/mastra/CLAUDE.md` forbids importing admin or touching admin Postgres. So tool **bodies cannot move** — only Zod surfaces + prompt semantics carry over; data access becomes an authenticated HTTP callback into admin (mastra → admin direction, exactly like the embedding-ingest clients). Each tool call becomes a network round-trip inside the agent loop — added latency must fit the 90s `chatTurn` budget. See "Tool Re-homing" below for per-tool detail.

### 3. New sync contract vs existing batch contract

The embedding contract is **two-leg, batch**: admin POSTs a trigger (single buffered JSON, ~120s `AbortSignal.timeout`), mastra optionally POSTs a result back to an admin ingest route. This template covers the **one-shot draft** path cleanly (new buffered `/forge-experience-draft` + admin client mirroring `launchMastraExperienceEmbedding`, no vector-ingest callback). It does **NOT** cover the **streaming chat** path (problem 1). Decisions: which side emits the canonical envelope shape (`{ diff }` vs `{ mutations }`); where the `normalizeWithRepair` → `repairDraft` loop lives (re-trigger remote with errors, or stay admin-side); whether the streamed draft needs any mastra → admin persistence callback (likely NO — admin persists from the streamed result).

---

## Target Architecture

**`apps/mastra` (generator):**

- Registers the 9 draft/chat agents + 2 workflows in `apps/mastra/src/mastra/index.ts`.
- Gains a chat **Memory** primitive (`@mastra/memory` + PostgresStore/PgVector — new), chat-model **provider** construction (new AI-SDK deps + chat gateway env), and the 3 tools re-implemented as HTTP callbacks into admin.
- Exposes new `registerApiRoute("/forge-*")` service routes gated by `isValidServiceBearer` (existing `apps/mastra/src/server/service-bearer.ts`, allowlist `MASTRA_SERVICE_API_KEYS`):
  - **Streaming chat trigger** — returns a `ReadableStream`/SSE body (net-new shape).
  - **One-shot draft trigger** (e.g. `/forge-experience-draft`) — buffered JSON, mirrors `/forge-experience-embeddings`.

**`apps/admin` (thin proxy + exemplar + validation + persistence):**

- Editor SSE route + browser client stay; the route's `streamChatTurn` is rewired to open an HTTP stream to mastra and **relay** frames to the browser.
- Pre-computes and ships in the trigger body: `prompt`, `locale`, `candidates[]`, `exemplar?` string, and for chat `history` + editable locale `state`.
- After receiving the draft: re-validates (`DraftExperienceSchema` → `normalizeExperienceDraft`/`BlocksSchema`), then persists via `ExperienceService.applyChatMutation` + ContentRevision + ABAC + `experienceChatMessage`.
- Keeps `auto-enrich`, the `chat-thumb-rating` scorer, and Mastra storage registered locally; drops the 9 agents + 2 workflows from its registry.
- Adds new internal endpoints under `apps/admin/src/app/api/internal/agent-tools/*` for the 3 re-homed tools.

---

## Contract & Auth

**Mirror the existing two-leg embedding contract (the template):**

- Leg 1 (admin → mastra trigger): admin holds single `MASTRA_BASE_URL` + single `MASTRA_SERVICE_API_KEY`; POSTs to `new URL("/forge-*", baseUrl)` with `authorization: Bearer ${key}`. Mastra validates against the CSV `MASTRA_SERVICE_API_KEYS` via `isValidServiceBearer` (constant-time `timingSafeEqual`; 401 on miss).
- Leg 2 (mastra → admin ingest callback): mastra presents `ADMIN_MASTRA_*_INGEST_API_KEY` validated against admin's per-type CSV `MASTRA_*_INGEST_API_KEYS` (`apps/admin/src/auth/mastra-ingest-bearer.ts`).

**The two new triggers:**

1. **One-shot draft trigger** — new buffered `/forge-experience-draft` (or similar) on mastra running `multi-step-draft`/`quick-draft`, returning one discriminated JSON envelope `{ ok:true; draft } | { ok:false; reason; retryable }`. New admin client mirrors `launchMastraExperienceEmbedding` (single POST, single `response.json()`). **No vector-ingest callback** — Leg 2 not reused.
2. **Streaming chat trigger** — new `/forge-*` route returning a `ReadableStream`/SSE body. Admin reads it as a stream and relays to the editor. Idle/heartbeat abort, not deadline timeout. **No mastra → admin persistence callback** — the draft is delivered down the stream and persisted admin-side.

**Bearer/keys decision (the team's instinct is per-capability separation):**

- Both triggers are admin → mastra, so the simplest mirror reuses `MASTRA_BASE_URL` + `MASTRA_SERVICE_API_KEY` against `MASTRA_SERVICE_API_KEYS`. Treating draft authoring as a distinct capability would add a dedicated admin var + mastra CSV entry (embedding-key precedent).
- The draft/chat path needs **no new mastra → admin ingest bearer** (no vector write).
- The 3 re-homed tools DO introduce a new mastra → admin direction: per the `mastra-ingest-bearer.ts` "do not reuse `WORKFLOW_API_KEYS` / ingest keys — different capability" convention, add a dedicated read-only agent-tools bearer CSV (e.g. `ADMIN_AGENT_TOOLS_API_KEYS`) validated with `timingSafeEqual`.
- **Boot invariant:** admin enforces `assertBearerCsvsDisjoint` (`apps/admin/src/config/env.ts:~595-690`) over `BEARER_CSV_KEYS` (+ `BearerCsvSnapshot` type via `satisfies`). Any new **receiver-side CSV** on admin (the agent-tools key) MUST be added there or admin fails to boot. Caller-side single keys (like `MASTRA_SERVICE_API_KEY`) stay out of the invariant.

---

## Tool Re-homing

All three live in `apps/admin/src/mastra/tools/` (re-exported from `index.ts`), wired into agents in `default-chat-agent.ts` (lines 173–177) + `specialized-agents.ts`. Each `import { prisma } from "@/db/client"`. Re-home each as a thin transport wrapper calling a new bearer-gated admin endpoint; **keep filters server-side** so business rules stay single-sourced. Model the mastra-side HTTP client on `apps/mastra/src/services/admin-embedding-ingest-client.ts` (discriminated `{ok}|{ok:false,reason,retryable}` envelope, `AbortSignal`, host validation). Closest existing admin analog: `apps/admin/src/app/api/internal/search-eval/search/route.ts` (bearer-gated, rate-limited, runs `HybridSearchService.search`).

**1. `searchVideosTool`** (`tools/search-videos.ts`) — binds `new HybridSearchService({ prisma })`, `service.search({ query, locale, limit, contentTypes:["video"] })`.

- Endpoint: `POST /api/internal/agent-tools/search-videos`.
- Req `{ q:string; locale:string; limit?:number(max 20,default 8) }` → Res `{ videos: Array<{ videoId; title; snippet; slug; imageUrl|null }> }`.
- **Load-bearing filters (keep server-side):** `contentTypes:["video"]`; **playability** `playbackId !== null` (unplayable videos must never reach the agent — it writes `videoId` verbatim into blocks); field-trim (drop score/startSeconds/label/durationSeconds/childCount/playbackId). `videoId = result.id`.
- ABAC: currently a `void` no-op (public-shape video read); new endpoint is a service-bearer read with no per-editor principal — matches current behavior.

**2. `lookupBibleVerseTool`** (`tools/lookup-bible-verse.ts`) — `prisma.bibleBook.findMany`. `BibleBook` model at `apps/admin/prisma/schema.prisma:1065`.

- Endpoint: `POST /api/internal/agent-tools/lookup-bible-verse`.
- Req `{ query:string; locale?:string(default "en"); limit?:number(max 10,default 3) }` → Res `{ books: Array<{ bookId; osisId|null; displayName; testament|null; order|null }> }`.
- Semantics: `where { deletedAt:null, OR:[osisId equals insensitive, paratextAbbreviation equals insensitive, alternateName contains insensitive] }`, `orderBy {order:asc}`, `take:limit`. Resolve `displayName` from the `name` JSON map **server-side** via the locale-fallback (`locale` → BCP-47 base `fr-CA`→`fr` → `en` → raw query) so mastra never sees the raw map. No ABAC (public reference data).

**3. `fetchVideoImageTool`** (`tools/fetch-video-image.ts`) — `prisma.videoImage.findMany({ where:{videoId,deletedAt:null}, orderBy:{createdAt:"asc"} })`. `VideoImage` model at `apps/admin/prisma/schema.prisma:1369`.

- Endpoint: `POST /api/internal/agent-tools/fetch-video-image`.
- Req `{ videoId:string }` → Res `{ imageUrl:string|null; variant:string|null }`.
- Semantics: `VARIANT_PRIORITY = ["mobileCinematicHigh","videoStill","thumbnail","url"]` — first non-empty value across rows (createdAt asc), resolved **server-side**. No locale, no ABAC.

(Use POST + JSON body for all three — matches the existing internal-route convention even for reads.)

---

## Env Vars

**Config-style gotcha:** admin (`apps/admin/src/config/env.ts`) uses `@t3-oss/env-nextjs` `createEnv` — adding a var = TWO edits (`server` schema + `runtimeEnv` mapping); `skipValidation: !!process.env.CI`. mastra (`apps/mastra/src/config/env.ts`) uses a plain `z.object().parse({...})` — adding a var = TWO edits (schema + parse-args); NO CI skip (validates at module load); production-only requirements live in `assertMastraRuntimeEnv()`.

**Institutional rule — every NEW var MUST be `.optional()`** (or `.optional().default(...)`). A required-without-default var bricks Railway deploys for unprovisioned environments even when the default code path never invokes it (`docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`). For mastra, a var production truly requires belongs in `assertMastraRuntimeEnv()`'s `missing` list, NOT as a top-level required schema entry.

**Chat-provider vars — move admin → mastra** (read today in `apps/admin/src/mastra/providers.ts`):

- `AI_GATEWAY_CHAT_ENABLED`, `AI_GATEWAY_CHAT_API_KEY` (`coding`-scoped — distinct from the embeddings key; do NOT collapse), `AI_GATEWAY_CHAT_MODEL` (default `"coding"`), `AI_GATEWAY_CHAT_BASE_URL`, `GOOGLE_GENERATIVE_AI_API_KEY` (default free-text draft provider), `MASTRA_DEFAULT_PROVIDER` (enum), `OLLAMA_BASE_URL` (chat — new on mastra side; admin keeps its separate `OLLAMA_EMBEDDING_*`), `AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED` (per-phase decoding flag — moves with workflow).
- New mastra AI-SDK deps likely required: `@ai-sdk/google`, `@ai-sdk/openai`, `ollama-ai-provider-v2`. Watch for the Mastra-CLI Rollup "Cannot determine intended module format" `createRequire` workaround that the in-process agents use.

**Stays on admin (do NOT delete):**

- `OPENROUTER_API_KEY` — admin still uses it for the search-trace query classifier + OpenRouter image-text (mastra also already has it).
- `MASTRA_*_EMBEDDING_TIMEOUT_MS` (transcript/scene/experience, default 120_000) — embedding path only; the precedent the draft path copies.
- `MASTRA_GATEWAY_BASE_URL` / `MASTRA_GATEWAY_ADMIN_API_KEY` — `mastra-studio-access.service.ts` (Studio auth), NOT the chat gateway; do not confuse with `AI_GATEWAY_CHAT_BASE_URL`.
- `WORKFLOW_API_KEYS` — cross-service trigger backbone, unchanged.

**Decision-dependent (where does the repair / exemplar logic land?):**

- `EXPERIENCE_AI_MAX_REPAIR_ATTEMPTS` (admin, `.optional().default(2)`, consumed by `runGenerateDraftAction`) — stays admin if repair stays admin-side; moves if repair moves into the workflow.
- `EXPERIENCE_EXEMPLAR_MAX_DISTANCE` / `EXPERIENCE_EXEMPLAR_FALLBACK_SLUG` — selection queries admin pgvector, so likely stay admin and admin passes the exemplar string over the wire.

**New vars (recommended, all `.optional()`):**

- `MASTRA_DRAFT_BASE_URL` (or reuse `MASTRA_BASE_URL`), `MASTRA_DRAFT_API_KEY` (or reuse `MASTRA_SERVICE_API_KEY`), `MASTRA_DRAFT_TIMEOUT_MS` (long-running streaming, ~90s; in the `MASTRA_*_TIMEOUT_MS` family — but for the stream leg use idle/heartbeat abort, not a hard deadline).
- mastra side: the relocated `AI_GATEWAY_CHAT_*` block + `MASTRA_DEFAULT_PROVIDER` + chat `OLLAMA_BASE_URL` + `AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED`.
- admin side (receiver): `ADMIN_AGENT_TOOLS_API_KEYS` CSV (register in `assertBearerCsvsDisjoint`); mastra side: `ADMIN_AGENT_TOOLS_URL` + `ADMIN_AGENT_TOOLS_API_KEY` (or per-tool pairs).

---

## Rollout / Dual-Path

1. **Land the receiver first.** Per the cross-app trigger ordering law (`docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`), deploy mastra's new `/forge-*` draft/chat routes + admin's new agent-tools endpoints (the keyring entries) BEFORE the caller env vars, or the first call 401s.
2. **Feature-flag both paths.** Gate the admin caller behind a flag (e.g. `EXPERIENCE_AI_REMOTE_MASTRA=true`) so `streamChatTurn` / `runGenerateDraftAction` pick remote-HTTP vs in-process `getMastra()` at runtime. Keep the in-process path as fallback during cutover. Flag the one-shot path and the streaming path independently — the one-shot (buffered) is lower-risk and can cut over first.
3. **Cutover order:** one-shot draft → chat streaming (streaming is the riskier, unproven leg).
4. **Cleanup (after stable):** drop the 9 agents + 2 workflows + chat tools + chat providers + chat memory from `apps/admin/src/mastra/`, remove the relocated chat env vars from admin's schema (keep `OPENROUTER_API_KEY` + embedding timeouts + Studio vars), reconcile the two `ChatStreamEvent` declarations into one admin-owned contract, and delete the dormant `streaming-bridge.ts` if its logic moved to the mastra side. Admin's registry keeps `auto-enrich` + scorer + storage.

---

## Suggested Implementation Units

Ordered, dependency-aware. `/ce-plan` should deepen each.

1. **Shared schema/coercion ownership** — decide and execute: extract `experience-ai.schemas` + `extract-json-object` + `coerce-draft` (+ `@/domain/blocks` `BlocksSchema`) into a shared package, OR duplicate as local Zod in `apps/mastra`. _Blocks everything else; the workflow can't validate without it._ Key files: `apps/admin/src/services/experience-ai/experience-ai.schemas.ts`, `extract-json-object.ts`, `coerce-draft.ts`.
2. **Chat-model providers in mastra** — port `providers.ts` chat factories; add AI-SDK deps + `AI_GATEWAY_CHAT_*` env. _Goal: mastra can construct chat LanguageModels._ Files: `apps/admin/src/mastra/providers.ts`, `apps/mastra/src/config/env.ts`, `apps/mastra/src/mastra/index.ts`.
3. **Chat Memory primitive in mastra** — add `@mastra/memory` + PostgresStore/PgVector + storage-URL decision (shared `mastra` schema vs service-owned DB). Files: `apps/admin/src/mastra/memory.ts` (reference), `apps/mastra/src/mastra/index.ts`.
4. **Move prompts + budgets** (low-risk, pure constants). Files: `apps/admin/src/mastra/prompts/*`, `budgets.ts`, `gateway-constants.ts`.
5. **Re-home the 3 tools** — new admin internal endpoints + mastra HTTP client + new bearer. _Depends on 2 (agents reference tools)._ Files: `apps/admin/src/mastra/tools/*`, new `apps/admin/src/app/api/internal/agent-tools/*`, new `apps/mastra/src/services/admin-agent-tools-client.ts`.
6. **Register agents + workflows in mastra** — port `default-chat-agent.ts`, `specialized-agents.ts`, `multi-step-draft-workflow.ts`. _Depends on 1–5._ File: `apps/mastra/src/mastra/index.ts`.
7. **One-shot draft trigger (buffered)** — new `/forge-experience-draft` route + admin client mirroring `launchMastraExperienceEmbedding`; rewire `runGenerateDraftAction` behind the flag. Keep `normalizeWithRepair` admin-side initially. Files: `apps/mastra/src/mastra/index.ts`, new `apps/admin/src/services/mastra-experience-draft-client.ts`, `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts`.
8. **Streaming chat trigger (the hard one)** — prototype a streaming `/forge-*` route through Hono first (validate feasibility). Admin reads the stream + relays to the editor SSE; idle/heartbeat abort + disconnect propagation. Rewire `runMastraChat`/`streamChatTurn` behind the flag. Files: `apps/mastra/src/mastra/index.ts`, `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts`, `apps/admin/src/app/api/experience-chat/stream/route.ts`, `streaming-bridge.ts`.
9. **Feature-flag wiring + dual-path** — runtime selection, both paths green.
10. **Cutover + cleanup** — shed admin in-process agents/workflows/providers/memory/tools; reconcile `ChatStreamEvent`; trim admin env.

---

## Entry-Point Files

**Admin — request paths (callers to rewire):**

- `apps/admin/src/app/api/experience-chat/stream/route.ts` — SSE route; wraps `streamChatTurn` in a `ReadableStream`.
- `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts` — `streamChatTurn` + `runMastraChat`; the canonical wired `ChatStreamEvent` union (line ~54); chat history reads + persistence + ABAC.
- `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts` — `runGenerateDraftAction` one-shot; exemplar+candidate prep; `normalizeWithRepair`.
- `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-stream-client.ts` — browser SSE consumer (`openChatStream`).

**Admin — Mastra dir (move/stay):**

- `apps/admin/src/mastra/index.ts` (registry, shed boundary), `agents/default-chat-agent.ts`, `agents/specialized-agents.ts`, `agents/auto-enrich-agent.ts` (STAY), `workflows/multi-step-draft-workflow.ts`, `tools/{search-videos,lookup-bible-verse,fetch-video-image,index}.ts`, `prompts/*`, `memory.ts`, `budgets.ts`, `providers.ts`, `gateway-constants.ts`, `streaming-bridge.ts`, `chat-stream-event.ts` (STAY), `scorers/chat-thumb-rating.ts` (STAY).

**Admin — services that STAY (cross the wire as data):**

- `experience-ai/experience-ai-exemplar.service.ts`, `experience-ai-exemplar-query.ts`, `experience-ai-exemplar-outline.ts`, `experience-ai.service.ts` (`loadExperienceAiVideoCandidates`), `experience-ai.schemas.ts` (`DraftExperienceSchema`, `GENERATION_MIN_BLOCKS=2`, `VideoCandidate`), `experience-ai-normalize.ts` (`normalizeExperienceDraft`, typed codes), `repair-draft.ts`, `hybrid-search.service.ts`.

**Admin — auth/env/contract:**

- `apps/admin/src/config/env.ts` (env + `assertBearerCsvsDisjoint`), `apps/admin/src/auth/mastra-ingest-bearer.ts`, `apps/admin/src/services/mastra-experience-embedding-client.ts` (Leg-1 caller template), `apps/admin/src/app/api/internal/mastra/experience-embeddings/route.ts` (Leg-2 receiver template), `apps/admin/src/app/api/internal/search-eval/search/route.ts` (closest agent-tool analog), `apps/admin/prisma/schema.prisma` (`BibleBook:1065`, `VideoImage:1369`).

**Mastra — target + templates:**

- `apps/mastra/src/mastra/index.ts` (registry + `/forge-*` routes; ~lines 176–265 show smoke + embedding triggers), `apps/mastra/src/config/env.ts`, `apps/mastra/src/server/service-bearer.ts`, `apps/mastra/src/services/embedding-provider.ts` (NOT chat models), `apps/mastra/src/services/admin-embedding-ingest-client.ts` (HTTP client template), `apps/mastra/src/services/admin-experience-ingest-client.ts`, `apps/mastra/src/client/service-client.ts` (trigger-client reference), `apps/mastra/src/mastra/workflows/experience-embedding.ts` (`handle*RouteRequest` shape).

---

## Grep Patterns

- `getMastra()` — find all in-process consumers to classify (draft/chat vs rating vs CLI).
- `getAgentById\(|getWorkflowById\(` — agent/workflow invocation sites.
- `adaptMastraStream` — confirms the dormant bridge has zero non-test consumers.
- `ChatStreamEvent` — the two divergent declarations.
- `registerApiRoute\("/forge-` — every mastra service route (all buffered today).
- `isValidServiceBearer|MASTRA_SERVICE_API_KEYS|parseServiceApiKeys` — receiver auth.
- `from "@/db/client"` (under `apps/admin/src/mastra/`) — the in-process Prisma coupling in tools.
- `MASTRA_BASE_URL|MASTRA_SERVICE_API_KEY|ADMIN_.*_INGEST` — cross-service trigger/callback config.
- `assertBearerCsvsDisjoint|BEARER_CSV_KEYS|BearerCsvSnapshot` — admin boot invariant.
- `AI_GATEWAY_CHAT_|MASTRA_DEFAULT_PROVIDER|OLLAMA_BASE_URL` — chat-provider env to relocate.
- `selectExperienceExemplar|loadExperienceAiVideoCandidates|normalizeExperienceDraft` — admin-side stays.
- `TIME_BUDGET_MS|STEP_CAPS|chatTurn` — budgets.

---

## Verification

- **Unit 1 (schemas):** `pnpm --filter @forge/mastra typecheck` resolves `DraftExperienceSchema`/`SkeletonSchema`/`getFillSchemaForType`/`validateSkeleton` without importing `apps/admin`; a draft-shape fixture validates identically on both sides.
- **Units 2–3 (providers/memory):** mastra boots with the new chat env present and `assertMastraRuntimeEnv()` passes in a production-like env; a smoke that calls `experience-default-chat.generate(...)` in mastra returns text.
- **Unit 5 (tools):** unit tests for each new admin endpoint asserting the **server-side filters fire** (playability `playbackId!==null`, bible locale-fallback, `VARIANT_PRIORITY`) — per the mocked-shape-vs-real-contract discipline, include a real-DB smoke since mocked tests prove branch shape, not the Prisma function/contract. Curl each endpoint with a valid + invalid bearer (401 on miss).
- **Unit 7 (one-shot):** repoint/relocate the existing smoke harness `apps/admin/src/scripts/smoke-mastra-draft-workflow.ts` (currently exercises in-process `multi-step-draft`) at the standalone mastra `/forge-experience-draft` route; assert a valid draft passes `normalizeExperienceDraft` admin-side. The constrained-decoding trust gate (`smoke:draft-workflow`) must run against the remote service for the flag flip to mean anything.
- **Unit 8 (streaming):** relocate/repoint `apps/admin/src/scripts/smoke-mastra-chat.ts`; assert tokens stream end-to-end (mastra → admin → browser), a closed editor tab cancels the upstream run, and a remote timeout classifies as `timeout` (not network error / retry storm). Verify the 90s `chatTurn` budget holds with the added per-tool HTTP round-trips in a multi-tool draft loop.
- **Tier-2 review mandatory before push:** this crosses sensitive surfaces (auth, new public-ish API routes, cross-service contracts) and will exceed the LOC/dirs thresholds — run `/ce-code-review` (`docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md`).

---

## Open Questions / Decisions Needed

1. **Streaming feasibility (highest risk):** can a `registerApiRoute` handler stream a `ReadableStream`/SSE body through the `@mastra/core/server` Hono layer? What primitive does the Mastra agent expose (`.stream()`/`textStream` vs the U3 UIMessageStream bridge)? Prototype before committing to the design — all existing `/forge-*` routes buffer.
2. **Schema ownership:** shared package vs local Zod dup in mastra for `experience-ai.schemas` + coercion + `BlocksSchema`?
3. **Tool data access:** HTTP callback per tool-call (mid-stream network round-trips) vs pre-resolve everything into the trigger body? (Workflow uses `toolChoice:none`, so only chat needs this.) Server-side vs client-side for the load-bearing filters (recommendation: server-side).
4. **Repair loop placement:** does `normalizeWithRepair` → `repairDraft` re-trigger the remote service with the offending draft + errors over HTTP, or stay an admin concern calling the remote per attempt? Preserve the per-call-timeout-under-deadline budgeting (`REPAIR_CALL_TIMEOUT_MS` vs `actionDeadline`).
5. **Canonical envelope side:** which side emits `{ diff }` vs `{ mutations }` after the move?
6. **Bearer separation:** reuse `MASTRA_SERVICE_API_KEY` for draft authoring, or a dedicated capability key? (Team instinct: per-capability.) Dedicated agent-tools CSV — one shared key or per-tool?
7. **Chat memory storage location:** shared Mastra `mastra` Postgres schema (as admin's `memory.ts` defaults to `DATABASE_URL`) vs a mastra-service-owned DB? Who provisions semantic-recall vector space (gateway embeddings)?
8. **Exemplar ownership confirm:** admin selects + passes the string (recommended) vs mastra fetches via a new admin read endpoint (would relocate `EXPERIENCE_EXEMPLAR_*`).
9. **Abort/cancellation:** exact idle/heartbeat scheme and disconnect propagation across both legs for the long-lived stream.
10. **Rating path:** `chat-thumb-rating` scorer + rating routes write to admin's Mastra `scores` store. After chat moves, does the remote chat path round-trip a `messageId`/`producedBy` back to admin so ratings still attach to admin-persisted message rows? (Confirm scorer + store STAY in admin.)
11. **`ChatStreamEvent` reconciliation:** the richer `chat-stream-event.ts` union vs the wired service union (line ~54) — consolidate into one admin-owned contract at cleanup.
12. **`auto-enrich-agent`:** confirmed out of scope; confirm it stays registered in admin (it would also need HTTP-backed tools if moved later).

> **Authoring caveats (this doc was assembled by parallel code-readers, not by editing the files):** treat any line numbers as approximate — re-confirm exact handler boundaries in `apps/mastra/src/mastra/index.ts` and the `ChatStreamEvent` union before editing. The two facts NOT verified by reading, which gate the design: (a) whether `@mastra/core/server`'s `registerApiRoute` Hono handler can return a streaming/SSE body (Open Question 1 — **prototype this first**), and (b) whether extracting `experience-ai.schemas` + `@/domain/blocks` `BlocksSchema` to a shared package is clean (its import graph was not traced; Open Question 2).

---

## Related Prior Art

- `docs/plans/2026-05-18-001-feat-admin-mastra-only-chat-channel-plan.md` — the admin-side chat channel design (the path being relocated).
- `docs/plans/2026-05-19-001-feat-mastra-workflow-draft-generation-plan.md` — the draft-generation workflow design.
- `docs/plans/2026-05-22-001-feat-mastra-railway-runtime-plan.md` — the standalone `apps/mastra` Railway runtime (the destination service).
- `docs/plans/2026-05-26-002-feat-mastra-experience-embedding-migration-plan.md` — **the contract template** to mirror (admin → mastra trigger + mastra → admin ingest, bearer/key separation). Siblings: `2026-05-25-001-feat-mastra-transcript-embedding-migration-plan.md`, `2026-05-26-001-feat-mastra-scene-embedding-migration-plan.md`, `2026-05-26-003-feat-mastra-embedding-workflow-hardening-plan.md`, `2026-06-03-001-feat-mastra-ai-gateway-embeddings-plan.md`.

**Cross-cutting learnings to apply:**

- `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md` — admin's caller budget must stay strictly larger than mastra's internal budget; remote timeout must classify as `timeout`.
- `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md` — new vars `.optional()`.
- `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md` — receiver deploys keyring entry FIRST, then caller.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — real-DB smoke for the re-homed tool endpoints.
- `docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md` — plain-string `event=name key=value` logging on the new admin routes, NOT `JSON.stringify`.
- `docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md` — Tier-2 review required before push.
