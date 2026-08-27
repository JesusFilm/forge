# HTTP retrieval service

The Forge RAG exposes the same read-only `/v1` contract on its Railway public
and private addresses. Railway deployments come only from merged `main`; never
deploy a local checkout with `railway up`.

## Configure before enabling autodeploy

1. Connect `forge/production/forge-rag` to `JesusFilm/forge` on `main` with the
   repository root as its build context.
2. Set the config-as-code path to `apps/rag/railway.toml` and confirm Railway
   recognizes its build, pre-deploy, start, and healthcheck settings.
3. Set `DATABASE_URL` to the existing feat-425 PostgreSQL service reference.
4. Set `OPENROUTER_API_KEY`, `EMBED_MODEL_ID`, and
   `SERVE_BEARER_TOKENS`. The bearer value is a JSON map from a distinct random
   consumer token to a non-empty source-key list; `["*"]` is reserved for
   consumers approved for every source.
5. Do not set `PORT`; Railway injects it. Add gateway embedding variables only
   when this receiver is intentionally using that gateway.
6. Re-enable automatic deployments only after the source branch and variables
   are verified.

Cloudflare owns public-edge rate controls. The application additionally rejects
search bodies above 16 KiB and the shared schema caps query length and `topK`;
do not replace the edge control with per-process counters that diverge across
replicas.

## Verify after merge and autodeploy

Confirm the deployment logs show the configured
`pnpm --filter @forge/rag db:migrate:deploy` pre-deploy command completing before
the HTTP start command. This verifies existing schema ownership; it does not
provision or replace the database.

Run the environment preflight without printing any values:

```sh
railway run --project 98952497-a4d9-4714-8fe8-0cdbff3147c9 --environment production --service forge-rag --no-local -- pnpm --filter @forge/rag env:check railway
```

Inject `SMOKE_TOKEN` through the operator environment, then run the smoke once
against the public HTTPS origin and once against the Railway-private origin:

```sh
SMOKE_BASE_URL=https://public.example.invalid pnpm --filter @forge/rag smoke
SMOKE_BASE_URL=http://forge-rag.railway.internal:8080 pnpm --filter @forge/rag smoke
```

For a source-scoped token, set `SMOKE_FORBIDDEN_SOURCE_KEY` to a real source the
token is not permitted to access. Once the baseline query returns at least one
in-scope result, the probe proves that request scope cannot widen token scope.
On the empty feat-425 corpus, both searches return a contract-valid empty
`results` array, so the probe exercises the scoped path but reports the scope
proof as inconclusive. The application tests provide the empty-corpus scope
guarantee; repeat the smoke after the corpus copy with a positive baseline to
collect deployment evidence.

Record only statuses, timestamps, deployment identifiers, and result counts.
Never record URLs containing credentials, bearer values, authorization headers,
connection strings, or corpus text.
