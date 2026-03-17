# Contributing

This project follows a **plan-doc-first workflow**. All work requires a scoped plan doc before code changes begin.

## Workflow

1. **Create/update a plan doc** in `docs/<scope>/plans/`
2. **Branch** from `main`: `fix/<scope>-slug` or `feat/<scope>-slug`
3. **Commit** using conventional format (`feat:`, `fix:`, `chore:`, `docs:`)
4. **Open a PR** with the plan doc path in description
5. **Ensure CI passes** before requesting review

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
