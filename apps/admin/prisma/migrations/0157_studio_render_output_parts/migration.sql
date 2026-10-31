-- Preserve historical render/manifest retention and admit only bounded issued output parts.
CREATE OR REPLACE FUNCTION short_attach_render_asset() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recorded JSONB; render_attempt TEXT; render_lease TEXT;
BEGIN
 recorded := NEW.metadata #> '{provenance,recorded}';
 IF recorded->>'profileId' IS NULL OR recorded->>'profileId' NOT IN (
   'studio-render-1/900s-2cpu-2g-128p-96child-128m',
   'studio-render-2/1200s-180prep-2cpu-2g-128p-96child-128m',
   'studio-render-3/3600s-180prep-2cpu-2g-128p-96child-128m'
 ) THEN RETURN NEW; END IF;
 -- Attribution is not producer authority. Human/browser registrations cannot
 -- manufacture operational edges even with copied render metadata.
 IF NEW.actor->>'kind' IS DISTINCT FROM 'service' OR NEW.actor->>'id' IS DISTINCT FROM 'manager_backend'
 THEN RAISE EXCEPTION 'Trusted render producer required'; END IF;
 render_attempt := recorded->>'attemptId'; render_lease := recorded->>'leaseId';
 IF NEW.role NOT IN ('render','manifest','archive') OR render_attempt IS NULL OR render_lease IS NULL
 OR NOT EXISTS(SELECT 1 FROM short_render_lease lease JOIN short_attempt attempt ON attempt.id=lease.attempt_id
   JOIN short_render_job job ON job.attempt_id=lease.attempt_id
   WHERE lease.attempt_id=render_attempt AND lease.lease_id=render_lease AND attempt.kind='RENDER'
   AND job.snapshot #>> '{executionProfile,id}' = recorded->>'profileId')
 THEN RAISE EXCEPTION 'Issued render lease required'; END IF;
 -- Archive bytes are transport parts, never standalone rendered output authority.
 IF NEW.role = 'archive' THEN
   IF NEW.metadata #>> '{provenance,status}' IS DISTINCT FROM 'recorded'
   OR jsonb_typeof(recorded->'outputBytes') IS DISTINCT FROM 'number'
   OR jsonb_typeof(recorded->'partIndex') IS DISTINCT FROM 'number'
   OR jsonb_typeof(recorded->'partCount') IS DISTINCT FROM 'number'
   OR (recorded->>'outputDigest' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM TRUE
   OR (recorded->>'outputBytes' ~ '^[1-9][0-9]{0,8}$') IS DISTINCT FROM TRUE
   OR (recorded->>'partIndex' ~ '^[0-7]$') IS DISTINCT FROM TRUE
   OR (recorded->>'partCount' ~ '^[1-8]$') IS DISTINCT FROM TRUE
   THEN RAISE EXCEPTION 'Invalid render output part'; END IF;
   IF (recorded->>'outputBytes')::bigint > 134217728
   OR (recorded->>'partIndex')::int >= (recorded->>'partCount')::int
   OR (recorded->>'partCount')::int <> ceil((recorded->>'outputBytes')::numeric / 16777216)
   OR NOT EXISTS(SELECT 1 FROM media_asset media JOIN short_render_job job ON job.attempt_id=render_attempt
     WHERE media.id=NEW.media_asset_id AND media.mime_type='application/octet-stream'
     AND media.original_filename=render_attempt||'-part-'||(recorded->>'partIndex')||'.bin'
     AND media.byte_size=least(16777216::bigint,
       (recorded->>'outputBytes')::bigint-(recorded->>'partIndex')::bigint*16777216)
     AND job.snapshot->>'inputHash'=recorded->>'inputHash')
   THEN RAISE EXCEPTION 'Invalid render output part'; END IF;
 END IF;
 INSERT INTO short_render_retained_asset(attempt_id,lease_id,asset_version_id)
 VALUES(render_attempt,render_lease,NEW.id);
 PERFORM short_retain_references(jsonb_build_object('assetId',NEW.asset_id,'versionId',NEW.id,'digest',NEW.digest),
   'SHORT_RENDER_RETENTION',render_attempt||':'||render_lease);
 RETURN NEW;
END $$;
