Kick off the compound engineering work loop for: `$ARGUMENTS`.

Follow project rules in `CLAUDE.md` and `AGENTS.md`.

## Required argument format

Use:

`/work <scope> <task>`

Allowed scopes:

- `web`
- `mobile`
- `cms`
- `graphql`
- `platform`
- `manager`

If `$ARGUMENTS` is missing a valid scope, stop and return:

1. the error (`scope required`)
2. expected format
3. one corrected example command

## Plugin preflight (must run before work)

1. Verify the compound-engineering skills are available: `ce-plan`, `ce-work`,
   `ce-code-review`, `ce-compound`. They are listed as available skills once the
   plugin is loaded, and are invoked as `/ce-plan`, `/ce-work`,
   `/ce-code-review`, `/ce-compound` (plugin-qualified:
   `compound-engineering:ce-plan`).
   - Hyphens, not colons. Pre-3.x docs called these `ce:plan` / `ce:review`;
     those names do not resolve, and the review skill was renamed
     `ce-code-review` — there is no `ce-review`.
2. If unavailable, stop and return install instructions:
   - Claude Code:
     - `claude plugin marketplace add https://github.com/EveryInc/compound-engineering-plugin.git`
     - `claude plugin install compound-engineering@compound-engineering-plugin --scope user -y`
     - Restart the session — plugins load at session start, so a fresh install
       is not visible to the session that ran the command.
   - Cursor: `/add-plugin compound-engineering`
   - Optional Context7 key:
     - `export CONTEXT7_API_KEY=your_key_here`
   - Optional browser tooling:
     - `npm install -g agent-browser`
     - `agent-browser install`
3. Resume only after plugin is installed.

### If the plugin is installed but the skills are still missing

Plugins are registered per Claude config directory (`CLAUDE_CONFIG_DIR`, default
`~/.claude`). A machine running more than one Claude instance for account
separation has one plugin registry per instance, so a plugin installed under one
is genuinely absent from the other — the symptom is an empty
`$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json` while another config dir has
the plugin cached.

Check which registry the running session uses, then install into that one:

```bash
echo "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
cat "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/installed_plugins.json"
CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}" claude plugin list
```

Install with `--scope user` rather than the default project scope: this repo is
worked in through many `.t3` / `.codex` git worktrees, and a project-scoped
install has to be repeated in every one.

## Steps

1. Plan

- Run `ce-plan` semantics for the provided scope and task.
- Set explicit scope and acceptance criteria.
- Identify affected folders/packages.

2. Work

- Implement using `ce-work` semantics.
- Keep changes inside scope unless explicitly broadened.

3. Review

- Run `ce-code-review` semantics.
- Resolve actionable findings before completion.

4. Compound

- Run `ce-compound` semantics.
- Save reusable learnings under `docs/solutions/<category>/`.

## Output format

Return:

- scope
- files changed
- validation run
- follow-up tasks (if any)
