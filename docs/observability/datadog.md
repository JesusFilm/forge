# Datadog Observability

Forge uses Datadog for browser RUM, backend APM, runtime metrics, sourcemaps,
and eventually logs across production services.

## Datadog assets

Use the existing Datadog API key:

```text
Forge-production
```

Use the same key value for both runtime intake and sourcemap upload env vars:

```bash
DD_API_KEY=<Forge-production API key value>
DATADOG_API_KEY=<Forge-production API key value>
```

Create one Browser RUM application per browser app. For Admin:

```text
RUM app name: Forge Admin
RUM service:  forge-admin
Site:         datadoghq.com
```

Copy its Application ID and Client Token into the Admin Railway service.

## Datadog Agent on Railway

Backend APM traces need a Datadog Agent. The repo-owned service definition lives
in `infra/datadog-agent/`.

Create one Railway service in the existing `forge` project production
environment:

```text
@forge/datadog-agent
```

Configure the service to deploy this repo with config-as-code path:

```text
infra/datadog-agent/railway.toml
```

Set these variables on the Datadog Agent service:

```bash
DD_API_KEY=<Forge-production API key value>
DD_SITE=datadoghq.com
DD_APM_ENABLED=true
DD_APM_NON_LOCAL_TRAFFIC=true
DD_DOGSTATSD_NON_LOCAL_TRAFFIC=true
DD_LOGS_ENABLED=true
DD_LOGS_CONFIG_CONTAINER_COLLECT_ALL=true
DD_BIND_HOST=::1
```

Do not expose the Agent publicly. App services should use Railway private
networking. Railway documents private service hostnames through
`RAILWAY_PRIVATE_DOMAIN` reference variables, and Datadog documents container
tracers sending traces to the Agent host on port `8126`.

## Admin production variables

Set these on the Admin production Railway service.

```bash
# Datadog Agent transport
DD_AGENT_HOST=${{@forge/datadog-agent.RAILWAY_PRIVATE_DOMAIN}}
DD_TRACE_AGENT_PORT=8126
DD_AGENT_SYSLOG_PORT=514

# Datadog API / site
DD_API_KEY=<Forge-production API key value>
DD_SITE=datadoghq.com

# Admin backend APM
DD_SERVICE=forge-admin
DD_ENV=prod
DD_LOGS_INJECTION=true
DD_RUNTIME_METRICS_ENABLED=true

# Admin browser RUM
NEXT_PUBLIC_DATADOG_APPLICATION_ID=<Forge Admin RUM application ID>
NEXT_PUBLIC_DATADOG_CLIENT_TOKEN=<Forge Admin RUM client token>
NEXT_PUBLIC_DATADOG_SITE=datadoghq.com
NEXT_PUBLIC_DATADOG_ENV=prod

# Admin browser sourcemaps
DATADOG_API_KEY=<Forge-production API key value>
DATADOG_SITE=datadoghq.com
```

Do not set `NODE_OPTIONS=--require dd-trace/init` as a Railway service
variable. Railway exposes service variables during the Railpack/mise build
phase, before `dd-trace` is guaranteed to exist. Admin's
`apps/admin/railway.toml` scopes the preload to runtime:

```bash
cd apps/admin && export DD_VERSION="${DD_VERSION:-$RAILWAY_GIT_COMMIT_SHA}" NEXT_PUBLIC_DATADOG_VERSION="${NEXT_PUBLIC_DATADOG_VERSION:-$RAILWAY_GIT_COMMIT_SHA}" DATADOG_RELEASE_VERSION="${DATADOG_RELEASE_VERSION:-$RAILWAY_GIT_COMMIT_SHA}" && HOSTNAME=0.0.0.0 NODE_OPTIONS='--require ./node_modules/dd-trace/init --max-old-space-size=5120' pnpm start
```

The dedicated Admin worker service should use config-as-code path
`apps/admin/railway.worker.toml`. It runs the same Admin Next server so
`src/instrumentation.ts` can start Postgres World, but only the worker service
should set `WORKFLOW_RUNNER_ENABLED=true`; admin web should leave it unset or
`false`.

