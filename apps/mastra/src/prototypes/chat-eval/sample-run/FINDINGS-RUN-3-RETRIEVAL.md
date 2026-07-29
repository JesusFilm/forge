# Third run — with retrieval, 2026-07-29

The first run of this prototype that measures the **shipped** prompt: all 13
lines including the ten `retrieveAnswer` rules, with a real tool-calling loop and
real passages from the local RAG.

18 cells, 0 failures, **$0.13**. Corpus snapshot `4909d1b97c9b`, topK 5.

## How it works

`proto:capture-rag` queries a running JesusFilm RAG once per question and records
exactly what `retrieveAnswer` would hand the model — the same
`{ status, sources: [{ text, sourceName, title, url, score }], message? }` shape,
same 4,000-codepoint passage truncation, same `empty` / `unavailable` collapse.

`proto:answers --with-retrieval` then runs a **genuine tool loop**: the model
receives the tool definition, decides to call it, and the fixture comes back as a
`role: "tool"` message with a matching `tool_call_id`. This is deliberately not
passage text pasted into the prompt — models behave differently when material
arrives as a tool result, and pre-injection would not be measuring production.

The corpus fingerprint is in run identity, so a re-index can never be mistaken
for a prompt regression.

---

## 1. The citation rules work — and only exist in this mode

**31 URLs cited across 18 answers. Zero were unretrievable.** Every source the
models named was in the passages they were actually given.

That is the prompt's central discipline — _"never cite a source name or URL that
is not present in a retrieveAnswer result"_ — and the prompt-only eval could not
observe it at all, because that rule was one of the ten lines it stripped out.

## 2. Scripture-from-memory more than halved

|                 | answers citing scripture |
| --------------- | ------------------------ |
| prompt-only run | **8 / 18**               |
| with retrieval  | **3 / 18**               |

Same questions, same models. The grounding rules do real work; without them the
models fall back on training data and the eval calls it fine.

## 3. The `empty` path works, and it fixed the scope failure

The Python-library question retrieved **zero passages** — a genuine `empty`
status, not a synthetic one. All three models then declined correctly:

> "I don't have a grounded answer for that one — this tool is set up to help with
> questions about Jesus, faith, and Christianity, and it returned no relevant
> material…" — sonnet-5

In the prompt-only run, **sonnet-5 answered this question and named PyPDF2.**
With retrieval present it declines. The scope failure the earlier run reported as
a prompt defect is substantially a _missing-tool_ artefact.

This is the clearest evidence that prompt-only scores do not transfer.

## 4. Production's failover model skips the tool

**gemma-26b did not call `retrieveAnswer` on 3 of its 6 questions** — including
the grief question and the suffering question — despite the prompt's first
instruction being _"Always call the retrieveAnswer tool, no matter what the user
asks."_

gemma-31b and sonnet-5 called it every time.

`gemma-4-26b-a4b-it` is `seeker-agent.ts:123`, the model production falls back to
whenever the primary errors — which, on the free tier, is often. When it is
answering, roughly half of its replies may be ungrounded while the prompt claims
otherwise.

This is a production finding, not an eval finding, and it is the second one this
prototype has surfaced.

## 5. Every model reformulates the query

Not one passed the question through verbatim:

| question       | model     | query the model chose                                  |
| -------------- | --------- | ------------------------------------------------------ |
| q-suffering    | gemma-31b | "why does God allow children to suffer?"               |
| q-suffering    | sonnet-5  | "Why does God allow children to suffer if he is good?" |
| q-grief-father | gemma-31b | "What happens to people who did not go to church…"     |

Sensible reformulations here, but it means **the model's retrieval quality is
part of what is being measured**, and a model that reformulates badly retrieves
badly. Every cell in this run is marked `fixture-fallback` for that reason — the
harness records the distinction rather than hiding it.

For a fully faithful v2, capture fixtures keyed on the model's own query with the
RAG live, and treat exact-match rate as a reported metric.

---

## What this changes

The earlier runs measured **persona and tone on 20% of the prompt**. This one
measures the whole thing. Two of the earlier "findings" partly dissolve under
retrieval (the scope failure, the scripture invention), and one new production
defect appears that prompt-only testing structurally could not see.

feat-322's decision to defer retrieval was defensible — it keeps a red cell
attributable to the prompt rather than the corpus. But the cost is now measured,
not assumed: **a prompt-only suite cannot observe the majority of the prompt, and
its scores do not transfer.** The corpus-snapshot fingerprint in run identity is
what makes retrieval-enabled runs safe to compare, and it is cheap.

Recommendation: **run both.** Prompt-only for fast iteration on persona wording;
retrieval-enabled as the gate before any prompt ships, since that is the only
mode that can see the grounding contract.

## Still open

The judge criteria were written for the prompt-only mode. Retrieval mode needs
grounding criteria checked **in code** — every cited URL and source name against
the passages actually served — rather than by the LLM judge, which passed 17 of
17 on invented scripture last run. The URL check above is that mechanism, and it
belongs in the harness rather than in an ad-hoc script.
