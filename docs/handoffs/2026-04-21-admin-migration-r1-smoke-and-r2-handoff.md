# Handoff: finish R1 smoke, then start R2 (transcript embeddings)

**For:** the next Claude Code / engineer session picking up Nisal's
admin-migration work in `JesusFilm/forge`.
**Written:** 2026-04-21, immediately after PR #820 merged and Nisal
had to pivot off.

---

## Prompt to paste to yourself on first run

> You are continuing Nisal's admin-migration work. Three PRs merged on
> 2026-04-21 (in order): #818 dispatch fix, #819 coreId mapping → S3,
> #820 CLI env-isolation fix. R1 scene-embedding infrastructure is
> fully deployed and the refresh CLI works end-to-end. **Nisal got
> blocked right before step 3 of the R1 prod smoke because his admin
> env couldn't resolve `RAILWAY_S3_*` locally** (Doppler project
> `forge-admin` not found; shared bucket creds live on the manager /
> cms Doppler projects).
>
> Your job, in order:
>
> 1. Unblock the R1 prod smoke (~30 min). Run `pnpm --filter @forge/admin refresh:core-id-mapping`
>    locally with the shared bucket creds populated, then invoke the
>    mutation against prod admin, then verify the DB writes.
> 2. Once smoke is green, start Part B: R2 transcript embeddings
>    infrastructure. Mirror R1 structurally. Full spec in this doc's
>    "Part B" section and in the earlier R2 handoff at
>    `docs/handoffs/2026-04-20-admin-migration-r2-handoff.md`.
> 3. Apply the durable learning from PR #819: mandatory round-2 review
>    scoped to the fix-commit diff, grep sibling call sites before
>    marking any finding "applied." See
>    `docs/solutions/best-practices/review-fix-round-2-sibling-call-site-regressions-20260421.md`.

---

## Where the work currently sits

### Merged to main (2026-04-21)

| PR   | Title                                                                 | Commit on main |
| ---- | --------------------------------------------------------------------- | -------------- |
| #818 | `fix(admin): dispatch workflows via start() from workflow/api`        | `f002a0f`      |
| #819 | `fix(admin): fetch coreId mapping from Railway S3`                    | `b58e3d5`      |
| #820 | `fix(admin): isolate refresh CLI from @/config/env transitive import` | `727123d`      |

### New solution docs on main

- `docs/solutions/best-practices/review-fix-round-2-sibling-call-site-regressions-20260421.md`
  — the meta-learning from PR #819's two-round review + PR #820's
  follow-on transitive-import fix. **Read before running your own
  review-fix loops.** Core rules: grep siblings before marking any
  finding "applied", and run round 2 against the fix-commit diff
  (`git diff ${round1_commit}..${fix_commit}`) rather than the full
  PR.

### Operational state

- Admin is live at https://admin.jesusfilm.org (Railway us-west2,
  service id `bdb15048-1ca9-4217-ae01-ef7cc19ca6f4`).
- R1 scene-embedding infra is deployed but **has not been smoke-tested
  end-to-end against prod.** The mutation exists and is ADMIN-gated;
  no one has verified that invoking it writes real embedding rows.
- The refresh CLI runs end-to-end locally against **local cms** (Nisal
  verified: 2113 rows dumped, local fallback landed). It has NOT been
  verified against **prod cms + prod S3**. That's step 1 below.

---

## Part A — unblock R1 smoke (~30 min)

### Step 1: resolve `RAILWAY_S3_*` locally

Nisal hit `Doppler Error: Could not find requested project 'forge-admin'`.
Two paths to try, in order:

**Try Doppler re-auth first.**

```bash
doppler login
doppler projects list | head
```

If `forge-admin` shows up, run `pnpm --filter @forge/admin fetch-secrets`
and skip to step 2. If it doesn't exist at all, use the fallback below.

**Fallback: copy from the manager's env.** The S3 bucket is shared
across admin / manager / cms (see
`~/.claude/projects/-workspace/memory/project_cms_openrouter_key.md`
for related shared-key context). Manager and cms have a Doppler project
that does exist.

```bash
pnpm --filter @forge/manager fetch-secrets
# Copy only the S3 block into admin's env:
grep '^RAILWAY_S3_' apps/manager/.env >> apps/admin/.env
# Sanity check — should see 5 lines:
grep '^RAILWAY_S3_' apps/admin/.env
#   RAILWAY_S3_BUCKET=...
#   RAILWAY_S3_ENDPOINT=...
#   RAILWAY_S3_REGION=...
#   RAILWAY_S3_ACCESS_KEY_ID=...
#   RAILWAY_S3_SECRET_ACCESS_KEY=...
```

