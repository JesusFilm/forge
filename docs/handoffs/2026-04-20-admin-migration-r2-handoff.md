# Handoff: Admin migration, R2+ (transcript embeddings onwards)

**For:** the next Claude session / engineer picking up Nisal's migration work.
**Written:** 2026-04-20, after PR #798 (R1) landed with review-fix pass.

---

## TL;DR

R1 (scene embeddings) is merged-ready: PR #798, 6 commits, 510 admin
tests green, lint green, typecheck green. Review-fix pass addressed 15
findings across security, correctness, reliability, and TypeScript
quality. Two durable learnings captured in `docs/solutions/` plus one
refresh of the pgvector HNSW doc.

Your job, in priority order:

1. **Watch PR #798 through review + merge.** Tatai is the natural
   reviewer (admin architecture). The user (Nisal) has already pinged
   him about admin not yet being on Railway — that's a separate
   platform task and NOT blocking merge.
2. **Do not start R2 until PR #798 is merged OR the user asks.**
   R2 (transcript embeddings) rides directly on R1's foundation; you'd
   conflict with yourself otherwise.
3. **After merge, execute R2** following the playbook template that
   R1 proved out. Details below.

## Where R1 landed

- **Branch:** `feat/admin-scene-embeddings-r1`
- **PR:** https://github.com/JesusFilm/forge/pull/798
- **Commits:**
  - `docs(admin): add migration playbook requirements, R1 plan, and scene-embedding pattern doc`
  - `feat(cms): add dump:core-id-mapping script for admin migrations`
  - `feat(admin): add VideoScene + VideoSceneLocale models and 0003 migration`
  - `feat(admin): add scene-embedding services and backfill workflow`
  - `feat(admin): expose triggerSceneEmbeddingBackfill mutation and Pothos types`
  - `fix(admin): apply R1 review findings (security + correctness + reliability)`
  - `docs(solutions): capture R1 review learnings and refresh pgvector HNSW doc`

## Canonical artifacts to read first

In this order:

1. **`docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md`**
   — parent playbook. R1 through R9 are defined here with scope
   boundaries and key decisions. Every future step sits under this
   frame. Re-read the Scope Boundaries section before touching
   anything.
2. **`docs/plans/2026-04-19-001-feat-admin-scene-embeddings-infra-plan.md`**
   — R1 implementation plan. Template for every subsequent R2–R9 plan.
3. **`docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md`**
   — R1's durable-learning doc. Describes the reusable shape for any
   future "port from cms, regenerate from manager's S3 artifact, write
   to admin's pgvector" migration step.
4. **`docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`**
   — the error-handling patterns every backfill workflow in this
   migration should follow (Promise.allSettled, typed-error
   classification, exhaustive switch).
5. **`docs/solutions/security-issues/zod-validation-errors-must-not-echo-user-controlled-input-20260420.md`**
   — security pattern for any mutation that takes a user-controlled
   path/URL/resource id. Applies anywhere the next migration step
   accepts an operator input.
6. **`docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md`**
   — updated 2026-04-20 with VideoSceneLocale as a second proof point.
   Treat per-filter-column partial HNSW indexes as the default for any
   new `pgvector` column.
7. **`apps/admin/CLAUDE.md`** — the Scene embeddings section at the
   bottom carries the operator runbook for R1. Expect to append an
   equivalent section for each subsequent step.

## Operational state (important)

- **Admin is NOT yet deployed to Railway.** No `@forge/admin` service
  exists in the `forge` Railway project as of 2026-04-20. The
  `apps/admin/railway.toml` is fully configured (NIXPACKS build +
  start + healthcheck); someone on the platform side (tatai) needs to
  provision the service + Postgres + Doppler env vars + `CREATE
EXTENSION vector`. The user has pinged tatai. Do not attempt to
  provision admin via Railway API — the project-scoped token the user
  supplied (`95b9b511-e42c-4b3c-89ab-63f91f8a15d7`) exists but
  creating services is outside its intended scope and tatai owns the
  decision on service naming/DB sizing.
