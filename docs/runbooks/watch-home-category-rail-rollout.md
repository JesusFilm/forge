# Watch homepage category rail rollout

This runbook moves the existing fixed Watch homepage category rail into the
authored `watchHomeCategoryRail` Experience block. It does not authorize a
direct Railway deploy. Ship every forward or rollback revision through the
normal pull-request-to-main flow; do not run `railway up` or trigger an ad hoc
service redeploy from a local checkout.

## Release invariants

- Prisma's automatic pre-deploy path performs no category-rail data write. New
  Admin code must be healthy and all old Admin instances must drain before the
  reviewed post-deploy backfill is invoked.
- Until that backfill commits its durable `sync_state` marker, new Admin read
  surfaces synthesize one all-category block immediately after the first
  `watchHomeHero`, or first when no hero exists, for effective homepages that
  lack it. This preserves the old rail without mutating storage.
- The post-deploy backfill is idempotent and atomically updates valid canonical
  and active-draft homepages plus the completion marker. It leaves
  non-homepages, historical revisions, malformed JSON, and already-authored
  category rails unchanged. After the marker exists, authored absence is
  authoritative and read-time synthesis stops.
- Old Web always renders its fixed rail and ignores the authored union member.
- New Web treats a successful new-schema response as authoritative. It renders
  the rail only where `watchHomeCategoryRail` appears in the authored block
  order; an absent block means no rail.
- New Web enters homepage compatibility mode only for an old-schema GraphQL
  validation error for the exact unknown type
  `WatchHomeCategoryRailBlock`. It retries the legacy operation once and places
  one fixed rail immediately after the hero. Network, authorization, resolver,
  timeout, and unrelated validation failures neither retry nor enable the
  fixed rail.
- Draft preview applies the same exact unknown-type gate and retries its legacy
  operation once; unrelated failures remain redacted and fail closed.
- Mobile and TV keep using the legacy Watch Experience fragment throughout the
  rollback window. They still receive the new block's `__typename` from a new
  Admin and silently skip it, without naming the type in requests to an old
  Admin schema.

## Preflight

1. Confirm the release commit contains the Admin schema, generated
   `apps/admin/schema.graphql` and gql.tada output, the reviewed
   `apps/admin/prisma/backfills/watch-home-category-rail-block.sql` artifact,
   Web's new and legacy Watch fragments, and this runbook. Confirm no
   category-rail migration exists under `apps/admin/prisma/migrations/`.
2. Run the backfill contract test against a disposable PostgreSQL database,
   never production:

   ```sh
   WATCH_HOME_CATEGORY_RAIL_BACKFILL_DB_TEST=1 \
     DATABASE_URL='<disposable-postgres-url>' \
     pnpm --filter @forge/admin exec vitest run \
       src/services/watch-home-category-rail-backfill.db.test.ts
   ```

3. Record current Admin and Web deployment revisions, homepage response status,
   and a desktop/mobile screenshot. Confirm the current page shows exactly one
   category rail.
4. Prepare to disable Experience editing immediately before deploying the new
   Admin revision and keep it disabled through post-deploy backfill
   verification. Before activation, missing rails are compatibility state, not
   authored absence; the freeze prevents an editor from deleting a synthesized
   rail or replacing a draft while the backfill is converging storage.

## Forward deployment

Either service order is safe. Deploy only merged main revisions through the
normal Railway integration.

### Web first

1. Deploy Web. Against old Admin, the new Watch operation fails validation on
   `WatchHomeCategoryRailBlock`; Web retries the legacy operation once, marks
   the homepage result `legacy-schema`, and renders exactly one fixed rail.
2. Verify two Admin GraphQL requests only on that compatibility request (one
   failed validation and one successful legacy retry), one visible rail, and no
   client console error or horizontal overflow.
3. Disable Experience editing, then deploy Admin. Its automatic Prisma
   pre-deploy remains data-neutral. Wait for the new revision to pass health
   checks and prove every old Admin instance has drained. New Admin synthesizes
   the equivalent rail on reads in this window.
4. Run the post-deploy backfill command in **Post-deploy activation** below,
   verify it, and re-enable editing. New Web now reads the persisted authored
   block in its stored position.

### Admin first

1. Disable Experience editing, then deploy Admin. Its automatic Prisma
   pre-deploy remains data-neutral. Wait for the new revision to pass health
   checks and prove every old Admin instance has drained. New Admin synthesizes
   the equivalent rail on reads in this window.
