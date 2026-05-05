---
title: "feat: Admin AI experience drafting"
type: feat
status: active
date: 2026-04-23
---

# Admin AI Experience Drafting

## Overview

Add a prompt-first drafting flow to `apps/admin` so an editor can open an empty
experience canvas, describe a theme or story, and receive a generated first
draft composed from the existing admin block system. The generated result should
land directly in the current editor state as editable title, description, and
blocks. Seed Studio is reference material only; the shipped runtime surface
stays entirely inside the admin experience editor.

## Problem Frame

The current admin editor is structurally capable but operationally manual:
operators start from a blank experience and add blocks one at a time. That is
good for precise editing, but weak for ideation and first-draft speed. The
product you described is different: type a theme, story, or angle, then let AI
compose the initial editorial structure using blocks. The generated draft must
still honor the system's real constraints:

- it must produce admin-native blocks rather than Seed Studio or Strapi payloads
- it must use only real catalog-backed videos/media references
- it must remain editable with the normal canvas tools
- it must not auto-save or auto-publish

## Requirements Trace

- **R1.** Add a `Generate with AI` entry point to the empty-canvas experience
  editor UI in `apps/admin`.
- **R2.** The editor provides one prompt field for theme/story/angle. No chat
  thread or multi-step wizard in v1.
- **R3.** AI returns a first draft containing `title`, `metaDescription`, and
  a block tree that can be normalized into admin's canonical `BlocksSchema`.
- **R4.** V1 works only on an empty canvas. Existing non-empty drafts are out of
  scope for merge/append/replace behavior.
- **R5.** Generated drafts stay in local editor state until the operator
  explicitly saves or publishes through the existing actions.
- **R6.** Video-bearing blocks may only reference server-provided catalog
  candidates. No hallucinated external streaming URLs or freeform video ids.
- **R7.** The provider path reuses admin's env posture: prefer OpenRouter, fall
  back to OpenAI, no new SDK requirement.
- **R8.** The flow handles loading, retryable failure, and normalization errors
  inline in the editor.
- **R9.** The provider-facing schema supports every current admin block type,
  even if the prompt biases toward simpler compositions.

## Scope Boundaries

- No Seed Studio UI embedding and no runtime cross-import from `apps/seed-studio`.
- No changes to the canonical saved block schema in `apps/admin/src/domain/blocks.ts`.
- No auto-save, auto-publish, or background workflow dispatch on generation.
- No AI behavior on a non-empty canvas in v1.
- No slug/path mutation by AI in v1; route controls remain manual.
- No semantic video ranking work that requires a new video embeddings pipeline.
  Candidate retrieval in v1 should use the current admin video catalog data.
- No general-purpose chat assistant in admin. This is one-shot draft generation,
  not conversational editing.

## Context & Research

### Relevant Code And Patterns

- `apps/admin/src/app/dashboard/experiences/[id]/page.tsx`
  already owns the editor's server actions (`saveLocaleAction`,
  `publishLocaleAction`, `createLocaleAction`, `restoreRevisionAction`). That is
  the clean seam for a new ephemeral `generateDraftAction`.
