# Approved workflow implementation coordination

The operator approved implementation, test boundaries, seven slices, and their
dependencies on 2026-09-23. This work follows plan → implementation → independent
review → durable learning; no Compound Engineering command provider is installed.

The untouched original planning files were archived before worktree creation at
`/home/tataihono/.local/share/forge/shorts-agent-workflow/approved-planning-original.tar.gz`
(SHA-256 `0e3647df5ffbd87ff5b4601ece41ffc0eededfd268f0d99385fba23370ffdbea`).
The original planning worktree and unrelated main-checkout files remain untouched.
Integration starts at current `origin/main`, `fdd34d12c`, on
`codex/shorts-agent-workflow`.

After a separate user-owned Next.js upgrade introduced unrelated changes into
existing worktrees, coordination moved to
`/home/tataihono/Developer/forge-shorts-agent-coordination` on
`codex/shorts-agent-workflow-integration`. Its commits advance the same remote PR
branch, `codex/shorts-agent-workflow`. The earlier worktrees and their unrelated
changes remain preserved. The portable-skill and client-qualification worktrees
were recreated cleanly as `forge-shorts-agent-547-portable` and
`forge-shorts-agent-548-clients`; the branch names below reflect those replacements.

| Slice                     | Roadmap  | Dependencies       | Branch                                |
| ------------------------- | -------- | ------------------ | ------------------------------------- |
| Connection/editing        | feat-542 | none               | codex/shorts-agent-542-connect        |
| Exact draft render        | feat-543 | feat-542           | codex/shorts-agent-543-render         |
| Bounded narration         | feat-544 | feat-542           | codex/shorts-agent-544-narration      |
| Sampled inspection        | feat-545 | feat-543           | codex/shorts-agent-545-inspection     |
| Human review/revision     | feat-546 | feat-543, feat-545 | codex/shorts-agent-546-review         |
| Portable skill            | feat-547 | feat-544, feat-546 | codex/shorts-agent-547-portable-skill |
| Real-client qualification | feat-548 | feat-547           | codex/shorts-agent-548-clients        |

Each implementation slice uses its own worktree. The coordinator integrates
commits and resolves shared contracts. Render and narration work run in parallel
after connection/editing provides their registry seam. Shared OAuth scopes remain
explicit consent; edit authority cannot acquire execution or human approval.

Validation uses offline installed locked dependencies, task-owned loopback
Postgres, deterministic paid-provider fakes, actual contained-render fixtures,
and independent review. Tests and transport probes do not substitute for real
Claude/Codex runs. Missing client or environment access stays explicit in the
qualification record and roadmap acceptance. Frontend changes require matched
browser/load evidence, with heavy inspection work outside page initialization.

No paid provider calls, production configuration mutations, deployments, merges,
or publication are authorized by this execution plan. Reviewable PRs follow the
normal PR-to-main release path.
