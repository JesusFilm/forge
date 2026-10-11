# Kickoff prompt

Copy the prompt below into a new Codex chat attached to the Forge project. The
prompt authorizes that chat to create and manage implementation chats; creating
this file has not started them. Full Access is a host/app permission setting,
not something prose or the create-thread model field can grant.

---

Act as the orchestrator for the Precomputed Video Recommendation Experiment in
JesusFilm/forge. Execute the approved spec and tickets through a reviewed,
verified integration PR. The product interview, testing boundaries, and ticket
breakdown are approved. Start work without another planning interview.

## Authority and workflow

I authorize you to create separate **GPT-6 Sol Codex chats**, send them ticket
assignments and follow-ups, manage their isolated worktrees, integrate their
commits, update issue/PR progress, and resolve implementation and CI failures.
Give the workers full development autonomy using the permissions available on
this host. Use Full Access where the app supports it; never claim to have changed
a permission setting that you cannot control or verify. Ask only for genuinely
missing external input, an unavailable required permission, or a material new
product decision, while continuing any independent work.

Use the exact worker model **`gpt-6-sol`**. Do not substitute Astra or GPT-6.1 Sol
for these development chats. If that model is unavailable, report the blocker.
The model used inside the application remains **`gpt-6-astra`**, as specified.

**Do not invoke Compound Engineering skills anywhere in this effort**, directly
or indirectly: no `ce-*` skills, `compound-engineering/*` skills, `lfg`, or
Compound Engineering review agents. This explicit user instruction overrides
the repository's default Compound Engineering workflow. Follow its remaining
architecture, security, schema-generation, testing, and deployment conventions.

Each worker must use Matt Pocock's skill at
`/home/nisal/.codex/skills/implement/SKILL.md`, which uses the distinct Matt
Pocock skills at `/home/nisal/.codex/skills/tdd/SKILL.md` and
`/home/nisal/.codex/skills/code-review/SKILL.md`. Load those exact files; a
similarly named Compound Engineering skill is not a substitute. Preserve the
Standards and Spec review axes. Follow the repository's sequential mapping for
review subagents where applicable; it does not override this explicit request
to create separate implementation chats.

## Canonical work and approved tests

Read the full parent spec and every child issue, including current comments and
native parent/dependency relationships, before dispatching work:

- Parent spec: https://github.com/JesusFilm/forge/issues/2565
- Repository: JesusFilm/forge; roadmap feature: feat-590.

| Ticket | Delivery                                   | Immediate blockers |
| ------ | ------------------------------------------ | ------------------ |
| #2566  | Admin comparison of saved recommendations  | None               |
| #2567  | Astra source recommendation generation     | #2566              |
| #2568  | Historical analytics in model decisions    | #2567              |
| #2569  | Resumable catalog builds and cost reports  | #2568              |
| #2570  | Private Watch serving                      | #2566              |
| #2571  | Stable A/B assignment and eligible visits  | #2570              |
| #2572  | Click attribution and clicked-visit counts | #2571              |
| #2573  | Durable CTR evaluation reports             | #2572              |
| #2574  | Bounded storage and loaded retention proof | #2569, #2573       |
| #2575  | Manual launch, promotion, and rollback     | #2574              |

The approved testing boundaries are **build through Admin review** and **Watch
delivery through experiment result**, using native PostgreSQL for transactional,
retention, and physical-storage claims, plus focused browser behavior/loading
checks. These are already approved; workers must not repeat the testing-seam
confirmation. Use behavior-first red/green slices where appropriate, regular
focused tests/typechecks, and the relevant full suites at ticket completion.

GitHub is the configured issue tracker and `ready-for-agent` is its readiness
label. Supply that context directly when a skill asks for tracker setup. Read
AGENTS.md, CLAUDE.md, applicable package guides, CONCEPTS.md, and relevant solutions;
do not restart setup merely because a particular tracker-help file is absent.

## Prepare the integration branch

1. Inspect existing chats, worktrees, branches, and PRs for this effort. Resume
   suitable work and record ownership so another chat cannot duplicate a ticket.
   Sandcastle has been removed; use Codex chats directly and track execution
   ownership in the orchestration ledger.
2. Fetch the current main branch and create or reuse an isolated integration
   checkout on **`codex/precomputed-video-recommendations`**. Preserve unrelated
   working-tree edits. The planning checkout predates merged recommendation
   compression work; implement on current compatible main, retaining compact
   traces, packed snapshots, compact identities, and current retention fixes.
3. Keep the existing feat-590 roadmap entry as the feature-level record. The
   planning files are currently under `/home/nisal/forge/docs/`: the October 5
   precomputed-recommendations requirements, spec, ticket directory, this kickoff
   prompt, and the feat-590 content-discovery roadmap file. Bring only those
   task-owned documents into the integration checkout if they are not yet on
   main. Port only the recommendation glossary additions needed from CONCEPTS.md;
   do not overwrite unrelated glossary changes or copy the whole dirty checkout.
   GitHub issue bodies remain sufficient implementation context for fresh workers.
