-- Homepage rendering context, separate from the live homepage assignment
-- (`is_homepage`). Additive with a constant default, so Postgres records it as
-- catalog metadata without rewriting the table; existing rows keep today's
-- behaviour.
SET lock_timeout = '5000ms';
ALTER TABLE "experience_locale"
  ADD COLUMN "homepage_layout" BOOLEAN NOT NULL DEFAULT false;
