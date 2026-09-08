-- Assignment is part of the already immutable issued lease. Unassigned historic
-- leases remain valid; there is no separate worker registry or claim authority.
ALTER TABLE studio_render_lease
 ADD COLUMN pool_id VARCHAR(128),
 ADD COLUMN worker_id VARCHAR(128),
 ADD COLUMN dispatch_id UUID,
 ADD CONSTRAINT studio_render_lease_assignment_complete CHECK (
   (pool_id IS NULL AND worker_id IS NULL AND dispatch_id IS NULL) OR
   (pool_id IS NOT NULL AND worker_id IS NOT NULL AND dispatch_id IS NOT NULL
    AND length(pool_id) > 0 AND length(worker_id) > 0)
 );
CREATE UNIQUE INDEX studio_render_lease_dispatch_id_key ON studio_render_lease(dispatch_id);
CREATE INDEX studio_render_lease_pool_id_worker_id_expires_at_idx ON studio_render_lease(pool_id,worker_id,expires_at);
