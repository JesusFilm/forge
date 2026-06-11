CREATE TYPE "UserActorType" AS ENUM ('human', 'agent');

ALTER TABLE "user" ADD COLUMN "actor_type" "UserActorType" NOT NULL DEFAULT 'human';
ALTER TABLE "user" ADD COLUMN "expires_at" TIMESTAMP(3);

CREATE INDEX "user_actor_type_idx" ON "user"("actor_type");
CREATE INDEX "user_expires_at_idx" ON "user"("expires_at");