- **The project-scoped Railway token works** for reading service
  variables and env lists. Use header `Project-Access-Token: <token>`
  against `https://backboard.railway.com/graphql/v2`. Project ID is
  `98952497-a4d9-4714-8fe8-0cdbff3147c9`; production environment is
  `5f41e037-90e4-4674-a3ea-66bbd05fb3b4`.
- **Operator runbook for R1 backfill** (once admin IS deployed):
  dump `pnpm --filter @forge/cms dump:core-id-mapping > .tmp/core-id-mapping.json`,
  confirm `OPENROUTER_API_KEY` or `OPENAI_API_KEY` set on
  `forge-admin`, invoke `triggerSceneEmbeddingBackfill` mutation as
  ADMIN. Full detail in `apps/admin/CLAUDE.md`.

## The playbook (R1–R9 at a glance)

| #   | Step                                                       | State                 | Owner                     |
| --- | ---------------------------------------------------------- | --------------------- | ------------------------- |
| R1  | Scene embeddings infra                                     | **shipped** (PR #798) | Nisal                     |
| R2  | Transcript embeddings                                      | not started           | Nisal                     |
| R3  | Experience content migration (one-shot)                    | not started           | Nisal                     |
| R4  | Hybrid search API (RRF + keyword)                          | not started           | Nisal                     |
| R5  | Recommendation API + Recommendations block                 | not started           | Nisal                     |
| R6  | Personalization stack built native in admin (feat-090–094) | not started           | Nisal                     |
| R7  | Revalidation webhook on admin's write path                 | not started           | Nisal                     |
| R8  | Consumer cutover — one-shot GraphQL swap                   | not started           | Nisal                     |
| R9  | Manager cutover — stop writing to Strapi                   | not started           | Nisal                     |
| R10 | Delete Strapi / sunset                                     | **out of scope**      | platform team (not Nisal) |

## Recommended next step: R2 (transcript embeddings)

Why R2 before R3–R9: R2 rides on R1's foundation directly. Same Prisma
migration pattern, same mapping file, same pattern for reading from
manager's S3, same useworkflow scaffolding. Should feel like a scaled-
down copy of R1 with different artifact shape.

### R2 scope (from the playbook)

- Admin gains a transcript-embedding storage model, indexer, and
  backfill that mirrors R1 but at a per-video-locale + per-chunk
  granularity (transcript chunks, not scenes).
- Source: `apps/manager`'s `{assetId}/embeddings.json` artifact (THIS
  one has pre-computed vectors already, unlike scene-analysis).
  Confirm the shape in `apps/manager/src/services/embeddings.ts` —
  look at the `EmbeddingsResult` type.
- R2 is simpler than R1 in one key way: **vectors are cached in S3**,
  so admin can re-index from the artifact without regenerating
  anything. No OpenRouter spend. Diff from R1's "regenerate scene
  descriptions" decision — preserve this distinction in the R2 plan.
- Naming: likely `VideoTranscriptChunk` + `VideoTranscriptChunkLocale`,
  though the right split depends on whether transcripts are
  language-segmented at the artifact or locale-agnostic. Check
  `apps/cms/src/bootstrap/ensure-pgvector.ts` for the cms
  `transcript_embeddings` table schema as the source-of-truth
  reference.

### Recommended R2 workflow

1. Run `/ce:plan` with scope "R2 transcript embeddings in apps/admin,
   following R1's pattern at
   `docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md`".
2. Do NOT reinvent the S3 reader shape, the coreId mapping loader, or
   the useworkflow scaffolding — extract / reuse / import from R1's
   code:
   - `apps/admin/src/services/manager-artifacts.service.ts` — already
     generalized to "read from manager S3 with Zod validation". Add a
     `readTranscriptEmbeddingsArtifact(assetId)` sibling function.
   - `apps/admin/src/services/core-id-mapping.service.ts` — reuse as-is.
   - `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` — the overall
     shape (stepLoadMapping → stepEnumerateTargets → stepIndex →
     stepReport) is reusable; factor out common pieces rather than
     copy-paste.