4. Record the initial base SHA, branch, worktree, PR, and ticket execution ledger
   in a small orchestration status document. After the first task-owned commit,
   push and create one draft integration PR against main, linking the parent and
   all ten child issues. Attach the PR to the current task using the app tool.

## Dispatch and integrate

Use the Codex app's **list_projects** and **create_thread** tools to create actual
chats. Select the saved Forge Git project. For every worker, set
`model: "gpt-6-sol"`, use an isolated project worktree starting from the existing
`codex/precomputed-video-recommendations` integration branch, and give it a title
containing its issue number. Do not replace the requested chats with internal
subagents or launch all tickets immediately. A queued clientThreadId is not a
resolved threadId; resolve it before sending follow-ups or waiting on that chat.

Start **#2566**. Once its work is integrated and verified, **#2567** and **#2570**
can run concurrently. Keep at most two implementation chats active; this graph
has two useful parallel paths. Dispatch a ticket only after every prerequisite
is integrated and verified on the integration branch. Account for actual shared
file/schema conflicts, coordinate ownership, and serialize conflicting edits.

For each worker, send a self-contained assignment containing:

- The exact ticket URL and parent spec URL, its acceptance criteria, and the
  integrated prerequisite commits.
- Its worktree, assigned feature branch, captured starting SHA, and explicit
  ownership of that ticket's implementation and tests. Derive worker branches
  as `codex/feat-590-<issue-number>`.
- The Matt Pocock implement/tdd/code-review skill paths and the no-Compound-
  Engineering instruction above. Include that instruction directly in every
  worker prompt, not only behind a link.
- The already approved testing boundaries and GitHub tracker context. Pass the
  captured starting SHA as code-review's fixed point so it does not ask for one.
- A statement that other workers share the repository and it must not revert
  their work. It owns its worktree and branch, not the integration branch, main,
  shared roadmap status, or unrelated tickets.
- Instructions to implement, test, review both axes, fix findings, and commit
  its ticket; then report commit SHAs, changed surfaces, acceptance evidence,
  exact checks/results, migrations/contracts, and remaining external blockers.
  No separate worker PR or merge to main is needed.

Wait using **wait_threads** with per-thread cursors and bounded waits. Read full
thread output only when needed; use **send_message_to_thread** to return a
specific failure or missing acceptance item to its owning Sol chat. Reuse the
same chat for fixes. Keep user updates concise and focused on decisions/results.

Integrate completed worker commits **serially** into the integration branch,
resolve conflicts by intent, and run the affected combined checks before marking
the ticket integrated. Completion requires acceptance evidence, not merely a
worker's claim or a commit. Give newly unblocked workers the updated integration
state. Do not rewrite another active worker's worktree underneath it.

Native GitHub blockers can remain open until the integration PR merges. Use the
execution ledger's **integrated-and-verified** state to advance this branch's
task graph; do not deadlock waiting for issue closure or close issues prematurely
just to unlock work. Keep implemented, integrated, merged, and live states distinct.

## Preserve the agreed boundaries

Keep the incumbent available, all public experimental serving default-off, and
BigQuery exports out of scope. Historical warehouse reads remain included. Keep
database storage minimal and bounded, including runtime logs/checkpoints; no
silent six-edge storage quota, evidence sampling, or retention shortening.

Code, migrations, tests, commits, draft PRs, and CI repairs are authorized.
Production deployment, starting public A/B traffic, promoting a winner, and
enabling a refresh schedule remain separate explicit operations under the spec.
Do not merge to main, deploy directly, activate public traffic, or fabricate live
data/cost/capacity evidence to finish a ticket. The original manual activation
decision remains in force despite full development permissions.

If warehouse/model access, trusted bot signals, real volume measurements, or
numeric stopping-rule agreement is missing, name the exact missing input and
continue independent work with clearly labeled fixtures. A fixture is not proof
of a live run. If the missing input prevents an acceptance criterion from being
verified, keep that criterion and ticket incomplete and report the limitation.

## Finish

After integration, run Matt Pocock's code-review against the captured integration
base for the whole spec. Fix findings through the owning Sol chats. Run the
required combined suites, schema-generation/drift checks, migration/retention
checks, and browser loading verification, then keep fixing relevant CI failures
until the PR checks pass. Avoid rerunning broad suites without a new change or
failure that justifies it.

Mark the PR ready for review only when the implementation and required checks
are complete. Keep the roadmap and ticket states truthful about remaining live
prerequisites and deployment. Preserve useful worktrees until their commits are
integrated and no outstanding fixes need them.

Return the PR link, a concise acceptance/test summary, current issue status,
required external inputs, and any separate launch steps. If an external blocker
prevents completion, finish independent work and report precisely what remains;
do not label the whole experiment complete. Begin now by reading the spec and
ticket graph, establishing the integration checkout, and dispatching the first
GPT-6 Sol chat.
