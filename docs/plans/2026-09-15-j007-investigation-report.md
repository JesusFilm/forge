# J007 investigation, review and wiki handoff

## Delivery and repository findings

Documentation-only delivery on `docs/rag-consumer-access-usage-plan`:

- [Implementation plan](2026-09-15-001-feat-rag-consumer-access-usage-plan.md).
- [Planning record feat-501](../roadmap/rag/feat-501-rag-consumer-access-planning.md).
- [Access implementation feat-502](../roadmap/rag/feat-502-rag-consumer-access-lifecycle.md).
- [Observable delivery feat-503](../roadmap/rag/feat-503-rag-consumer-usage-visibility.md).
- [Hand-maintained RAG index](../roadmap/rag/README.md).

Inspected actual root AGENTS/CLAUDE, RAG and contract package guides, RAG lane
CLAUDE/index, existing plans/tickets, HTTP implementation, package-local secret
operations guide, shared vocabulary, relevant storage solution and `todos/`.
The highest existing roadmap filename ID was 500; allocated 501–503 across the
whole tree, not just RAG. Existing older ID collisions are outside this scope;
new IDs must each be unique. RAG has 27 pre-existing records. It is excluded
from viewer registration and root generated totals; only its local index changes.
Plans use `docs/plans/`; existing filenames vary, with dated descriptive
`*-plan.md` a common convention. No additional plan-local guide was found.

Current HTTP auth has source scopes but no stable identity/reporting path.
Seeker's in-tree client is not RAGBot. The package AGENTS operations reference
resolves under `apps/rag/docs/ops/`, not root `docs/ops/`.

## Review and durable learning

Applied the plan/work/review/compound sequence locally to this documentation
scope; no callable Compound Engineering workflow was available and no other
agent was launched. Review checked each J007 outcome against the plan and
separated completed planning from unimplemented access/reporting records.

Durable lesson: integration identity is insufficient evidence of observable use.
Give reporting its own ticket, explicit count semantics and coverage-health
contract, and require a real-client HTTP count-delta test. Shared credentials
cannot honestly attribute activity to individual integrations. A clean zero is
valid only for a known integration in a fully covered retained report window.

## Wiki blocker and prepared transactional payload

`/workspace/agent` does not exist in this VM (`ls` returned “No such file or
directory”). No transactional wiki-writer tool is exposed. Therefore no wiki
page or log was written, no alternate session filesystem was used, and controls
were not bypassed. The brief explicitly permits this proposed payload in Forge.
An authorized RAGBot session must load its wiki instructions and apply the page
and log through its transactional writer; do not directly copy files.

### Proposed page: Forge planning requests

Forge records planned work in `docs/plans/` and executable feature records in
`docs/roadmap/<lane>/feat-NNN-<slug>.md`. Plans describe scope, approach, risks,
decisions and verification. Roadmap records track delivery using YAML fields
`id`, `title`, `owner`, `priority`, `status`, `start_date`, `duration`,
`depends_on`, `blocks`, and `tags`. IDs are allocated globally as one above the
highest current feature ID. Dependencies must be reciprocal.

RAG uses the docs-only `docs/roadmap/rag/` lane. Maintain its README manually;
do not add it to public viewer registration or generated root roadmap totals.
Read current root and lane guidance first. Feature bodies include Problem,
Entry Points, Grep These, What To Build, Constraints and Verification. Completed
RAG tickets also need Resolution with the Forge PR link. Planning may be complete
while separate implementation tickets remain not-started.

Suggested request: “Create an implementation-ready Forge plan in `docs/plans/`
and the next globally allocated RAG roadmap ticket(s). Follow current Forge
and RAG lane guidance, update the lane index and reciprocal dependencies, name
unresolved decisions, and define acceptance and release verification. Deliver a
documentation-only draft PR; do not implement or deploy.”

Use “consumer integration/application with an accountable owner,” “stable
consumer ID,” “private bearer per integration/environment,” and “read-only usage
reporting with coverage verification.” Request observability as a separate
deliverable/dependency, not an implied outcome. J007's plan is
`docs/plans/2026-09-15-001-feat-rag-consumer-access-usage-plan.md`, with roadmap
records feat-501 (planning), feat-502 (access) and feat-503 (usage and dogfood).

### Proposed log entry

2026-09-15 — Documented Forge plan/roadmap conventions and request terminology
from J007's checkout inspection. Linked consumer access planning and separate
usage visibility delivery. Apply this entry only with the page transaction;
J007 itself could not access `/workspace/agent` or its transactional writer.

## Validation results

- PASS: changed-file Prettier 3.8.1 check and `git diff --check`.
- PASS: targeted validation of new ID uniqueness, required frontmatter,
  reciprocal dependencies, all 30 RAG index entries/status totals and relative
  Markdown link targets. The temporary validation script first matched evidence
  subdirectories as tickets; corrected it to match feature basenames and reran.
- PASS: both `scripts/check-hidden-roadmap-lanes.test.ts` tests and
  `scripts/check-hidden-roadmap-lanes.ts`. The checker warns about pre-existing
  public-lane records missing frontmatter; hidden-lane assertions pass.
- Tools were installed outside the worktree under `/tmp/j007-doc-tools` because
  this checkout has no dependencies or pnpm executable. Used the pinned Prettier
  version and tsx directly with gray-matter; no lockfile change. Configured Husky
  path `.husky/_` is absent; no hook was bypassed. Full format check run explicitly.

No runtime implementation, production request, credential issuance, corpus
operation or deployment was performed. Future release verification is specified,
not claimed complete.
