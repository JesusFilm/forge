-- Experience AI chat panel — conversational threads tied to a single
-- ExperienceLocale, with messages capturing role, content, optional provider
-- metadata, and snapshot/mutation envelopes for AI-driven edits.
--
-- ON DELETE CASCADE on the locale FK ensures threads + messages disappear
-- when the experience locale is removed. Multiple threads per locale are
-- allowed; underlying entity state remains shared (single ContentRevision
-- DRAFT per locale).

CREATE TYPE "ExperienceChatMessageRole" AS ENUM (
    'user',
    'assistant',
    'system'
);

CREATE TABLE "experience_chat_thread" (
    "id" TEXT NOT NULL,
    "experience_locale_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL,
    "last_message_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "experience_chat_thread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "experience_chat_message" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "role" "ExperienceChatMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "provider_kind" TEXT,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "snapshot_diff" JSONB,
    "mutations_applied" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "experience_chat_message_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "experience_chat_thread_locale_last_message_idx"
ON "experience_chat_thread"("experience_locale_id", "last_message_at" DESC);

CREATE INDEX "experience_chat_thread_created_by_idx"
ON "experience_chat_thread"("created_by_user_id");

CREATE INDEX "experience_chat_message_thread_created_idx"
ON "experience_chat_message"("thread_id", "created_at" ASC);

ALTER TABLE "experience_chat_thread"
ADD CONSTRAINT "experience_chat_thread_experience_locale_id_fkey"
FOREIGN KEY ("experience_locale_id") REFERENCES "experience_locale"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "experience_chat_thread"
ADD CONSTRAINT "experience_chat_thread_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "experience_chat_message"
ADD CONSTRAINT "experience_chat_message_thread_id_fkey"
FOREIGN KEY ("thread_id") REFERENCES "experience_chat_thread"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
