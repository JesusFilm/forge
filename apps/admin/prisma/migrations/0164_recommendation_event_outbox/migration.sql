CREATE TABLE recommendation_event_outbox_capacity (
  id integer PRIMARY KEY CHECK (id = 1),
  pending_events integer NOT NULL DEFAULT 0 CHECK (pending_events >= 0),
  pending_bytes bigint NOT NULL DEFAULT 0 CHECK (pending_bytes >= 0),
  max_events integer NOT NULL CHECK (max_events > 0),
  max_bytes bigint NOT NULL CHECK (max_bytes > 0)
);

CREATE TABLE recommendation_event_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family varchar(48) NOT NULL,
  logical_id varchar(191) NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  payload_digest char(64) NOT NULL,
  envelope jsonb NOT NULL,
  envelope_bytes integer NOT NULL CHECK (envelope_bytes > 0),
  expires_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  leased_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_event_outbox_identity_key UNIQUE (family, logical_id, revision),
  CONSTRAINT recommendation_event_outbox_lease_pair CHECK ((lease_token IS NULL) = (leased_until IS NULL))
);

CREATE INDEX recommendation_event_outbox_due_idx ON recommendation_event_outbox (due_at, created_at);
CREATE INDEX recommendation_event_outbox_expiry_idx ON recommendation_event_outbox (expires_at);
CREATE INDEX recommendation_event_outbox_lease_idx ON recommendation_event_outbox (leased_until);
