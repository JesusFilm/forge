# Contributing

This project follows an **Every-style compound workflow**. All work uses Plan -> Work -> Review -> Compound.

## Workflow

1. **Plan**: create/update `docs/<scope>/plans/<name>.md`
2. **Work**: branch from `main`: `fix/<scope>-slug` or `feat/<scope>-slug`
3. **Review**: run checks + address findings
4. **Compound**: update docs/rules with reusable lessons
5. **PR**: include plan path in description and ensure CI passes

## Branch naming

- `feat/<scope>-short-description` for features
- `fix/<scope>-short-description` for bug fixes

## PR expectations

- One PR = one bounded context
- Fill the PR template (Summary, Contracts Changed, Regeneration Required, Validation)
- Keep changes small and reviewable

## Lint

- **All**: `pnpm lint` runs Turbo lint across all workspaces; CI uses `--max-warnings=0`

Generated clients (`packages/graphql/**`) are excluded from lint.

## References

- [AGENTS.md](./AGENTS.md) - Agent operating rules and folder structure
- [GitHub Workflow Rule](.cursor/rules/gh-workflow.mdc) - Detailed workflow steps