Dedupe any conflicts — the admin env may already have them.

### Step 2: point `apps/cms/.env` at prod cms

The dump script inherits `apps/cms/.env`. For a **prod** snapshot, its
`DATABASE_URL` must point at prod cms, not local.

```bash
pnpm --filter @forge/cms fetch-secrets
grep '^DATABASE_URL=' apps/cms/.env | head -1
# Expect railway.proxy host (caboose.proxy.rlwy.net:38962 per
# ~/.claude/projects/-workspace/memory/railway_prod_credentials.md)
```

If the refresh CLI hit the "RAILWAY_S3_BUCKET not set; wrote local
fallback" branch during Nisal's run, that's your signal the admin env
isn't picking up prod S3. Fix step 1 first.

### Step 3: run the refresh CLI

```bash
pnpm --filter @forge/admin refresh:core-id-mapping
```

**Expected final line:** `[refresh:core-id-mapping] uploaded <N> bytes to s3 key admin-migrations/core-id-mapping.json`
— with no `"RAILWAY_S3_BUCKET not set; wrote local fallback"` in the
preceding output. If you see the fallback line, stop and re-check env.

### Step 4: invoke the backfill mutation against prod admin

Log in to https://admin.jesusfilm.org with Nisal's ADMIN user (email
`nisal.cottingham@tandem.org.nz` — credentials are in the user's
password manager, not in memory). Grab the
`better-auth.session_token` cookie from browser devtools.

```bash
SESSION='<paste cookie value here>'
# Pick one coreId that has a scene-analysis artifact in S3. Any videoed
# Jesus Film title that manager has processed will do; a lightweight way
# to pick one:
#   SELECT core_id FROM videos WHERE core_id IS NOT NULL LIMIT 1;
# against prod cms, OR inspect the S3 bucket's top-level listing for
# {assetId}/scene-analysis.json entries and cross-reference to cms.
CORE_ID='<one coreId>'

curl -s https://admin.jesusfilm.org/api/graphql \
  -H 'content-type: application/json' \
  -H "cookie: better-auth.session_token=$SESSION" \
  -d "$(jq -n --arg id "$CORE_ID" '{query:"mutation { triggerSceneEmbeddingBackfill(coreIds: [\($id | tojson)], locales: [\"en\"]) }"}')"
```

**Expected response shape:**

```json
{
  "data": {
    "triggerSceneEmbeddingBackfill": {
      "mappingGeneratedAt": "2026-04-21T...",
      "totalTargets": 1,
      "locales": ["en"],
      "outcomes": [ { "status": "succeeded", ... } ],
      "succeeded": 1,
      "skipped": 0,
      "failed": 0
    }
  }
}
```

If `failed: 1`, inspect the `outcomes[0].reason` — common reasons the
classifier surfaces now:

| code                   | meaning                                               | action                         |
| ---------------------- | ----------------------------------------------------- | ------------------------------ |
| `artifact_missing`     | manager never wrote the scene-analysis for this video | pick a different coreId        |
| `mapping_missing`      | S3 mapping doesn't have this coreId yet               | re-run step 3                  |
| `mapping_key_rejected` | caller passed a bad `mappingS3Key`                    | shouldn't happen (default key) |
| `mapping_read_failed`  | S3 / bucket config issue                              | check admin's Railway env vars |

### Step 5: verify the DB writes

Against admin's prod Postgres (asia-southeast1; see
`~/.claude/projects/-workspace/memory/railway_prod_credentials.md` for
access pattern):

```sql
SELECT COUNT(*) FROM video_scene_locale WHERE embedding IS NOT NULL;
SELECT COUNT(DISTINCT video_edition_id) FROM video_scene;
```

Row count should match the scene count from the artifact. You can
cross-check against S3:

```bash
aws s3 cp s3://$RAILWAY_S3_BUCKET/$ASSET_ID/scene-analysis.json - \
  | jq '.scenes | length'
```

When both match, **R1 smoke is green.** Update this handoff + the
project memory (`project_admin_migration_r1_r2.md`) with the date, then
proceed to Part B.

---

## Part B — R2 transcript embeddings infra

The earlier R2 handoff at
`docs/handoffs/2026-04-20-admin-migration-r2-handoff.md` still applies.
Headline points:

- Mirror R1 structurally: `VideoTranscript` + `VideoTranscriptLocale`
  Prisma models, per-locale partial HNSW indexes, transcript-embedding
  indexer + backfill workflow, ADMIN-only mutation.
- Migration `0004` — do not touch 0001–0003.
- R2 shortcut to verify: manager caches transcript embedding vectors
  in S3 (per `apps/manager/src/services/embeddings.ts` `EmbeddingsResult`
  type). Admin can **reuse** those vectors rather than regenerate —
  faster backfill, zero OpenRouter cost. **Confirm from manager's code
  first before designing the indexer.**
