---
id: "feat-323"
title: "Prompt experiment workflow — labels, records, promotion, leak guards"
owner: "jaco"
priority: "P2"
status: "not-started"
start_date: "2026-08-05"
duration: 3
depends_on:
  - "feat-322"
blocks: []
tags:
  - "ai-pipeline"
---

## Problem

feat-322 gives us a way to **measure** a system prompt. It does not give us a way to
**change one on purpose**.

Today there is no answer to any of these:

- Why was this prompt changed? What were we trying to fix?
- Which prompt version did we test, and against what?
- Did it work? Where is the evidence?
- Who decided to promote it, and to which environment?
- What happened to the experiments that failed? (These are the most valuable records and
  the first ones lost.)

There is also a security problem that only appears once prompts start being iterated on.
**`JesusFilm/forge` is public.** The managed prompt in Langfuse is deliberately secret —
that is a main reason for using Langfuse at all. But an eval suite naturally produces
artifacts, and some of those artifacts would leak the prompt if committed carelessly. We
need the boundary drawn explicitly and enforced mechanically, not remembered.

This ticket is the workflow layer: an experiment record, a label convention, a promotion
path, and the guards that stop the secret half leaking into a public repo.

**Read `docs/plans/2026-07-28-002-feat-seeker-prompt-eval-suite-plan.md` first** — its
D14 carries the two-prompt rule and the commit-safety table this ticket enforces.

## Entry Points — Read These First

1. **`docs/roadmap/ai-chat/feat-322-seeker-prompt-eval-suite.md` — Decision 0.**
   The two-prompt rule. `SEEKER_FALLBACK_PROMPT` is public by design, never evaluated, and
   **exempt from every guard in this ticket**. The Langfuse-managed prompt is secret and
   subject to all of them. Getting this backwards breaks either security or the build.

2. **`docs/plans/2026-07-28-002-feat-seeker-prompt-eval-suite-plan.md` — D14.**
   The commit-safety table: what may land in a public repo and what may not. The short
   version — commit scores, answers, judge quotes and hashes; never commit prompt text or a
   prompt diff.

3. **`apps/mastra/src/services/langfuse-prompt-client.ts:735`** — `getManagedPrompt`.
   Returns `{ text, source, version?, resolvedLabel, ... }`. Label resolution order is
   `call param > LANGFUSE_PROMPT_DEFAULT_LABEL > "production"`. **Version pinning as an
   input does not exist** (feat-272 item 4) — labels are the only handle, which is why the
   `exp-*` convention below must treat them as immutable by discipline.

4. **`apps/mastra/evals/results/<experimentId>/<timestamp>/`** — the per-run output layout
   feat-322 establishes. This ticket gives `experimentId` its meaning.

5. **`.github/workflows/ci.yml`** — where the leak check job lands. Note that neither
   existing workflow runs any eval; this check is a cheap grep job, not an eval run.

6. **`docs/roadmap/ai-chat/feat-272-seeker-langfuse-managed-prompt-integration.md:103-108`**
   — the composition split. Only the tunable persona half lives in Langfuse; the SAFETY line
   and citation rules stay code-owned and public. The guards must not flag those.

## Grep These

```bash
# Where prompt text could leak from — every writer of eval artifacts
grep -rn "writeFile\|writeFileSync" apps/mastra/src/services/prompt-eval/

# Confirm results never carry prompt text (must return nothing after a run)
grep -rn "promptText" apps/mastra/evals/

# The fallback constant that every guard must allowlist
grep -rn "SEEKER_FALLBACK_PROMPT" apps/mastra/src

# Existing CI jobs, to place the new one alongside
grep -n "jobs:" -A 40 .github/workflows/ci.yml

# Existing label handling
grep -n "resolvedLabel\|promptDefaultLabel" apps/mastra/src/services/langfuse-prompt-client.ts
```

## What To Build

### 1. Label convention

You already have `development`, `stage`, `production`. Add one tier below them.

| Label                                  | Meaning                             | Mutable?                                |
| -------------------------------------- | ----------------------------------- | --------------------------------------- |
| `exp-004`                              | Candidate prompt for experiment 004 | **No.** Points at one version, forever. |
| `development` / `stage` / `production` | Environment labels                  | Yes — reassigned on promotion           |

Rules:

- An experiment label is created when the experiment starts and is **never re-pointed**.
  Langfuse does not enforce this; it is our discipline, and the experiment record is what
  makes a violation visible.
- The eval always runs **`exp-NNN` against the incumbent** (`production` normally, or
  `development` if that is where the team promotes first). Never `production` against
  `production`.
- On acceptance, the _version_ behind `exp-NNN` is promoted by adding the environment
  label to it. `exp-NNN` stays where it is.
- On failure, nothing is promoted and `exp-NNN` stays as the record of what was tried.

This answers "which version do we eval on": never a moving label — always the experiment
label against the incumbent.

### 2. Experiment record

`docs/experiments/EXP-NNN-<slug>.md`, committed. Public, and safe to be public.

