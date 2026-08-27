# Environment and secret operations

This is the operator contract for Forge RAG configuration. Secret values move
only from an approved vault into the target process or service. Never paste a
value into a command, transcript, issue, PR, log, or committed env file.

## Fixed targets

| System  | Project     | Environment/config | Service     |
| ------- | ----------- | ------------------ | ----------- |
| Railway | `forge`     | `production`       | `forge-rag` |
| Doppler | `forge-rag` | `prd`              | n/a         |

If an operator sees a different target, stop. Creating the Railway service and
confirming these names is part of feat-425/feat-428; this ticket does not deploy
or create a database.

## Contract by operation

| Target                      | Required names                                                                   | Notes                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| local / CI                  | `DATABASE_URL`, `OPENROUTER_API_KEY`                                             | CI uses non-secret placeholders and no network.                                                                                   |
| Railway service             | local/CI names plus `SERVE_BEARER_TOKENS`; Railway injects `PORT`                | Bearer JSON maps one token per consumer to source keys; `["*"]` means all.                                                        |
| gateway-primary embedding   | `EMBED_BASE_URL`, `EMBED_API_KEY`; optional `EMBED_WIRE_MODEL_ID`                | `EMBED_MODEL_ID` remains the canonical row identity.                                                                              |
| Firecrawl source            | `FIRECRAWL_API_KEY`                                                              | Required only when that source selects Firecrawl.                                                                                 |
| smoke                       | `SMOKE_BASE_URL`, `SMOKE_TOKEN`; optional `SMOKE_MAX_MS`                         | The token goes only in the Authorization header.                                                                                  |
| dashboard production read   | `JFRAG_POSTGRESQL_DB_URL`                                                        | Generic `DATABASE_URL` is rejected unless a developer explicitly requests a dev preview.                                          |
| production maintenance/eval | `JFRAG_POSTGRESQL_DB_URL`, `JFRAG_OPENROUTER_API_KEY`, optional namespaced model | A write also requires exact `JFRAG_ALLOW_PROD_WRITE=1` and `JFRAG_EXPECTED_POSTGRES_HOST` matching the database hostname exactly. |

The only automatic namespaced fallback is
`JFRAG_OPENROUTER_API_KEY` → `OPENROUTER_API_KEY`. Do not add automatic
fallbacks for the production database, model, or bearer registry: that boundary
prevents a vault-wrapped local command from silently targeting production.
Empty or whitespace optional values are treated as unset.

Validate without printing values:

```sh
pnpm --filter @forge/rag env:check:ci
pnpm --filter @forge/rag env:check local
railway run --project <forge-project-id> --environment production --service forge-rag --no-local -- pnpm --filter @forge/rag env:check railway
doppler run --project forge-rag --config prd -- pnpm --filter @forge/rag env:check production-read
```

Replace `<forge-project-id>` with the immutable ID for the `forge` project and
confirm the CLI-selected project before running the command. `railway run`
fetches variables from that exact receiver; `--no-local` disables Railway local
overrides, while injected receiver values still take precedence over package
env files. The last two commands succeed only after their receiver has been
provisioned.
Do not use `doppler secrets get`, `printenv`, `env`, or shell echo commands for
preflight. A valid check prints only target and status.

## Provisioning (receiver first)

1. Confirm the fixed target identifiers above and the owning operator.
2. Generate a distinct random bearer per consumer outside the agent session.
   Record the owner, allowed source keys, creation date, rotation due date, and
   revocation state without recording the bearer.
3. Add namespaced values to Doppler `forge-rag/prd`. Keep gateway values under
   their plain names because they are environment-agnostic. Never add plain
   `DATABASE_URL` or `EMBED_MODEL_ID` to this Doppler config.
4. Provision Railway `forge/production/forge-rag` as the receiver with its
   database, provider, gateway (if enabled), Firecrawl (if needed), and bearer
   registry names. Do not trigger a deployment from the local checkout.
5. After the Forge service code has merged and Railway autodeploy is healthy,
   run the production-read validation and a live smoke with secrets injected by
   the vault. Only then provision callers with their matching token.
6. Record redacted evidence: target identifiers, variable names present,
   validation result, deployment identifier, health/smoke result, and owner.

## Rotation and revocation

Rotate receiver-first: add the new token to `SERVE_BEARER_TOKENS`, let the
normal PR-to-main/autodeploy path make the receiver accept it, update one caller,
smoke that caller, then remove the old token and verify it is rejected. For an
emergency revoke, remove the compromised token from the receiver first, accept
the caller outage, rotate the caller, and smoke recovery. Rotate provider keys by
adding/validating the replacement before revoking the old key. Database rotation
must retain a tested rollback credential until the migration soak expires.

Evidence must contain names and outcomes only—never values, connection strings,
Authorization headers, corpus text, or raw exception objects.

## Temporary dual-target names

Feat-433 will implement explicit `:jfrag` and `:forge` VM/NanoClaw tasks. Its
secret stores should use `JFRAG_RAG_BASE_URL` / `JFRAG_RAG_BEARER_TOKEN` for the
legacy receiver and `FORGE_RAG_BASE_URL` / `FORGE_RAG_BEARER_TOKEN` for the new
receiver. Any task dispatcher must require `RAG_OPS_TARGET=jfrag|forge`; the
unqualified/default task stays on `jfrag` until cutover approval. Writable tasks
must never infer a target.

Seeker keeps its existing caller contract and switches these atomically in
feat-434: `JESUSFILM_RAG_BASE_URL`, `JESUSFILM_RAG_ALLOWED_HOSTS`, and the
matching API key. Preserve the old values out of band for rollback.