2. Old Web continues to render exactly one fixed rail and ignores the
   synthesized union member.
3. Run and verify the post-deploy activation below, then re-enable editing and
   deploy Web.
4. New Web receives the persisted authored block on its first request and
   renders exactly one rail with no compatibility retry.

## Post-deploy activation

Only after the new Admin revision is healthy, every old Admin instance has
drained, and Experience editing is disabled, invoke the committed artifact from
a one-off process created from the **exact healthy Admin deployment image**.
Before starting it, record and verify the Railway project, environment, Admin
service, deployment ID, source SHA, and immutable image digest. The one-off must
show those same identifiers and run this command inside that deployed image:

```sh
pnpm --filter @forge/admin db:backfill:watch-home-category-rail
```

Use the platform/operations-approved release-bound one-off facility with the
project, environment, and service selected explicitly; repository conventions
do not define a safe generic CLI for creating that job. If the facility cannot
prove the deployment/image pin, stop. In particular, do not use `railway run`:
it executes code from the local checkout with remotely injected variables.
This is a reviewed deployment step, not permission to paste SQL into a
production console or point local code at production. Capture the one-off job
ID, exit status, deployment ID, source SHA, and image digest as rollout
evidence. The SQL updates content and records
`watch-home-category-rail-backfill-v1` in `sync_state` in one transaction.
Verify exactly one completion marker before inspecting content:

```sql
SELECT phase, last_synced_at, stats
FROM sync_state
WHERE phase = 'watch-home-category-rail-backfill-v1';
```

Do not rerun production merely to demonstrate idempotence; the disposable
PostgreSQL preflight test owns that proof.

Inspect rows the backfill intentionally cannot rewrite. Both queries should
return zero rows; stop and review any result before enabling editing:

```sql
SELECT id, slug, jsonb_typeof(blocks) AS blocks_type
FROM experience_locale
WHERE is_homepage = true
  AND jsonb_typeof(blocks) IS DISTINCT FROM 'array';

SELECT revision.id, revision.entity_id,
       jsonb_typeof(revision.snapshot #> '{data,blocks}') AS blocks_type
FROM content_revision AS revision
INNER JOIN experience_locale AS locale ON locale.id = revision.entity_id
WHERE revision.entity_type = 'ExperienceLocale'
  AND revision.status = 'DRAFT'
  AND COALESCE(
    CASE
      WHEN jsonb_typeof(revision.snapshot #> '{data,isHomepage}') = 'boolean'
        THEN (revision.snapshot #>> '{data,isHomepage}')::boolean
      ELSE NULL
    END,
    locale.is_homepage
  ) = true
  AND (
    jsonb_typeof(revision.snapshot) IS DISTINCT FROM 'object'
    OR jsonb_typeof(revision.snapshot -> 'data') IS DISTINCT FROM 'object'
    OR jsonb_typeof(revision.snapshot #> '{data,blocks}')
        IS DISTINCT FROM 'array'
  );
```

The following canonical query must return zero rows. During the editing freeze,
it proves every structurally valid homepage has exactly one rail, directly
after its first hero (or first without a hero), with the initial 13 IDs in
shared order:

```sql
WITH expected AS (
  SELECT '["jesus","gospels","short-videos","family","relationships","women","students","sports","good-news","hope","training","easter","christmas"]'::jsonb AS category_ids
), canonical AS (
  SELECT
    locale.id,
    locale.slug,
    count(*) FILTER (WHERE item.value ->> 't' = 'watchHomeCategoryRail') AS rail_count,
    min(item.ordinality) FILTER (WHERE item.value ->> 't' = 'watchHomeHero') AS hero_position,
    min(item.ordinality) FILTER (WHERE item.value ->> 't' = 'watchHomeCategoryRail') AS rail_position,
    (jsonb_agg(item.value -> 'categoryIds' ORDER BY item.ordinality)
      FILTER (WHERE item.value ->> 't' = 'watchHomeCategoryRail')) -> 0 AS category_ids
  FROM experience_locale AS locale
  LEFT JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(locale.blocks) = 'array' THEN locale.blocks
      ELSE '[]'::jsonb
    END
  )
    WITH ORDINALITY AS item(value, ordinality) ON true
  WHERE locale.is_homepage = true
    AND jsonb_typeof(locale.blocks) = 'array'
  GROUP BY locale.id, locale.slug
)
SELECT canonical.*
FROM canonical
CROSS JOIN expected
WHERE rail_count <> 1
   OR rail_position <> COALESCE(hero_position + 1, 1)
   OR category_ids IS DISTINCT FROM expected.category_ids;
```