- Adopt the `mappingS3Key: String = "admin-migrations/core-id-mapping.json"`
  arg shape Part A introduced. Do NOT invent a separate mapping key
  for transcripts — the mapping is the same.
- Dispatch test mandatory — every `"use workflow"` call site needs a
  test that mocks `start()` from `workflow/api`. Pattern:
  `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`.
- Pothos types: `@classification public-shape`, embedding column NOT
  exposed via GraphQL, add to `classification.test.ts` RELATION_TARGETS,
  `schema.security.test.ts` "no embed/vector/similarit field leak"
  must still pass.

**Apply the round-2 review learning.** Before marking any R2 review
finding "applied":

```bash
rg -n '<pattern from the finding>' apps/ packages/
```

Then round 2 against the fix diff:

```bash
git diff -U10 ${round1_commit}..${fix_commit} -- 'apps/admin/**' \
  > /tmp/r2-round2-scope.diff
```

Feed that diff to the round-2 reviewers with the scope-narrowing prompt
from the solution doc.

---

## Key docs to read first

Read in this order:

1. `docs/solutions/best-practices/review-fix-round-2-sibling-call-site-regressions-20260421.md`
   — the learning that shaped the last 4 hours of work. Read first so
   you don't reinvent the wheel on R2's review.
2. `apps/admin/CLAUDE.md` — scene embeddings section has the R1
   operational runbook (already updated with the `refresh:core-id-mapping`
   CLI as step 1).
3. `docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md`
   — Cross-Cutting Constraints section. Still load-bearing for R2+.
4. `docs/handoffs/2026-04-20-admin-migration-r2-handoff.md` — R2
   recipe in detail.
5. `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`
   — dispatch test pattern; non-negotiable for any new workflow call
   site.
6. `docs/solutions/developer-experience/env-matrix-drift-from-runtime-requirements-20260421.md`
   — audit code for `throw.*required` guards before trusting any env
   matrix.
7. `apps/admin/src/services/core-id-mapping.service.ts` +
   `apps/admin/src/services/core-id-mapping.constants.ts` +
   `apps/admin/src/scripts/refresh-core-id-mapping.ts` — R1 reference
   implementation after both fix rounds. The constants module is the
   pattern for any future admin-scoped shared constant that a CLI
   should be able to import without pulling env.ts.
8. `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` +
   `apps/admin/src/graphql/mutations/scene-embedding.ts` — R1
   workflow-body + dispatch site reference; R2 mirrors this shape.

## Constraints (carry-forward from the earlier R2 handoff)

- Don't skip the dispatch test on R2. The pattern PR #818 shipped is
  non-negotiable.
- Don't modify R1 code unless a bug is found during R2 work.
- Don't provision new infra unless R2 explicitly requires it (it
  shouldn't — same bucket, same mapping, same workflow runtime).
- Don't touch `CORE_API_TOKEN` / SSO / Firebase env — feat-105 owns
  those.
- Audit any new env var against code-level `throw.*required` guards
  before declaring the matrix complete (per env-matrix-drift doc).

## Memory context

Relevant entries in `~/.claude/projects/-workspace/memory/`:

- `project_admin_migration_r1_r2.md` — should be updated when R1 smoke
  passes (flip the status to "green") and when R2 starts.
- `feedback_review_fix_loop.md` — apply gated_auto fixes when
  verifiable; only defer items needing human judgment. Still current
  policy.
- `railway_prod_credentials.md` — prod Postgres + Railway API access.
- `project_cms_openrouter_key.md` — reminder that cms + manager share
  the OPENROUTER key; R2 doesn't need OpenRouter at all if it reuses
  manager's cached transcript vectors.

## If things go sideways

- **The refresh CLI crashes at module load with env errors again.**
  Something re-introduced the `@/storage/s3` → `@/config/env`
  transitive import from the service module. The import-isolation
  regression test (`apps/admin/src/scripts/refresh-core-id-mapping.import-isolation.test.ts`)
  should have failed loudly if so. Fix by restoring the constants-only
  import pattern from PR #820.
- **The backfill mutation returns `failed: 1` with a `mapping_missing`
  reason.** Re-run the refresh CLI. If the mapping genuinely doesn't
  have the coreId, the cms dump missed it — check that cms's
  `videos.core_id` has the value.
- **Railway service env vars are out of sync.** The admin env matrix
  lives on the Railway `@forge/admin` service, not in any Doppler
  project. If you need to add / update env vars, use the Railway MCP
  or dashboard. See
  `docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md`.

Good luck.
