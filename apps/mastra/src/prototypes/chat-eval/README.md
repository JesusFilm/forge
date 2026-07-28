# chat-eval — throwaway prototype

**This is a prototype, not production code.** It exists to settle design questions
before `feat-322` (Seeker system-prompt eval suite) is written properly. Nothing
here is imported by anything. It lives outside `src/mastra/**` so it can never
reach the Mastra bundle.

## What it is meant to settle

1. **Does a quote-required judge actually work?** The ticket proposes a judge that
   returns `satisfied`/`violated` per criterion _and must quote the words that prove
   it_. That is the biggest unproven assumption in the plan. `--mode=verdicts`.
2. **Is it better than plain dimension scores?** The house pattern
   (`services/devotional/safety-gate.ts`) instead asks for 0–1 scores per named
   dimension. `--mode=scores` runs that design over the **same saved answers**, so
   the two can be compared head to head for free.
3. **Which answering model should we demo on?** Today's production chain is two free
   Gemma models. Step 1 alone (read the answers) may answer this without any judge.
4. **Is the judge stable?** Run step 2 twice on identical input and diff.

## The one design decision that matters

**Answer capture and judging are separate steps with a file in between.** Answers are
slow and cost money; the rubric is the uncertain part. Capture answers once, then
re-judge them as many times as you like for cents.

## Deliberately not here

Langfuse, benchmark/promotion flow, CI, the `retrieveAnswer` tool, Mastra workflows,
service wiring, committed-results conventions. All of that is ticket material.

## Vocabulary

- **answering model** — runs the system prompt against a question, produces the answer
  under test. (The ticket calls this "the subject".)
- **judge model** — scores that answer against criteria. Never the same model.

## Run it

Needs `OPENROUTER_API_KEY` (or `OPENROUTER_API_PAID_KEY`) in the environment.

```bash
# Step 1 — capture answers (questions x models). Writes answers.json.
pnpm --filter @forge/mastra proto:answers

# smoke first: one question, one model, ~1 call
pnpm --filter @forge/mastra proto:answers -- --limit=1 --models=google/gemma-4-31b-it:free

# Step 2 — judge the saved answers. Re-runnable, cheap.
pnpm --filter @forge/mastra proto:judge -- --mode=verdicts
pnpm --filter @forge/mastra proto:judge -- --mode=scores

# Step 3 — render a grid you can read.
pnpm --filter @forge/mastra proto:report
```

Output lands in `apps/mastra/prototype-runs/chat-eval/` (gitignored).
Use `--out=` / `--in=` to point elsewhere.

## Known finding, recorded up front

The live seeker prompt is **13 lines, 10 of which are about the `retrieveAnswer`
tool.** Strip the tool-coupled lines — which you must, since v1 evaluates without
retrieval — and three lines remain. See `prompt.ts`. That is a finding about the
prompt, not a bug in the harness, and the real ticket has to decide what it means to
"evaluate the prompt" when most of the prompt is tool protocol.
