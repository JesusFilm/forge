-- Correct the versioned profile identity without rewriting applied migration 0094.
CREATE OR REPLACE FUNCTION short_attach_render_asset() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recorded JSONB; render_attempt TEXT; render_lease TEXT;
BEGIN
 recorded := NEW.metadata #> '{provenance,recorded}';
 IF recorded->>'profileId' IS DISTINCT FROM 'studio-render-1/900s-2cpu-2g-128p-96child-128m' THEN RETURN NEW; END IF;
 -- Attribution is not producer authority. Human/browser registrations cannot
 -- manufacture operational edges even with copied render metadata.
 IF NEW.actor->>'kind' IS DISTINCT FROM 'service' OR NEW.actor->>'id' IS DISTINCT FROM 'manager_backend'
 THEN RAISE EXCEPTION 'Trusted render producer required'; END IF;
 render_attempt := recorded->>'attemptId'; render_lease := recorded->>'leaseId';
 IF NEW.role NOT IN ('render','manifest') OR render_attempt IS NULL OR render_lease IS NULL
 OR NOT EXISTS(SELECT 1 FROM short_render_lease lease JOIN short_attempt attempt ON attempt.id=lease.attempt_id
   WHERE lease.attempt_id=render_attempt AND lease.lease_id=render_lease AND attempt.kind='RENDER')
 THEN RAISE EXCEPTION 'Issued render lease required'; END IF;
 INSERT INTO short_render_retained_asset(attempt_id,lease_id,asset_version_id)
 VALUES(render_attempt,render_lease,NEW.id);
 PERFORM short_retain_references(jsonb_build_object('assetId',NEW.asset_id,'versionId',NEW.id,'digest',NEW.digest),
   'SHORT_RENDER_RETENTION',render_attempt||':'||render_lease);
 RETURN NEW;
END $$;
