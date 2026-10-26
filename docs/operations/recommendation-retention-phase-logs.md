# Recommendation retention phase failure logs

The Admin worker emits a bounded diagnostic only for a genuine retention failure:

```text
[recommendations] event=recommendation_retention_phase_failure payload=<compact JSON>
```

The payload contains code-owned phase and stage labels, rounded timings, normalized error classes/codes, terminal and fallback outcomes, and the prior-minute suppression count. It contains no SQL, raw error text, request IDs, viewer IDs, or profile IDs. At most 16 events are emitted per process per minute; the durable run ledger remains authoritative for every failure.

For a **bounded, read-only** Railway deployment-log window, pipe the CLI's JSON output to the parser. Supply the correct project, environment, worker service, deployment ID, and narrow times; keep the line limit finite:

```bash
railway logs <worker-deployment-id> --project <project-id> --environment production \
  --service <worker-service-id> --since <start-iso> --until <end-iso> \
  --lines 100 --filter recommendation_retention_phase_failure --json |
  pnpm --filter @forge/admin exec tsx scripts/parse-recommendation-retention-phase-logs.ts
```

The parser accepts only the exact envelope and version-1 allowlisted schema, emits only validated payloads, and caps input at 1,000 lines and output at 100 events. `--allow-legacy-json` explicitly enables the older leading-JSON format during a deployment transition. Do not save or paste unparsed provider output. A zero-event result is **not** proof that no failure occurred: compare both durable and workflow ledgers, the actual serving revision and deployment time, provider-log coverage, and the parser's inspected count. Even a complete phase record does not identify an individual slow SQL statement inside a phase with multiple queries.
