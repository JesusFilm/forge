# System Of Record

This directory is the repository-backed knowledge base for completed GitHub work items.

## Structure

- `index.md`: catalog of migrated artifacts.
- `migration-manifest.json`: idempotent migration state and checksums.
- `issues/`: normalized issue artifacts.
- `plans/`: normalized plan artifacts.
- `templates/`: canonical markdown templates used by migration.

## Usage

1. Run migration:
   - `pnpm docs:migrate`
   - optional linked PR enrichment: `MIGRATION_LOOKUP_PRS=1 pnpm docs:migrate`
2. Validate outputs:
   - `pnpm docs:validate`

Both commands are safe to run repeatedly.