Admin forwards server console logs to the Agent with syslog over UDP on the
private network. Railway does not expose sibling service stdout to the Agent
container, so `DD_LOGS_INJECTION=true` alone is not enough; the app must also
set `DD_AGENT_SYSLOG_PORT=514` and run code with `DD_AGENT_HOST` present. The
forwarder preserves normal Railway stdout and sends a second copy to Datadog
with `service`, `env`, `version`, and active trace/span ids when available.

Because the Agent service name contains `/`, prefer Railway's variable
autocomplete when setting `DD_AGENT_HOST`; it will insert the exact reference
syntax Railway expects for `@forge/datadog-agent.RAILWAY_PRIVATE_DOMAIN`.

Do not define the release identity vars as Railway reference variables to
`RAILWAY_GIT_COMMIT_SHA`; Railway-provided git vars are available inside the
build/runtime process, but service-variable aliases to them can resolve empty.
The Admin Railway config stamps these release vars directly from
`RAILWAY_GIT_COMMIT_SHA` in both build and start commands:

```bash
DD_VERSION="${DD_VERSION:-$RAILWAY_GIT_COMMIT_SHA}"
NEXT_PUBLIC_DATADOG_VERSION="${NEXT_PUBLIC_DATADOG_VERSION:-$RAILWAY_GIT_COMMIT_SHA}"
DATADOG_RELEASE_VERSION="${DATADOG_RELEASE_VERSION:-$RAILWAY_GIT_COMMIT_SHA}"
```

## Admin sourcemap upload

Admin's Railway config-as-code runs the browser sourcemap upload immediately
after the production build when `DATADOG_API_KEY` or `DD_API_KEY` is available.
To run the same upload manually, use:

```bash
pnpm --filter @forge/admin datadog:sourcemaps
```

The upload script uses service `forge-admin`, release version
`DATADOG_RELEASE_VERSION`, and minified path prefix `/_next/static/`. Keep
`DATADOG_RELEASE_VERSION`, `NEXT_PUBLIC_DATADOG_VERSION`, and
`RAILWAY_GIT_COMMIT_SHA` aligned through the Railway build/start command stamps
so RUM events and uploaded maps share the same release identity.

## Web production variables

Set these on the Web production Railway service when enabling Watch server logs
and Watch RUM:

```bash
# Datadog Agent transport
DD_AGENT_HOST=${{@forge/datadog-agent.RAILWAY_PRIVATE_DOMAIN}}
DD_TRACE_AGENT_PORT=8126
DD_AGENT_SYSLOG_PORT=514

# Web backend APM/logs
DD_SERVICE=forge-web
DD_ENV=prod
DD_LOGS_INJECTION=true
DD_RUNTIME_METRICS_ENABLED=true

# Watch browser RUM
NEXT_PUBLIC_DATADOG_APPLICATION_ID=<Forge Watch RUM application ID>
NEXT_PUBLIC_DATADOG_CLIENT_TOKEN=<Forge Watch RUM client token>
NEXT_PUBLIC_DATADOG_SITE=datadoghq.com
NEXT_PUBLIC_DATADOG_ENV=prod

# Watch browser sourcemaps
DATADOG_API_KEY=<Forge-production API key value>
DATADOG_SITE=datadoghq.com
```

`apps/web/src/instrumentation.ts` configures Datadog only in the Next.js Node
runtime. Watch search analytics use structured `forge-web` logs as the
canonical every-search signal and RUM only for supplemental click context. See
`docs/operations/watch-search-analytics-datadog.md`.

Web's Railway config-as-code runs `pnpm --filter @forge/web datadog:sourcemaps`
after the production build when `DATADOG_API_KEY` or `DD_API_KEY` is present.
The upload script uses service `forge-web`, release version
`DATADOG_RELEASE_VERSION`, and minified path prefix `/watch/_next/static/`.
`apps/web/railway.toml` stamps `DD_VERSION`, `NEXT_PUBLIC_DATADOG_VERSION`, and
`DATADOG_RELEASE_VERSION` from `RAILWAY_GIT_COMMIT_SHA` inside the build and
runtime commands when those vars are unset or empty.

