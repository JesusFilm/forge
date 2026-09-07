-- Delivery leases are separate from immutable human authorization/consumption.
CREATE TABLE studio_schedule_dispatch (
  authorization_id varchar(128) PRIMARY KEY REFERENCES studio_schedule_authorization(id) ON DELETE RESTRICT,
  state varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','RUNNING','RETRY','ACCEPTED','BLOCKED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_id uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error varchar(80),
  CHECK ((lease_id IS NULL) = (lease_expires_at IS NULL))
);
CREATE INDEX studio_schedule_dispatch_due ON studio_schedule_dispatch(next_attempt_at, authorization_id) WHERE state IN ('PENDING','RUNNING','RETRY');
