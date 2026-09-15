# Subtitle translation gold-standard evaluation

This package evaluates the production Mastra subtitle translation and retiming
implementation against a fixed set of human-produced Core subtitle tracks. It
has two execution surfaces:

- an offline developer CLI that prepares/runs/scores local artifacts; and
- the protected one-cell `POST /forge-subtitle-translation-eval` workflow used
  by Manager's cloud Subtitle Quality Lab.

Neither surface publishes subtitles, changes a production prompt/model, deploys
code, or treats automatic metrics as human approval. The cloud path never
refetches Core: Manager supplies already-frozen bytes and Mastra verifies their
packaged identities before reading provider credentials.

## Corpus

The committed `manifest.json` defines five representative clips and four
shared target languages:

| Case                         | Collection            | Core video           | Edition           | Clip        |
| ---------------------------- | --------------------- | -------------------- | ----------------- | ----------- |
| JESUS — John the Baptist     | Jesus Film            | `1_jf-0-0`           | `jl`              | 08:00–10:00 |
| Magdalena — Love and Samaria | Magdalena             | `1_wl60-0-0`         | `wl60`            | 18:15–20:00 |
| #FallingPlates               | Short Films           | `2_0-FallingPlates`  | `0-FallingPlates` | 00:07–03:55 |
| Where You Belong             | Global Football Event | `2_0-WhereYouBelong` | `base`            | 00:00–01:25 |
| The Simple Gospel            | New Believer Course   | `8_NBC01`            | `base`            | 00:01–03:05 |

The shared target set is German (`de`), Spanish (`es`), French (`fr`), and
Russian (`ru`). Source and reference tracks are selected by exact Core video,
edition id, edition label, and Core language id.

Core tracks are Forge's human-produced subtitle source, but the manifest is
deliberately `referenceAuthority=provisional` until a content curator certifies
the selected editions, reference quality, and reuse rights. Change it to
`approved` only as a reviewed corpus-identity change.

LUMO is not in this reference corpus because the current Core inventory has no
subtitle rows for LUMO-family video ids. LUMO can become a separately labeled
scripture-fidelity challenge set, or join this corpus after human references
are acquired; canonical Bible text is not a substitute for a timed human VTT.

## Prepare and lock references

Raw VTT bodies are downloaded to the gitignored
`.mastra/subtitle-translation-eval/corpus/` directory. The committed lock stores
only public Core row identity, URLs, timestamps, cue counts, and SHA-256
checksums.

To verify the current remote bytes against the committed lock:

```bash
pnpm --filter @forge/mastra eval:subtitles:prepare
```

If Core metadata or bytes drift, preparation refuses the corpus. After
reviewing an intentional upstream change, refresh the lock explicitly:

```bash
pnpm --filter @forge/mastra eval:subtitles:prepare -- --refresh-lock
```

Never commit the downloaded VTT directory.

## Run the offline CLI

The evaluator converts the human English VTT to the same transcript segment
shape consumed by `runSubtitleEnrichment`, then invokes that production runtime
with local in-memory artifact I/O. This isolates translation/retiming from ASR.
It still uses production scripture-context detection, translation, retiming,
fallback, and scripture-validation behavior.

Start with one cell because a full matrix makes paid provider calls. Configure
the key in the same shell/Codex session that launches the command:

```bash
export OPENROUTER_API_PAID_KEY='<secret from the approved secret manager>'
pnpm --filter @forge/mastra eval:subtitles:run -- \
  --case=where-you-belong \
  --language=es
```

`OPENROUTER_API_PAID_KEY` is preferred; `OPENROUTER_API_KEY` is the legacy
fallback. Do not paste either value into chat, an issue, a report, or this
repository. If Codex or the development server was already launched from a
different terminal, restart it from the shell where the variable is exported
so its process inherits the key. On Railway, set the variable as a Mastra
service secret instead of placing it in a file.

Omit `--case` and `--language` to run all 20 cells. Comma-separated filters are
accepted. `--model`, `--timeout-ms`, `--concurrency`, and `--output-dir` can be
overridden. The default model is the production subtitle model. Runs write
`report.json`, `report.md`, and generated VTTs beneath the gitignored
`.mastra/subtitle-translation-eval/runs/` directory.

