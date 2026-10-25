# Studio contracts

Read `CLAUDE.md` when changing composition schemas or command envelopes.
Keep this package runtime-neutral: Zod and portable data only. Admin owns command
execution, authorization and persistence; renderers consume these contracts.

For asset identity, Content Packs, source materialization or experiment contracts,
read `docs/solutions/database-issues/studio-shared-assets-and-source-retention.md`
from the repository root before changing the portable shapes.
