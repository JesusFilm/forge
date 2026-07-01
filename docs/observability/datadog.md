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
DD_VERSION=${{RAILWAY_GIT_COMMIT_SHA}}
DD_LOGS_INJECTION=true
DD_RUNTIME_METRICS_ENABLED=true

# Admin browser RUM
NEXT_PUBLIC_DATADOG_APPLICATION_ID=<Forge Admin RUM application ID>
NEXT_PUBLIC_DATADOG_CLIENT_TOKEN=<Forge Admin RUM client token>
NEXT_PUBLIC_DATADOG_SITE=datadoghq.com
NEXT_PUBLIC_DATADOG_ENV=prod
NEXT_PUBLIC_DATADOG_VERSION=${{RAILWAY_GIT_COMMIT_SHA}}

# Admin browser sourcemaps
DATADOG_API_KEY=<Forge-production API key value>
DATADOG_SITE=datadoghq.com
DATADOG_RELEASE_VERSION=${{RAILWAY_GIT_COMMIT_SHA}}
```

Do not set `NODE_OPTIONS=--require dd-trace/init` as a Railway service
variable. Railway exposes service variables during the Railpack/mise build
phase, before `dd-trace` is guaranteed to exist. Admin's
`apps/admin/railway.toml` scopes the preload to runtime:

```bash
HOSTNAME=0.0.0.0 NODE_OPTIONS='--require dd-trace/init' node apps/admin/.next/standalone/apps/admin/server.js
```

Admin forwards server console logs to the Agent with syslog over UDP on the
private network. Railway does not expose sibling service stdout to the Agent
container, so `DD_LOGS_INJECTION=true` alone is not enough; the app must also
set `DD_AGENT_SYSLOG_PORT=514` and run code with `DD_AGENT_HOST` present. The
forwarder preserves normal Railway stdout and sends a second copy to Datadog
with `service`, `env`, `version`, and active trace/span ids when available.

Because the Agent service name contains `/`, prefer Railway's variable
autocomplete when setting `DD_AGENT_HOST`; it will insert the exact reference
syntax Railway expects for `@forge/datadog-agent.RAILWAY_PRIVATE_DOMAIN`.

Keep release identity aligned:

```bash
DD_VERSION=${{RAILWAY_GIT_COMMIT_SHA}}
NEXT_PUBLIC_DATADOG_VERSION=${{RAILWAY_GIT_COMMIT_SHA}}
DATADOG_RELEASE_VERSION=${{RAILWAY_GIT_COMMIT_SHA}}
```

## Admin sourcemap upload

After the Admin production build, upload browser sourcemaps with:

```bash
pnpm --filter @forge/admin datadog:sourcemaps
```

The upload script uses service `forge-admin`, release version
`DATADOG_RELEASE_VERSION`, and minified path prefix `/_next/static/`.

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
DD_VERSION=${{RAILWAY_GIT_COMMIT_SHA}}
DD_LOGS_INJECTION=true
DD_RUNTIME_METRICS_ENABLED=true

# Watch browser RUM
NEXT_PUBLIC_DATADOG_APPLICATION_ID=<Forge Watch RUM application ID>
NEXT_PUBLIC_DATADOG_CLIENT_TOKEN=<Forge Watch RUM client token>
NEXT_PUBLIC_DATADOG_SITE=datadoghq.com
NEXT_PUBLIC_DATADOG_ENV=prod
NEXT_PUBLIC_DATADOG_VERSION=${{RAILWAY_GIT_COMMIT_SHA}}
```

`apps/web/src/instrumentation.ts` configures Datadog only in the Next.js Node
runtime. Watch search analytics use structured `forge-web` logs as the
canonical every-search signal and RUM only for supplemental click context. See
`docs/operations/watch-search-analytics-datadog.md`.

## TV production variables

`apps/tv` ships Datadog Mobile RUM + Logs + native crash as service `forge-tv`.
See the "Observability (Datadog)" section of `apps/tv/CLAUDE.md` for the tvOS
SDK patch caveat, the deliberately excluded `expo-datadog` plugin, and the
mobile site enum gotcha. Provision per EAS profile with `eas env:create`:

```bash
# RUM client token (pub..., bundle-safe) + application id from the Datadog RUM app
EXPO_PUBLIC_DATADOG_CLIENT_TOKEN=
EXPO_PUBLIC_DATADOG_APPLICATION_ID=
# Mobile site enum (US1, EU1, ...), NOT web's "datadoghq.com"
EXPO_PUBLIC_DATADOG_SITE=US1
# Optional override; unset defaults by build type (dev -> development, release -> production)
EXPO_PUBLIC_DATADOG_ENV=
EXPO_PUBLIC_DATADOG_VERSION=
```

Unprovisioned builds boot with telemetry disabled; dev builds log a
`[datadog] RUM disabled` warning so the gate is visible from Metro logs.

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
