-- A playlist can exist only while its Auth-owned lifecycle projection exists.
-- This database boundary closes the create/erasure race: a committed create is
-- cascaded by erasure, while a create that loses the race fails inside its
-- transaction so the quota increment rolls back with it.

ALTER TABLE "user_playlist"
  ADD CONSTRAINT "user_playlist_owner_subject_fkey"
  FOREIGN KEY ("owner_subject") REFERENCES "consumer_lifecycle_projection"("owner_subject")
  ON DELETE CASCADE ON UPDATE CASCADE;