- `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
  already renders the empty-canvas state and owns the local editor state
  (`title`, `metaDescription`, `parsedBlocks`, selection state). This is the
  correct client surface for the new AI entry point.
- `apps/admin/src/domain/blocks.ts` is the saved-source-of-truth contract. It is
  strict, nested, and not model-friendly in several places
  (`containerSlot` markers, `sectionKey` cross-references, `videoId` references).
- `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts`
  defines `VideoLibraryItem` and the editor's existing catalog-backed video
  summary shape (`id`, `previewImageUrl`, `previewStreamUrl`, etc.).
- `apps/admin/src/services/experience.service.ts` shows the mutation boundary
  the editor already trusts. Generation should not bypass this for save/publish,
  but it also should not call it during the generate step because v1 is
  intentionally ephemeral.
- `apps/admin/src/services/embeddings.service.ts` shows the repo-local provider
  pattern already used in admin: raw `fetch`, OpenRouter-first/OpenAI-fallback,
  env validation in `apps/admin/src/config/env.ts`, timeout handling, and no SDK
  abstraction layer.
- `docs/solutions/best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md`
  provides the closest existing pattern for strict structured-output generation
  in a Next.js Server Action.

### Institutional Learnings

- The admin app already has a safe pattern for provider-backed server work:
  keep keys server-side, return serializable discriminated unions, log unknown
  failures server-side, and keep user-facing messages typed and narrow.
- Prior Seed Studio work proved that "real catalog only" is not just a prompt
  preference. The system needs server-owned candidate reconciliation, not trust
  in freeform model URLs or ids.
- The experience editor has already invested in a canonical admin block model.
  The right move is to normalize model output into that contract, not invent a
  second saved representation.

## Key Technical Decisions

1. **Use a server action from the editor route, not a GraphQL mutation.**
   The draft is ephemeral and immediately consumed by the current editor page.
   It does not need an API surface discoverable by other clients, and it should
   stay colocated with the existing editor action seam.

2. **Keep the provider contract separate from `BlocksSchema`.**
   Admin's saved block schema is too implementation-shaped for a model:
   `container` uses flat slot markers, navigation references depend on concrete
   `sectionKey` values, and video-bearing blocks want real `videoId`s. Create a
   model-facing draft schema that covers every block type but uses model-friendly
   constructs, then normalize into `BlocksSchema` server-side.

3. **Use server-assigned aliases for references.**
   The model should not emit raw `videoId`s or fragile cross-block keys. The
   prompt should expose compact candidate ids like `v01`, `v02`, and optional
   section refs like `s01`, `s02`. The normalizer resolves those aliases into
   real `videoId`s and generated `sectionKey`s.

4. **Bias prompting toward good editorial defaults without restricting block
   coverage.**
   The user explicitly wants "any block." Support every current block type in
   the schema, but guide the model toward sensible first-draft structures unless
   the prompt clearly calls for more exotic compositions.

5. **Empty canvas only in v1.**
   This keeps the first shipping behavior safe and legible: no merge semantics,
   no destructive replacement, no partial rewrite complexity, and no ambiguity
   about what AI owns.

6. **Generation populates local state only.**
   The AI step updates `title`, `metaDescription`, and `parsedBlocks` in the
   client. Save/publish remain explicit operator actions through the existing
   form actions and revision path.

7. **Keep slug/path manual.**
   Title and description are good AI fields. Route identity is not. Leaving
   slug/path under operator control avoids accidental route churn and collision
   policy complexity in the first version.

8. **Use admin-catalog retrieval, not a new embeddings system.**
   Admin does not yet have a semantic video-retrieval pipeline. V1 should build
   a lexical/topical candidate search over existing `Video` + `VideoLocale`
   fields, then let the model choose from that bounded set. Better ranking can
   become a follow-up feature later.

## High-Level Technical Design

### Request Flow

1. Operator opens `/dashboard/experiences/[id]` for a locale with no blocks.
2. Empty canvas shows `Generate with AI`.
3. Operator enters a theme/story prompt and submits.
4. Client calls a new server action on the editor route.
5. Server action:
   - revalidates session/permissions for the locale
   - loads a bounded candidate video catalog from admin
   - builds compact aliases (`v01`, `v02`, ...)
   - calls the provider with a strict JSON schema
   - parses and normalizes the model-facing draft
   - validates the normalized output with `BlocksSchema`
   - returns `{ ok: true, draft }` or `{ ok: false, code, message }`
6. Client updates local editor state from the returned draft.
7. Operator reviews and manually saves/publishes if satisfied.

### Draft Contract Shape

The provider-facing contract should be a model-friendly AST, not the raw saved
block JSON. Directionally:

- top-level result:
  - `title`
  - `metaDescription`
  - `blocks`
- each block uses a friendly `t` or `kind`
- `container` uses nested slots/columns, not flat `containerSlot` markers
- video-bearing blocks use `candidateRef: "v01"` instead of raw `videoId`
- navigation/media cross-links use `targetRef: "s02"` instead of raw
  `sectionKey`
- optional presentation fields not needed for a first draft can be omitted and
  defaulted server-side during normalization

The server-owned normalizer then:

- assigns real `sectionKey`s
- resolves video aliases to `videoId`s
- expands container slot abstractions into admin's flat marker representation
- drops or errors on unknown candidate refs
- fills safe defaults where the block schema expects them
- validates with `BlocksSchema.parse(...)`

## Implementation Units

- [ ] **Unit 1: Model-Facing Draft Schema + Normalizer**

  **Goal:** Define a provider-facing experience draft contract that can express
  every current admin block type, then normalize it into canonical
  `BlocksSchema`.

  **Requirements:** R3, R6, R9

  **Files:**
  - Create `apps/admin/src/services/experience-ai/experience-ai.schemas.ts`
  - Create `apps/admin/src/services/experience-ai/experience-ai-normalize.ts`
  - Create `apps/admin/src/services/experience-ai/experience-ai-normalize.test.ts`
  - Reference `apps/admin/src/domain/blocks.ts`

  **Approach:**
  - Introduce a model-facing discriminated-union schema that represents all
    top-level and nested block kinds in a prompt-friendly way.
  - Include alias fields for video and section references.
  - Normalize the model output into admin's saved shape:
    - real `sectionKey` generation
    - candidate alias resolution
    - container slot flattening
    - omission of unsupported/empty optional fields
  - Validate the final result with `BlocksSchema`.

  **Test scenarios:**
  - Every supported draft block kind normalizes into a `BlocksSchema`-valid
    payload.
  - Container slot abstractions flatten into the expected `containerSlot`
    markers + content ordering.
  - Navigation/media refs resolve into real `sectionKey`s.
  - Unknown video aliases fail with a typed normalization error.
  - Empty optional URL-like fields are omitted, not serialized as invalid empty
    strings.

- [ ] **Unit 2: Catalog Candidate Retrieval + Provider Helper**

  **Goal:** Build the server-only generation service that retrieves bounded
  video candidates, calls the provider, and returns a normalized draft result.

  **Requirements:** R2, R6, R7, R8, R9

  **Files:**
  - Create `apps/admin/src/services/experience-ai/experience-ai.service.ts`
  - Create `apps/admin/src/services/experience-ai/experience-ai.service.test.ts`
  - Modify `apps/admin/src/config/env.ts` only if a missing AI env doc/update is
    needed
  - Modify `apps/admin/.env.example`

  **Approach:**
  - Reuse admin's env posture: OpenRouter first, OpenAI fallback, raw `fetch`,
    timeout handling, typed errors.
  - Add a candidate retrieval helper that ranks admin catalog rows from
    `Video`/`VideoLocale` data for the given prompt and locale, returning a
    bounded list with compact aliases.
  - Build the provider prompt from:
    - user prompt
    - compact candidate catalog
    - editor-safe system instructions
    - strict JSON schema for the model-facing draft
  - Parse, normalize, and return a discriminated-union result.

  **Test scenarios:**
  - Missing provider env returns a typed `NOT_CONFIGURED` result.
  - Provider 5xx/timeout returns a typed upstream error.
  - Provider response that violates the draft schema fails before touching the
    editor.
  - Unknown candidate aliases are rejected during normalization.
  - Candidate retrieval is bounded and returns stable aliases in order.
  - Successful generation returns title + description + normalized blocks.

- [ ] **Unit 3: Editor Route Server Action**

  **Goal:** Add an editor-local server action that enforces permissions and
  returns serializable draft results to the client.

  **Requirements:** R1, R5, R7, R8

  **Files:**
  - Modify `apps/admin/src/app/dashboard/experiences/[id]/page.tsx`
  - Create `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts`
  - Create `apps/admin/src/app/dashboard/experiences/generate-draft-action.test.ts`

  **Approach:**
  - Extract the draft-generation action into a route-local module so the server
    action body stays thin and testable.
  - Reuse `requireSession()` and the existing experience/locale access model.
  - Enforce that only users who could edit the locale can generate a draft for
    it.
  - Return only serializable success/error unions; no raw `Error` objects.
  - Do not write to Prisma in this action.

  **Test scenarios:**
  - Unauthorized/editor-forbidden access returns a typed forbidden result.
  - Empty-canvas generation returns a serializable draft payload.
  - The action never calls save/publish services.
  - Unknown errors are collapsed into a generic typed response.

- [ ] **Unit 4: Empty-Canvas Editor UX**

  **Goal:** Surface `Generate with AI` in the empty-canvas experience editor and
  apply successful drafts into local state.

  **Requirements:** R1, R2, R4, R5, R8

  **Files:**
  - Modify `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
  - Create `apps/admin/src/app/dashboard/experiences/experience-editor/ai-draft-panel.tsx`
  - Modify `apps/admin/src/app/dashboard/experiences/experience-editor.test.tsx`

  **Approach:**
  - Add a `Generate with AI` starter to the empty-canvas state only.
  - Use a compact prompt panel/modal with one textarea.
  - Show clear `idle -> loading -> success/error` states inline.
  - On success:
    - set `title`
    - set `metaDescription`
    - replace `parsedBlocks`
    - select the first generated block
    - leave save/publish untouched until the operator chooses them
  - Hide or disable the AI entry point once the canvas is non-empty.

  **Test scenarios:**
  - Empty canvas shows `Generate with AI`; non-empty canvas does not.
  - Submitting a prompt shows loading state and disables duplicate submit.
  - Successful generation updates local editor state without writing through
    save/publish actions.
  - Failure shows inline error text and permits retry.

