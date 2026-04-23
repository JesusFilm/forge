# ce:review — feat-014 voiceover env contract

Run time: 2026-04-23T12:07:49Z

Mode: autofix

Scope reviewed:

- `apps/manager/src/services/voiceover.ts`
- `apps/manager/src/services/voiceover.test.ts`
- `apps/manager/src/config/env.ts`
- `apps/manager/.env.example`
- `apps/manager/CLAUDE.md`

Finding addressed:

- The voiceover service added `ELEVENLABS_API_KEY` to the validated manager env schema but still read `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` directly from `process.env`. This bypassed the manager package convention that env vars flow through `src/config/env.ts`.

Fix applied:

- Added optional `ELEVENLABS_VOICE_ID` to the validated manager env contract.
- Routed voiceover runtime config through lazy `env` loading while preserving injected test dependencies.
- Added a blank-language fallback test for the normalized ElevenLabs language code.
- Documented the ElevenLabs env vars in the manager package guide.

Validation:

- `git diff --check` passed.
- `pnpm --filter manager lint` could not run because the fresh `/tmp` clone has no `node_modules`.
- `pnpm --filter manager typecheck` could not run because dependencies are missing in the fresh `/tmp` clone.
- `pnpm --filter manager test -- ...` could not run because `npx` attempted to fetch `tsx` and DNS/network access is blocked.

Residual work:

- Re-run focused manager tests, lint, and typecheck in a dependency-installed Forge checkout.
- Re-push `feat/014-voiceover-tts-service` once GitHub/network access is available.
