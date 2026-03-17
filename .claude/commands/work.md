Kick off the compound engineering work loop for: `$ARGUMENTS`.

Follow project rules in `CLAUDE.md` and `AGENTS.md`.

## Required argument format

Use:

`/work <bounded-context> <task>`

Allowed bounded contexts:

- `web`
- `mobile`
- `cms`
- `graphql`
- `platform`

If `$ARGUMENTS` is missing a valid bounded context, stop and return:

1. the error (`bounded-context required`)
2. expected format
3. one corrected example command

## Plugin preflight (must run before work)

1. Verify compound commands are available (`ce:plan`, `ce:work`, `ce:review`, `ce:compound`).
2. If unavailable, stop and return install instructions:
   - Cursor: `/add-plugin compound-engineering`
   - Optional Context7 key:
     - `export CONTEXT7_API_KEY=your_key_here`
   - Optional browser tooling:
     - `npm install -g agent-browser`
     - `agent-browser install`
3. Resume only after plugin is installed.

## Steps

1. Plan

- Run `ce:plan` semantics for the provided bounded context and task.
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

- bounded context
- files changed
- validation run
- follow-up tasks (if any)
