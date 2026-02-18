# Contributing

This project follows an **issue-first workflow**. All work requires a GitHub issue before code changes begin.

## Workflow

1. **Create an issue** using the bounded-context template
2. **Branch** from `main`: `fix/123-slug` or `feat/123-slug`
3. **Commit** using conventional format (`feat:`, `fix:`, `chore:`, `docs:`)
4. **Open a PR** with `Resolves #123` in description
5. **Ensure CI passes** before requesting review

## Branch naming

- `feat/123-short-description` for features
- `fix/123-short-description` for bug fixes

## PR expectations

- One PR = one bounded context
- Fill the PR template (Summary, Contracts Changed, Regeneration Required, Validation)
- Keep changes small and reviewable

## Lint

- **All**: `pnpm lint` runs Turbo lint across all workspaces (JS/TS, iOS, Android); CI uses `--max-warnings=0`
- **iOS only**: `cd mobile/ios && swiftlint lint` (requires SwiftLint: `brew install swiftlint`)
- **Android only**: `cd mobile/android && ./gradlew ktlintCheck`

Generated clients (`packages/graphql/**`) are excluded from lint.

## References

- [AGENTS.md](./AGENTS.md) - Agent operating rules and folder structure
- [GitHub Workflow Rule](.cursor/rules/gh-workflow.mdc) - Detailed workflow steps