## TV production variables

`apps/tv` ships Datadog Mobile RUM + Logs + native crash as service `forge-tv`.
See the "Observability (Datadog)" section of `apps/tv/CLAUDE.md` for the tvOS
SDK patch caveat, the deliberately excluded `expo-datadog` plugin, and the
mobile site enum gotcha. Provision per EAS environment with `eas env:create`:

```bash
# RUM client token (pub..., bundle-safe) + application id from the Datadog RUM app
EXPO_PUBLIC_DATADOG_CLIENT_TOKEN=
EXPO_PUBLIC_DATADOG_APPLICATION_ID=
# Mobile site enum (US1, EU1, ...), NOT web's "datadoghq.com"
EXPO_PUBLIC_DATADOG_SITE=US1
# preview MUST set this explicitly: preview is a release build (__DEV__ false),
# so the unset default would tag external testers' sessions env:prod.
# development leaves it unset (defaults to development).
EXPO_PUBLIC_DATADOG_ENV=preview
# Leave unset; the SDK defaults to the app version.
EXPO_PUBLIC_DATADOG_VERSION=
```

Unprovisioned builds boot with telemetry disabled; dev builds log a
`[datadog] RUM disabled` warning so the gate is visible from Metro logs.

### TV symbol upload (feat-227)

`apps/tv/scripts/eas-build-on-success.sh` (wired via the `eas-build-on-success` package script) uploads iOS/tvOS dSYMs to Datadog after a successful EAS build so native crash stacks symbolicate. It runs on the build worker and is key-gated: no `DATADOG_API_KEY` means `exit 0` (keyless builds pass through), and every upload error is swallowed — a hook failure would fail the whole build. Provision the key as an EAS **secret** (`eas env:create ... --visibility secret`) for preview + production; it is a write credential, unlike the plaintext client token. The `eas-build-pre-install` hook stamps `EXPO_PUBLIC_DATADOG_VERSION` from the build's git SHA so sessions, crashes, and uploads share one build identity. The RN/Hermes source-map upload is staged (KTD-4): confirm the composed-map path on the first real keyed build, then wire `datadog-ci react-native upload`.

### TV activation runbook (feat-225 operational tail)

Credential values come from the "Forge TV" RUM application page (Digital
Experience -> RUM -> Applications). Use plaintext visibility: the values are
bundle-inlined by design, and `secret` visibility never reaches `EXPO_PUBLIC_*`
bundles at `eas update` time.

1. **Provision an environment** (repeat per environment; development omits
   `EXPO_PUBLIC_DATADOG_ENV`):

   ```bash
   cd apps/tv
   eas env:create --environment preview --name EXPO_PUBLIC_DATADOG_CLIENT_TOKEN --value pub... --visibility plaintext
   eas env:create --environment preview --name EXPO_PUBLIC_DATADOG_APPLICATION_ID --value <app-id> --visibility plaintext
   eas env:create --environment preview --name EXPO_PUBLIC_DATADOG_SITE --value US1 --visibility plaintext
   eas env:create --environment preview --name EXPO_PUBLIC_DATADOG_ENV --value preview --visibility plaintext
   eas env:list --environment preview
   ```

2. **Intake/usage alert**: the client token ships in the bundle by design, so a
   Datadog monitor on RUM event intake for `service:forge-tv` (threshold or
   anomaly) is the abuse-detection mechanism. Create it before real builds
   circulate.

3. **Android TV verification**: `eas build --profile preview --platform android`
   (APK link per `apps/tv/DISTRIBUTION.md`), install on a device or emulator
   (the pnpm SDK patch is iOS-only by design; Android needs none), confirm a
   session in RUM Explorer under `service:forge-tv env:preview`.

4. **Apple TV verification**: TestFlight via the `xcrun altool -t appletvos`
   path in `apps/tv/DISTRIBUTION.md` (NOT `eas submit`), confirm a session with
   mobile vitals from real hardware.

5. **Production (privacy-gated)**: obtain product/legal sign-off on
   `TrackingConsent.GRANTED` at 100% session sampling BEFORE provisioning the
   production environment, then repeat step 1 for `production` with
   `EXPO_PUBLIC_DATADOG_ENV` unset (release defaults to prod).