```markdown
---
id: "EXP-004"
status: "running" # running | accepted | failed | abandoned
opened: "2026-08-06"
closed: ""
langfuse_label: "exp-004"
baseline_label: "production"
promoted_to: [] # e.g. ["development", "stage"]
---

## Hypothesis

What behaviour we are trying to change, and why we think the current prompt causes it.
One paragraph. Describe the BEHAVIOUR, never the instruction wording.

## Parameters

- Models swept: <list>
- Scenario set version: <id>
- Judge model: <slug>
- Prompt versions: exp-004 → Langfuse v7 (sha256 abc123…); baseline → v5 (sha256 def456…)

## Runs

- `apps/mastra/evals/results/EXP-004/2026-08-06T09-14-22Z/`

## Outcome

Which scenarios and categories moved, in which direction, by how much. Cite the run
directory. State the verdict and the reasoning behind it.

## Decision

Accepted / failed, who decided, and what was promoted where.
```

**The hypothesis describes behaviour, not wording.** "Grief responses read cold" is fine.
Quoting the instruction line is not — that is prompt text.

Add `docs/experiments/README.md`: the format, the numbering rule, and a one-line index of
every experiment with its verdict. Failed experiments stay in the index permanently.

### 3. Promotion path

A short documented sequence, not code:

1. Experiment accepted, recorded in the experiment doc.
2. In Langfuse, add the `development` label to the experiment's version.
3. Soak. Then add `stage`. Then `production`.
4. Update `promoted_to` in the experiment record in the same change.
5. Rollback is re-pointing the environment label at the previous version — record that as
   a new line in the experiment's Decision section, never by editing history.

### 4. Leak guards

Three, cheapest first. Together they enforce D14's table.

**(a) Runner-side — the structural guard.** feat-322 already forbids `promptText` in
`results.json`. Add a unit test asserting the serialiser drops it even when handed a result
object that carries it. A structural guard beats a grep.

**(b) CI sentinel check** — a new job in `.github/workflows/ci.yml`:

- Greps `apps/mastra/evals/results/**` and `docs/experiments/**` for sentinel substrings
  drawn from the managed prompt.
- **Allowlist `SEEKER_FALLBACK_PROMPT` and its file** (`seeker-system-prompt.ts`). That text
  is public by design; flagging it is a false positive and "fixing" it would be wrong.
- The sentinel list itself must not be a copy of the prompt. Use short distinctive
  substrings, stored as a hash list where practical, and never as committed plaintext of
  the managed prompt.

⚠️ **Open design point for the implementer:** a sentinel list is inherently awkward in a
public repo — the list itself hints at the content. If a hash-only approach proves
impractical, the fallback is (a) plus (c) alone, and the CI job is dropped. Record whichever
call is made and why. Do not ship a job that leaks what it is protecting.

**(c) Review-time rule** — one line in `apps/mastra/CLAUDE.md` and in
`docs/experiments/README.md`:

> Never paste managed-prompt text or a prompt diff into a PR, an issue, or an experiment
> record. Reference it by Langfuse version and `sha256`.

### 5. Wire the experiment id through

`--experiment=EXP-004` on the feat-322 CLI sets the results directory. Without it, runs land
under `adhoc/`. The runner writes the resolved label, version and `sha256` for **both** arms
into `results.json`, so an experiment record can cite them without anyone retyping them.

## Constraints

- **Do not put prompt text in this repo.** Not in experiment records, not in results, not
  in PR descriptions, not in commit messages. Reference by version + `sha256`.
- **Do not apply leak guards to `SEEKER_FALLBACK_PROMPT`.** It is public by design
  (feat-322 Decision 0). Allowlist it explicitly and comment why.
- **Do not re-point an `exp-*` label.** It is the immutable record of what was tested.
- **Do not evaluate `production` against `production`.** Arms must differ.
- **Do not build a UI, a dashboard, or automation for promotion.** Promotion is a human
  action in Langfuse plus a doc edit. Automating it is a later ticket if it is ever one.
- **Do not delete failed experiment records.** They are the highest-value artifact here.
- **Do not run evals in CI.** Unchanged from feat-322 — the CI job added here is a grep.

## Verification

1. **A full dry run of the workflow.** Open `EXP-001` against a real experiment label,
   run the eval, record the outcome, mark it accepted or failed, promote if accepted. The
   experiment doc and the run directory reference each other correctly.

2. **Leak guard catches a real leak.** Deliberately paste a managed-prompt sentence into a
   scratch file under `docs/experiments/` and confirm CI fails. Remove it.

3. **Leak guard does NOT flag the fallback.** `SEEKER_FALLBACK_PROMPT` and
   `seeker-system-prompt.ts` are present in the repo and CI is green. Falsify this by
   temporarily removing the allowlist entry and confirming the job then fails — a guard
   whose allowlist is never exercised is untested.

4. **Serialiser drops prompt text.** Unit test hands the reporter a result object carrying
   `promptText` and asserts it is absent from the written JSON.

5. **`grep -rn "promptText" apps/mastra/evals/` returns nothing** after a real run.

6. **Both arms are recorded.** `results.json` carries label, version and `sha256` for the
   experiment arm and the baseline arm.

7. **A failed experiment survives.** Close one as `failed` and confirm it stays in the
   `docs/experiments/README.md` index with its verdict.
