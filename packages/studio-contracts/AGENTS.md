# Studio contracts

Read `CLAUDE.md` when changing composition schemas or command envelopes.
Keep this package runtime-neutral: Zod and portable data only. Admin owns command
execution, authorization and persistence; renderers consume these contracts.
