Kick off the compound engineering work loop for: `$ARGUMENTS`.

Follow project rules in `CLAUDE.md` and `AGENTS.md`.

## Steps

1. Plan

- Run `ce:plan` semantics for `$ARGUMENTS`.
- Set explicit scope and acceptance criteria.
- Identify affected folders/packages.

2. Work

- Implement using `ce:work` semantics.
- Keep changes inside bounded context unless explicitly broadened.

3. Review

- Run `ce:review` semantics.
- Resolve actionable findings before completion.

4. Compound

- Run `ce:compound` semantics.
- Save reusable learnings under `docs/solutions/<category>/`.

## Output format

Return:

- scope
- files changed
- validation run
- follow-up tasks (if any)