To score an already-generated VTT without a model call:

```bash
pnpm --filter @forge/mastra eval:subtitles:score -- \
  --case=where-you-belong \
  --language=es \
  --candidate=/absolute/path/to/subtitles-es.vtt
```

## Reading the report

Hard structural checks cover parseability, cue ordering, overlap, duration,
clip bounds, adjacent duplication, and coverage of source speech. The source
coverage floor is calibrated to the human reference when that reference itself
falls below the preferred 95%, so the gate cannot demand alignment the gold
track does not provide. Deterministic
diagnostics include character n-gram similarity, 30-second-window similarity,
length ratio, reference timing overlap, boundary error, characters per second,
and line length.

Text similarity is not a publication gate. Human translations are not unique,
and a fluent candidate can differ substantially from the reference. Use the
generated Markdown as a triage report, then have a native speaker complete a
copy of `human-review.template.json` while watching the clip. Review meaning,
naturalness, established terminology and names, readability, omissions,
additions, and scripture/theology. Any fabricated content, material omission,
or critical scripture/theology error is terminal regardless of an aggregate
automatic score.

The offline report records the corpus hashes, model, code revision,
dirty-worktree state, runtime-policy source hash, timeout, concurrency,
translation/retiming token usage, and retiming fallback count. As a known
offline limitation, scripture detection/validation usage and provider-call
identity are not projected into that aggregate report.

The cloud cell path has the stronger evidence contract. Each OpenRouter attempt
emits a bounded identity row: operation and sequence, chunk/attempt, status,
canonical request digest, provider response/generation ID and resolved model
when exposed, plus token usage when complete. Its per-operation usage includes
scripture detection, translation, retiming, and scripture validation and marks
coverage gaps explicitly. Raw prompts, credentials, provider bodies, and raw
provider errors are not report evidence.

Optional API.Bible passage retrieval is not an OpenRouter model call. Its
request/response identity is not captured in the provider-call ledger, so cloud
reports explicitly list that as a reproducibility limit. A complete OpenRouter
call vector does not make API.Bible evidence byte-reproducible.

## Cloud Lab runbook

Manager, not a human browser, calls the cloud route with a bearer matching
Mastra's `MASTRA_SERVICE_API_KEYS`. Each request is exactly one frozen
case-language cell, concurrency 1, with the source-controlled model, prompt,
workflow-policy, manifest, and lock allowlists. Manager creates the Admin run
and spend reservation before dispatch, stores returned candidate/review/report
bytes under content-addressed Railway S3 keys, and finalizes the immutable Admin
report. A missing provider key returns `provider_config_missing`; identity drift
returns a deterministic preflight failure before paid work.

The cloud provider receives subtitle text, target language, and packaged
translation context. It does not receive contributor identity, qualifications,
scores, review notes, or corrections. Human review happens later through
Manager's assignment-scoped review surface.

For local no-network verification, use tests/lint/typecheck and optionally
score a VTT already on disk:

```bash
pnpm --filter @forge/mastra test
pnpm --filter @forge/mastra lint
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/mastra eval:subtitles:score -- \
  --case=where-you-belong \
  --language=es \
  --candidate=/absolute/path/to/subtitles-es.vtt
```

`eval:subtitles:prepare` calls Core and `eval:subtitles:run` calls OpenRouter;
do not include either in a no-network/no-paid smoke. Local corpus and run bytes
remain below the gitignored `.mastra/subtitle-translation-eval/` tree and have
no automatic cleanup. Never commit them; handle local deletion under the
owner-approved subtitle/contributor retention policy.

## Relationship to Mastra Evaluation

This is a domain-specific offline harness rather than a native Mastra Dataset
or Scorer. Subtitle evaluation needs VTT parsing, time-window alignment, and
native-language review that the existing Seeker/search scorers do not provide.
The useful experiment-ledger patterns still apply: frozen identity, immutable
attempt evidence, human terminal verdicts, and a separate production-promotion
change. A native Evaluation projection can be added later without changing the
corpus or scoring contracts.
