-- Synthetic test database only. Never run against a deployed database.
CREATE ROLE feat527_writer_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'synthetic-only-test-password';
CREATE ROLE feat527_reader_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'synthetic-only-test-password';
GRANT USAGE ON SCHEMA consumer_private TO feat527_writer_test, feat527_reader_test;
GRANT SELECT, INSERT, UPDATE ON consumer_private.consumers, consumer_private.credentials TO feat527_writer_test;
GRANT SELECT, INSERT, DELETE ON consumer_private.members TO feat527_writer_test;
GRANT INSERT ON consumer_private.lifecycle_audit, consumer_private.allowlist_revisions TO feat527_writer_test;
GRANT SELECT ON consumer_private.consumers, consumer_private.credentials TO feat527_reader_test;
