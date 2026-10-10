FROM gcr.io/datadoghq/agent:7

ENV DD_LOGS_ENABLED=true
ENV DD_APM_ENABLED=true
ENV DD_LOGS_CONFIG_CONTAINER_COLLECT_ALL=true
ENV DD_DOGSTATSD_NON_LOCAL_TRAFFIC=true
ENV DD_APM_NON_LOCAL_TRAFFIC=true
ENV DD_BIND_HOST=::1

COPY infra/datadog-agent/datadog.yaml /etc/datadog-agent/datadog.yaml
COPY infra/datadog-agent/syslog.yaml /etc/datadog-agent/conf.d/syslog.d/conf.yaml

EXPOSE 8125/udp
EXPOSE 8126
EXPOSE 514/udp
