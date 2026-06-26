# Datadog Agent Railway Service

This directory defines the repo-owned Datadog Agent service used by Forge
production apps for backend APM traces and runtime metrics.

## Railway service

Create one Railway service in the existing `forge` project and production
environment:

```text
datadog-agent-production
```

Configure the service to deploy from this repository with config-as-code path:

```text
infra/datadog-agent/railway.toml
```

Do not generate a public Railway domain for this service. Forge apps should
reach it over Railway private networking.

## Environment

Use the Datadog API key named `Forge-production`.

```bash
DD_API_KEY=<Forge-production API key value>
DD_SITE=datadoghq.com
DD_APM_ENABLED=true
DD_APM_NON_LOCAL_TRAFFIC=true
DD_DOGSTATSD_NON_LOCAL_TRAFFIC=true
```

## App service wiring

Each instrumented Railway app should point its tracer at this service's private
domain:

```bash
DD_AGENT_HOST=${{datadog-agent-production.RAILWAY_PRIVATE_DOMAIN}}
DD_TRACE_AGENT_PORT=8126
```

Then set app-specific unified service tags, for example Admin:

```bash
DD_SERVICE=forge-admin
DD_ENV=production
DD_VERSION=${{RAILWAY_GIT_COMMIT_SHA}}
NODE_OPTIONS=--require dd-trace/init
```

Future production services should reuse the same Agent and choose their own
service names, such as `forge-watch`, `forge-manager`, and `forge-chat`.