Steps 3-4's "confirm a session" checks are human-in-the-Datadog-UI today; the
agent-driven query recipe (Datadog MCP) that replaces the eyeball check is
scoped in `docs/roadmap/platform/feat-228-tv-perf-tooling-mcp-and-profiler.md`.

Playback note: the video player overlay is not a route, so playback telemetry
attributes to the underlying series/watch view. A dedicated player view is a
deliberate deferral, not an omission.

### TV ↔ web data parity (feat-228)

TV mirrors web's **non-sensitive** signals and deliberately skips the sensitive or inapplicable ones.

**Matched** (joinable with web dashboards): route/screen views, GraphQL resources, errors + native crashes, content-selection actions (stable `dd-action-name` on home/series/search cards), the per-search `watch_search` structured Log (web's canonical `@watch_search.*` shape), and the `watch_search.result_clicked` custom action.

**Deliberately unmatched** — three web signals TV does not collect:

- **Session Replay** — unsupported on tvOS (the SDK's WebView refs are patched out); never add it.
- **Server-side APM spans** — web has a server tier; TV is a client-only app with no server component to trace.
- **User-identity / PII** — web attaches `setUser` (email/name); TV has no accounts and stays anonymous (no `setUserInfo`).

**TV-only** (no web counterpart): video playback QoE (`video_playback.*` — TTFF, rebuffering, errors, completion) and Home focus-restore health (`focus.restore_failed`).

**Sampling normalization:** TV runs 100% session sampling (`TrackingConsent.GRANTED`); web samples RUM sessions at 50% (Session Replay at 10%). Absolute-count comparisons across the two apps must normalize for this — roughly web ×2 on session-derived counts.

## Datadog MCP for agents (feat-228)

Agents query `service:forge-tv` telemetry read-only via Datadog's hosted MCP, registered in the repo `.mcp.json` (`datadog` entry). OAuth on first connect; no API keys in the repo. Toolsets are `core` (RUM events, spans, traces) plus `error-tracking`, with every known write tool omitted so the grant is read-only — from error-tracking: `update_datadog_error_tracking_issue`, `manage_datadog_error_tracking_issue_comments`; from core: `create_datadog_notebook`, `edit_datadog_notebook`, `upsert_datadog_dashboard`. The endpoint is `/api/unstable/`, so re-verify the write-tool set against Datadog's `/mcp_server/tools/` reference whenever the query string changes.

Regression-hunt loop against `service:forge-tv`:

- `search_datadog_rum_events` — sessions, views, resources sliced by `version` (the per-build git SHA).
- `search_datadog_spans` / `get_datadog_trace` — the client-vs-server split via the RUM→admin-APM tracecontext link.
- `search_datadog_error_tracking_issues` — native crashes and reported errors.

"Did telemetry arrive in the last N minutes?" — query `search_datadog_rum_events` for `service:forge-tv` over the window, or `curl` the RUM search API with a read-scoped key. Provisioning (RUM app, tokens, monitors) stays in the Datadog UI; the MCP is read-only.

## Monitors as code (feat-240)

`infra/datadog-monitors/` holds repo-owned Datadog **monitors-as-code** — Monitor
API JSON payloads plus `create.sh` to apply them (operator supplies `DD_API_KEY` +
`DD_APP_KEY`). First set: the feat-240 fleet-ceiling alerts
(`event=fleet_ceiling.*` on `service:forge-admin`). Prefer adding new monitors
there over hand-creating them in the UI. Spec:
`docs/observability/fleet-ceiling-datadog-monitors.md`.

## Future app pattern

Reuse the `Forge-production` API key and `@forge/datadog-agent` Railway
service for production Forge apps. Give each app its own service name:

```text
forge-admin
forge-watch
forge-manager
forge-chat
forge-mobile
```

Browser apps should each get their own Datadog RUM application so sessions,
replays, and frontend performance can be scoped independently while still
correlating with backend traces through matching `service`, `env`, and
`version` tags.