The active-draft query must also return zero rows:

```sql
WITH expected AS (
  SELECT '["jesus","gospels","short-videos","family","relationships","women","students","sports","good-news","hope","training","easter","christmas"]'::jsonb AS category_ids
), drafts AS (
  SELECT
    revision.id,
    revision.entity_id,
    count(*) FILTER (WHERE item.value ->> 't' = 'watchHomeCategoryRail') AS rail_count,
    min(item.ordinality) FILTER (WHERE item.value ->> 't' = 'watchHomeHero') AS hero_position,
    min(item.ordinality) FILTER (WHERE item.value ->> 't' = 'watchHomeCategoryRail') AS rail_position,
    (jsonb_agg(item.value -> 'categoryIds' ORDER BY item.ordinality)
      FILTER (WHERE item.value ->> 't' = 'watchHomeCategoryRail')) -> 0 AS category_ids
  FROM content_revision AS revision
  INNER JOIN experience_locale AS locale ON locale.id = revision.entity_id
  LEFT JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(revision.snapshot #> '{data,blocks}') = 'array'
        THEN revision.snapshot #> '{data,blocks}'
      ELSE '[]'::jsonb
    END
  )
    WITH ORDINALITY AS item(value, ordinality) ON true
  WHERE revision.entity_type = 'ExperienceLocale'
    AND revision.status = 'DRAFT'
    AND jsonb_typeof(revision.snapshot #> '{data,blocks}') = 'array'
    AND COALESCE(
      CASE
        WHEN jsonb_typeof(revision.snapshot #> '{data,isHomepage}') = 'boolean'
          THEN (revision.snapshot #>> '{data,isHomepage}')::boolean
        ELSE NULL
      END,
      locale.is_homepage
    ) = true
  GROUP BY revision.id, revision.entity_id
)
SELECT drafts.*
FROM drafts
CROSS JOIN expected
WHERE rail_count <> 1
   OR rail_position <> COALESCE(hero_position + 1, 1)
   OR category_ids IS DISTINCT FROM expected.category_ids;
```

After the diagnostics return zero rows, explicitly invalidate Web's shared ISR
and resolver caches before the final request/browser checks. From an approved
secret-capable operations environment, use the deployed Admin service's
`WEB_REVALIDATE_URL` and `WEB_REVALIDATE_TOKEN`; do not print the token:

```sh
curl --fail-with-body --silent --show-error \
  --request POST "$WEB_REVALIDATE_URL" \
  --header "Authorization: Bearer $WEB_REVALIDATE_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"model":"watch-setting","entry":{}}'
```

Expect HTTP 200 with `revalidated: true`, no `tagErrors`, and `tags` containing
`watch:home`, `watch:settings`, `watch:experience`, `watch:video`,
`watch:series`, and `watch:child-dub-languages`. A non-2xx response or missing
success fields is a stop condition; do not rely on the normal cache TTL.

Then query the homepage through Admin GraphQL and confirm `blocks` includes one
`WatchHomeCategoryRailBlock` with all 13 IDs. Load Web and confirm one
successful Experience request, one visible rail, and no compatibility retry.
Re-enable editing and verify an admin can reorder the block, curate tile
membership/order, save, reopen, and preview the result.

## Rollback

Rollback must reverse the consumer dependency before removing the stored
discriminator.

1. Roll Web back first through the normal pull-request-to-main deployment flow.
   Verify old Web again renders exactly one fixed rail while new Admin remains
   live.
