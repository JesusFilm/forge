CREATE TYPE "ManagerRole" AS ENUM ('OPERATOR');

CREATE TABLE "manager_membership" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" "ManagerRole" NOT NULL DEFAULT 'OPERATOR',
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "manager_membership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "manager_membership_user_id_key" ON "manager_membership"("user_id");
CREATE INDEX "manager_membership_role_idx" ON "manager_membership"("role");
CREATE INDEX "manager_membership_revoked_at_idx" ON "manager_membership"("revoked_at");

ALTER TABLE "manager_membership"
  ADD CONSTRAINT "manager_membership_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
