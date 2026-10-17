-- Existing two-hour sessions retain their original expiry until their next sign-in.
ALTER TABLE portal_private.sessions
  ADD COLUMN absolute_expires_at timestamptz;

UPDATE portal_private.sessions
  SET absolute_expires_at = expires_at;

ALTER TABLE portal_private.sessions
  ALTER COLUMN absolute_expires_at SET NOT NULL,
  ALTER COLUMN absolute_expires_at SET DEFAULT (now() + interval '24 hours');
