ALTER TABLE session ADD COLUMN google_email TEXT, ADD COLUMN google_subject TEXT;
ALTER TABLE session ADD CONSTRAINT session_google_evidence
  CHECK ((google_email IS NULL) = (google_subject IS NULL));
CREATE INDEX changelog_preapproval_environment_id_email_state_idx
  ON changelog_preapproval (environment_id, email, state);
