-- Mobile-session stamp: "mobile" for sessions created through mobile-only
-- entry points (native idToken sign-in, jfp self-RP callback).
ALTER TABLE "session" ADD COLUMN "client_kind" TEXT;
