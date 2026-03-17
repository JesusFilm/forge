# Contributing

This project follows an **Every-style compound workflow**. All work uses Plan -> Work -> Review -> Compound.

## Workflow

1. **Plan**: create/update `docs/<scope>/plans/<name>.md`
2. **Work**: branch from `main`: `fix/<scope>-slug`, `feat/<scope>-slug`, `chore/<scope>-slug`, or `docs/<scope>-slug`
3. **Review**: run checks + address findings
4. **Compound**: update docs/rules with reusable lessons
5. **PR**: include plan path in description and ensure CI passes

## Branch naming

- `feat/<scope>-short-description` for features
- `fix/<scope>-short-description` for bug fixes
- `chore/<scope>-short-description` for maintenance tasks
- `docs/<scope>-short-description` for documentation updates

## PR expectations

- One PR = one scope
- Fill the PR template (Summary, Work Loop, Notes)
- Keep changes small and reviewable

## Lint

- **All**: `pnpm lint` runs Turbo lint across all workspaces; CI uses `--max-warnings=0`

Generated clients (`packages/graphql/**`) are excluded from lint.

## References

- [AGENTS.md](./AGENTS.md) - Agent operating rules and folder structure
- [.cursor/rules/project-context.mdc](.cursor/rules/project-context.mdc) - Loads project instructions from CLAUDE.md and AGENTS.md