3. Apply the R1 review learnings up-front:
   - `Promise.allSettled` for the fan-out
   - `instanceof ManagerArtifactError && error.code === '…'` for
     classification
   - Exhaustive `switch` on the outcome union with `never` fallthrough
   - Transaction timeout explicit (`{ timeout: 30_000 }`)
   - AbortController on any external fetch
   - Per-locale partial HNSW indexes on the new vector column
   - Path-allowlist validation if any new user-facing mutation accepts
     a filesystem path
   - No embedding/vector field leaks via Pothos — run
     `schema.security.test.ts` against the new types
4. Follow the same commit chunking R1 used (docs → cms script if any →
   admin schema → services → workflow → mutation → compound learnings).

### Watch out for

- The transcript artifact has a **different shape** from
  scene-analysis. Zod schema will differ. Don't blindly copy
  `SceneAnalysisSchema`.
- If transcripts are language-segmented at the source (manager
  generates one artifact per `{assetId}/{subtitle-language}/`), the
  backfill target enumeration changes. Check manager's write path
  before planning the schema.
- The existing `generateExperienceEmbedding` function name is still
  a slight misnomer when reused outside experiences. R1 flagged this
  as a maintainability finding; R2 is a reasonable moment to rename
  it to `generateTextEmbedding` across admin. The rename touches the
  scene indexer, the experience workflow, and any R2 code — do it
  in a dedicated refactor commit before the R2 feature work lands.

## Review-fix pass summary (what R1 taught us)

When you write R2's plan, pre-bake these decisions instead of finding
them in review:

1. **Re-reading the source artifact is free; regenerating embeddings
   costs money and is sometimes necessary.** For R2 the artifact
   already contains vectors, so no regeneration. But if a future step
   (R5?) needs scene-level transcript co-embeddings, revisit the
   decision then.
2. **Cross-DB identity lives in a one-shot dump file, never a live
   query.** The coreId mapping pattern is already proven; use the
   same loader.
3. **`code`-discriminated error classes are the public contract.**
   Every service error class in R2 should be like `ManagerArtifactError`
   — readonly literal-union `code` field.
4. **Mutation arguments that are paths, URLs, or resource
   identifiers MUST be allowlist-validated at the service entry.**
   See the Zod-echo security doc.
5. **Every new `embedding` column gets the Pothos-omission +
   `schema.security.test.ts` assertion, not a comment.**

## Decisions deferred during R1 that you may revisit in R2 or later

- Rename `generateExperienceEmbedding` to a generic
  `generateTextEmbedding`. Deferred because it would bloat R1's diff.
- Retry-with-backoff on 429/5xx from the embedding provider.
  R1 added timeouts but no retries; add if the backfill surfaces
  transient failures in practice.
- Integration test against a live Postgres with pgvector.
  R1 relies on mocked Prisma for service tests; a live smoke in CI
  would lock in the `::vector` cast behavior permanently.
- Batching embedding requests (`input: [text1, text2, ...]`) to reduce
  HTTP round-trips. R1 does one HTTP call per scene. Provider supports
  up to 2048 inputs per call. Meaningful at catalog scale.

## Project context you'll want

- User: Nisal, JFP engineer. Prefers terse output, no trailing summaries
  of what was just done. Values review-fix loops when findings are
  gated_auto or higher confidence. OK with the CE workflow (brainstorm
  → plan → work → review → compound).
- Tatai owns admin architecture (feat-086 foundation, feat-100 video
  editorial in flight). His approval gates admin-touching PRs.
- Strapi will be deleted eventually — someone else will turn it off
  (Nisal stated this explicitly). Your scope ends at R9 (manager
  cutover); R10 is the platform team's concern.
- The Railway project has an automatic PR-preview environment
  (`forge-pr-798` exists for this PR). CI runs lint/test/build for
  every workspace across all services.

## How to pick up

When the user asks you to continue:

1. Read the 7 canonical artifacts above in order.
2. Check `git log --oneline -10` to confirm what's landed.
3. Check PR #798 state — if it's merged, you're clear for R2.
4. Run `/ce:plan` with the R2 scope above.
5. Proceed through `/ce:work` → `/ce:review` → fix → `/ce:compound`.

If the user asks for something that isn't R2, read the playbook's
scope boundaries first. Don't do R10 (Strapi deletion) — explicitly
not Nisal's.

Good luck.
