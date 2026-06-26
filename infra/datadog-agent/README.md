# Datadog Agent Railway Service

This directory defines the repo-owned Datadog Agent service used by Forge
production apps for backend APM traces, runtime metrics, and application logs.

## Railway service

Create one Railway service in the existing `forge` project and production
environment:

```text
@forge/datadog-agent
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
DD_HOSTNAME=${{RAILWAY_PRIVATE_DOMAIN}}
DD_SITE=datadoghq.com
DD_APM_ENABLED=true
DD_APM_NON_LOCAL_TRAFFIC=true
DD_DOGSTATSD_NON_LOCAL_TRAFFIC=true
DD_LOGS_ENABLED=true
DD_LOGS_CONFIG_CONTAINER_COLLECT_ALL=true
DD_BIND_HOST=::1
```

## App service wiring

Each instrumented Railway app should point its tracer at this service's private
domain:

```bash
DD_AGENT_HOST=${{@forge/datadog-agent.RAILWAY_PRIVATE_DOMAIN}}
DD_TRACE_AGENT_PORT=8126
DD_AGENT_SYSLOG_PORT=514
```

Because the service name contains `/`, prefer Railway's variable autocomplete
when setting `DD_AGENT_HOST`; it will insert the exact reference syntax Railway
expects for `@forge/datadog-agent.RAILWAY_PRIVATE_DOMAIN`.

Then set app-specific unified service tags, for example Admin:

```bash
DD_SERVICE=forge-admin
DD_ENV=production
DD_VERSION=${{RAILWAY_GIT_COMMIT_SHA}}
```

Future production services should reuse the same Agent and choose their own
service names, such as `forge-watch`, `forge-manager`, and `forge-chat`.

## Log transport

Railway does not expose sibling service container stdout to a standalone Agent
container. Forge apps therefore forward application logs to the Agent using
syslog over UDP on the private network. The Agent listens on `514/udp` via
`syslog.yaml` and forwards logs to Datadog over HTTP via `datadog.yaml`.
