# Watch homepage category rail rollout

This runbook moves the existing fixed Watch homepage category rail into the
authored `watchHomeCategoryRail` Experience block. It does not authorize a
direct Railway deploy. Ship every forward or rollback revision through the
normal pull-request-to-main flow; do not run `railway up` or trigger an ad hoc
service redeploy from a local checkout.

## Release invariants

- Admin's `0053_watch_home_category_rail_block` data migration must finish
  before the new Admin revision is considered healthy. It inserts one
  all-category block immediately after the first `watchHomeHero`, or first when
  no hero exists, for every valid canonical homepage and active homepage draft
  that does not already contain the block.
- The migration is idempotent and leaves non-homepages, historical revisions,
  malformed JSON, and already-authored category rails unchanged.
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

## Preflight

1. Confirm the release commit contains the Admin schema, generated
   `apps/admin/schema.graphql` and gql.tada output, migration `0053`, Web's new
   and legacy Watch fragments, and this runbook.
2. Run the migration contract test against a disposable PostgreSQL database,
   never production:

   ```sh
   WATCH_HOME_CATEGORY_RAIL_MIGRATION_DB_TEST=1 \
     DATABASE_URL='<disposable-postgres-url>' \
     pnpm --filter @forge/admin exec vitest run \
       src/services/watch-home-category-rail-migration.db.test.ts
   ```

3. Record current Admin and Web deployment revisions, homepage response status,
   and a desktop/mobile screenshot. Confirm the current page shows exactly one
   category rail.
4. Keep Experience editing disabled for the short interval between migration
   completion and the verification queries below. This makes the expected
   all-category order an unambiguous migration check.

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
3. Deploy Admin. Require migration `0053` to complete before accepting the
   revision as healthy.
4. New Web's first operation now succeeds, so it stops retrying, stops inserting
   the fixed rail, and renders the migrated authored block in its stored
   position.

### Admin first

1. Deploy Admin and require migration `0053` to complete before accepting the
   revision as healthy.
2. Old Web continues to render exactly one fixed rail; it does not render the
   new union member.
3. Run the migration verification below, then deploy Web.
4. New Web receives the authored block on its first request and renders exactly
   one rail with no compatibility retry.

## Migration verification

First verify Prisma recorded the migration successfully:

```sql
SELECT migration_name, started_at, finished_at, rolled_back_at
FROM _prisma_migrations
WHERE migration_name = '0053_watch_home_category_rail_block';
```

Require exactly one row with non-null `finished_at` and null `rolled_back_at`.
Do not manually rerun the production migration to test idempotence; the
disposable-PostgreSQL preflight test owns that proof.

Inspect rows the migration intentionally cannot rewrite. Both queries should
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
  AND locale.is_homepage = true
  AND jsonb_typeof(revision.snapshot #> '{data,blocks}')
      IS DISTINCT FROM 'array';
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
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(locale.blocks) = 'array' THEN locale.blocks
      ELSE '[]'::jsonb
    END
  )
    WITH ORDINALITY AS item(value, ordinality)
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
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(revision.snapshot #> '{data,blocks}') = 'array'
        THEN revision.snapshot #> '{data,blocks}'
      ELSE '[]'::jsonb
    END
  )
    WITH ORDINALITY AS item(value, ordinality)
  WHERE revision.entity_type = 'ExperienceLocale'
    AND revision.status = 'DRAFT'
    AND locale.is_homepage = true
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

After both return zero rows, query the homepage through Admin GraphQL and
confirm `blocks` includes one `WatchHomeCategoryRailBlock` with all 13 IDs.
Then load Web and confirm one successful Experience request, one visible rail,
and no compatibility retry. Re-enable editing and verify an admin can reorder
the block, curate tile membership/order, save, reopen, and preview the result.

## Rollback

Rollback must reverse the consumer dependency before removing the stored
discriminator.

1. Roll Web back first through the normal pull-request-to-main deployment flow.
   Verify old Web again renders exactly one fixed rail while new Admin remains
   live.
2. While new Admin can still read `watchHomeCategoryRail`, ship a reviewed
   rollback data migration that removes the discriminator from canonical
   homepages and active homepage drafts. The migration should use the following
   scoped transformation; do not run it as an unreviewed production console
   command:

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
     INNER JOIN experience_locale AS locale ON locale.id = revision.entity_id
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE
         WHEN jsonb_typeof(revision.snapshot #> '{data,blocks}') = 'array'
           THEN revision.snapshot #> '{data,blocks}'
         ELSE '[]'::jsonb
       END
     )
       WITH ORDINALITY AS item(value, ordinality)
     WHERE revision.entity_type = 'ExperienceLocale'
       AND revision.status = 'DRAFT'
       AND locale.is_homepage = true
       AND jsonb_typeof(revision.snapshot #> '{data,blocks}') = 'array'
       AND COALESCE(
         CASE
           WHEN jsonb_typeof(revision.snapshot #> '{data,isHomepage}') = 'boolean'
             THEN (revision.snapshot #>> '{data,isHomepage}')::boolean
           ELSE NULL
         END,
         locale.is_homepage
       ) = true
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
   ```

3. Require both of these read-only checks to return `0`:

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
   INNER JOIN experience_locale AS locale ON locale.id = revision.entity_id
   WHERE revision.entity_type = 'ExperienceLocale'
     AND revision.status = 'DRAFT'
     AND locale.is_homepage = true
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
   ```

4. Verify old Web's homepage query succeeds against new Admin and the fixed rail
   remains visible exactly once.
5. Roll Admin back last through the normal pull-request-to-main flow. Recheck
   the homepage, GraphQL errors, request count, and one-rail invariant.

## Remove the temporary compatibility path

Create a follow-up roadmap ticket after deployment history proves no old Admin
revision can serve Web traffic. In that follow-up, delete the legacy Watch
Experience fragment and operations, the unknown-typename retry detector, the
`watchHomeCategoryRailCompatibility` result flag, and the fixed compatibility
section. Keep supported-schema absent-block behavior authoritative throughout.
