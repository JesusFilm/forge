BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE watch_surface_issued_window (
  window_id uuid PRIMARY KEY,
  manifest_digest char(64) NOT NULL,
  surface varchar(40) NOT NULL,
  block varchar(40) NOT NULL,
  presentation varchar(40) NOT NULL,
  placement varchar(64) NOT NULL,
  issued_at timestamp(3) NOT NULL,
  expires_at timestamp(3) NOT NULL,
  item_count smallint NOT NULL CHECK (item_count BETWEEN 1 AND 100)
);
CREATE INDEX watch_surface_issued_window_expires_at_window_id_idx ON watch_surface_issued_window (expires_at, window_id);

CREATE TABLE watch_surface_issued_item (
  window_id uuid NOT NULL REFERENCES watch_surface_issued_window(window_id) ON DELETE CASCADE,
  position smallint NOT NULL,
  item_path varchar(512) NOT NULL,
  served_event_id uuid NOT NULL UNIQUE,
  PRIMARY KEY (window_id, position, item_path)
);

CREATE TABLE watch_surface_event_receipt (
  event_id uuid PRIMARY KEY,
  window_id uuid NOT NULL,
  exact_digest char(64) NOT NULL,
  group_digest char(64) NOT NULL,
  occurred_at timestamp(3) NOT NULL,
  received_at timestamp(3) NOT NULL,
  rank_id uuid NOT NULL,
  duplicate_count integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  expires_at timestamp(3) NOT NULL
);
CREATE INDEX watch_surface_event_receipt_rank_idx ON watch_surface_event_receipt (window_id, group_digest, occurred_at, received_at, rank_id);
CREATE INDEX watch_surface_event_receipt_expiry_idx ON watch_surface_event_receipt (expires_at, event_id);

COMMIT;