- [ ] **Unit 5: Final Validation + Browser Pass**

  **Goal:** Confirm the full flow works inside the real admin editor without
  regressing normal manual editing.

  **Requirements:** R1-R9

  **Files:**
  - No planned source changes unless validation finds a real issue.

  **Approach:**
  - Run focused unit tests first, then full admin validation.
  - In the browser:
    - create/open an empty experience
    - generate a draft from a prompt
    - confirm title/description/blocks populate
    - confirm generated video blocks use catalog-backed selections only
    - confirm save still requires an explicit click

  **Verification:**
  - `pnpm --filter @forge/admin test -- experience-ai experience-editor`
  - `pnpm --filter @forge/admin lint`
  - `pnpm --filter @forge/admin typecheck`
  - `pnpm --filter @forge/admin test`

## Risks And Follow-Ups

- **Provider/schema complexity:** Supporting every block type in one provider
  contract is the hardest part of this feature. The normalizer boundary is what
  keeps that complexity from leaking into saved data.
- **Candidate quality:** V1 retrieval is bounded by current video metadata and
  lexical ranking. If outputs feel weak for broad themes, a follow-up ticket
  should add stronger retrieval rather than loosening the "real catalog only"
  rule.
- **Cross-block references:** `navigationCarousel` and section-linking content
  are exactly why alias normalization exists. This area needs explicit tests.
- **Future phases:** append-to-end, insert-at-position, rewrite-selected-block,
  and conversational refinement should be follow-up tickets, not hidden inside
  v1.