2. While new Admin can still read `watchHomeCategoryRail`, ship a reviewed
   rollback data migration that removes the discriminator from canonical
   homepages and **all** `ExperienceLocale` revisions, including `HISTORICAL`.
   Old Admin cannot parse the new discriminator when an editor reads or restores
   revision history, so cleaning active drafts alone is not rollback-safe. The
   migration should use the following scoped transformation; do not run it as
   an unreviewed production console command:

   ```sql
   WITH cleaned AS (
     SELECT
       locale.id,
       COALESCE(
         jsonb_agg(item.value ORDER BY item.ordinality)
           FILTER (WHERE item.value ->> 't' <> 'watchHomeCategoryRail'),
         '[]'::jsonb
       ) AS blocks
     FROM experience_locale AS locale
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE
         WHEN jsonb_typeof(locale.blocks) = 'array' THEN locale.blocks
         ELSE '[]'::jsonb
       END
     )
       WITH ORDINALITY AS item(value, ordinality)
     WHERE locale.is_homepage = true
       AND jsonb_typeof(locale.blocks) = 'array'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(
           CASE
             WHEN jsonb_typeof(locale.blocks) = 'array' THEN locale.blocks
             ELSE '[]'::jsonb
           END
         ) AS candidate(value)
         WHERE candidate.value ->> 't' = 'watchHomeCategoryRail'
       )
     GROUP BY locale.id
   )
   UPDATE experience_locale AS locale
   SET blocks = cleaned.blocks
   FROM cleaned
   WHERE locale.id = cleaned.id;

   WITH cleaned AS (
     SELECT
       revision.id,
       revision.snapshot,
       COALESCE(
         jsonb_agg(item.value ORDER BY item.ordinality)
           FILTER (WHERE item.value ->> 't' <> 'watchHomeCategoryRail'),
         '[]'::jsonb
       ) AS blocks
     FROM content_revision AS revision
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE
         WHEN jsonb_typeof(revision.snapshot #> '{data,blocks}') = 'array'
           THEN revision.snapshot #> '{data,blocks}'
         ELSE '[]'::jsonb
       END
     )
       WITH ORDINALITY AS item(value, ordinality)
     WHERE revision.entity_type = 'ExperienceLocale'
       AND jsonb_typeof(revision.snapshot #> '{data,blocks}') = 'array'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(
           CASE
             WHEN jsonb_typeof(revision.snapshot #> '{data,blocks}') = 'array'
               THEN revision.snapshot #> '{data,blocks}'
             ELSE '[]'::jsonb
           END
         ) AS candidate(value)
         WHERE candidate.value ->> 't' = 'watchHomeCategoryRail'
       )
     GROUP BY revision.id, revision.snapshot
   )
   UPDATE content_revision AS revision
   SET snapshot = jsonb_set(
     cleaned.snapshot,
     '{data,blocks}',
     cleaned.blocks,
     false
   )
   FROM cleaned
   WHERE revision.id = cleaned.id;

   DELETE FROM sync_state
   WHERE phase = 'watch-home-category-rail-backfill-v1';
   ```

   Old Web is already restored before this cleanup and continues rendering its
   one fixed rail. Existing new Admin processes may have cached marker
   completion, which is harmless in this order; old Admin remains safe because
   both stored discriminators and the marker are gone before it is restored.

3. Require all three read-only checks to return `0`:

   ```sql
   SELECT count(*)
   FROM experience_locale AS locale
   WHERE locale.is_homepage = true
     AND jsonb_typeof(locale.blocks) = 'array'
     AND EXISTS (
       SELECT 1
       FROM jsonb_array_elements(
         CASE
           WHEN jsonb_typeof(locale.blocks) = 'array' THEN locale.blocks
           ELSE '[]'::jsonb
         END
       ) AS item(value)
       WHERE item.value ->> 't' = 'watchHomeCategoryRail'
     );

   SELECT count(*)
   FROM content_revision AS revision
   WHERE revision.entity_type = 'ExperienceLocale'
     AND jsonb_typeof(revision.snapshot #> '{data,blocks}') = 'array'
     AND EXISTS (
       SELECT 1
       FROM jsonb_array_elements(
         CASE
           WHEN jsonb_typeof(revision.snapshot #> '{data,blocks}') = 'array'
             THEN revision.snapshot #> '{data,blocks}'
           ELSE '[]'::jsonb
         END
       ) AS item(value)
       WHERE item.value ->> 't' = 'watchHomeCategoryRail'
     );

   SELECT count(*)
   FROM sync_state
   WHERE phase = 'watch-home-category-rail-backfill-v1';
   ```

4. Verify old Web's homepage query succeeds against new Admin and the fixed rail
   remains visible exactly once.
5. Roll Admin back last through the normal pull-request-to-main flow. Recheck
   the homepage, GraphQL errors, request count, and one-rail invariant.

## Remove the temporary compatibility path

Create a follow-up roadmap ticket after deployment history proves no old Admin
revision can serve Web, Mobile, TV, or preview traffic. In that follow-up,
delete the legacy Watch Experience fragment and operations, switch native
queries back to the canonical fragment, delete both unknown-typename retry
paths, the `watchHomeCategoryRailCompatibility` result flag, and the fixed
compatibility section. Also delete the temporary Admin read fallback and its
`sync_state` marker after confirming the backfill is complete everywhere. Keep
supported-schema absent-block behavior authoritative throughout.
