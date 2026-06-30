# Search Eval Reports

This directory stores sanitized full JSON search-eval reports that support
content-embedding migration decisions.

For the AI Gateway migration, every completed local migration eval run should
write its full machine-readable report here before production content vectors
are replaced. Passing reports document backfill readiness. Failed reports
document why production backfill is blocked. Runs that abort before a report can
exist should be recorded in the roadmap ticket instead.

Artifacts in this directory must not contain:

- API keys, bearer tokens, cookies, credentials, or service secrets
- IP addresses, user identifiers, caller key ids, or production trace rows
- Raw source text, raw query text, raw vectors, or raw provider payloads
- Production database dumps or scratch files unrelated to eval evidence

Keep reports portable and reviewable: include run ids, judge model,
calibration state, net win rate, comparable coverage counts, provider/backfill
provenance references, Tier-1 regression status, and gate/backfill readiness,
but keep sensitive raw inputs out of the committed JSON.

## AI Gateway Content Embedding Gate

Run the Mastra release gate from a prod-like local Admin restore after
gateway-backed content vectors have been generated:

```bash
pnpm --filter @forge/mastra eval:content-embedding-gate -- \
  --baseline-name=prod-seed-baseline-YYYY-MM-DD \
  --environment-label=local
```

The script writes a sanitized full JSON report to
`docs/search-eval-reports/<reportId>.json`. The report must have
`kind=content-search-eval-gate-report`, `gate.passFailState=passed`, an
assigned `gate.judgeModel`, non-skipped passing calibration, non-negative
`gate.netWinRate`, `gate.backfillReady=true`, and
`contentEmbeddingProvider` bound to `jesus-film-ai-gateway` / `embeddings` /
1536 native dimensions / 1536 final dimensions /
`transformVersion: null` before content replacement can proceed. The file name
must match `gate.reportId`.

Use the emitted JSON as the required Admin backfill gate:

```bash
pnpm --filter @forge/admin run-embeds \
  --pipeline=all \
  --transcript-mode=model-upgrade \
  --experience-mode=model-upgrade \
  --gate-report=docs/search-eval-reports/<reportId>.json
```

`--pipeline=all` now runs transcript plus experience content embeddings.
It refuses gate reports outside this directory and rejects minimal, stale, or
synthetic JSON that is missing the embedded comparison report, orchestrator
summary, zero-failure totals, or provider provenance.
