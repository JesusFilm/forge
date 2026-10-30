# Watch search deadlines

`deadline-exceeded.json` is a reviewed payload template, not an active monitor.
It counts the existing query-free `watch_search_deadline_exceeded` log event
from production Admin: at least three failures in five minutes, evaluated with
a one-minute ingestion delay. It covers all reported deadline stages; it does
not require a new stage facet. It is not a percentile or error-rate monitor.

Before creation, confirm recent matching logs in Datadog, approve the threshold,
and add the approved notification destination to `message`. No recipient is
preselected. Validate through `POST /api/v1/monitor/validate`, inspect existing
monitors to avoid duplicates, then create once through the Monitor API or UI.
The sibling `create.sh` is specific to fleet-ceiling monitors and does not
accept this payload as a positional argument. Do not use it for this monitor.

After creation, verify notification delivery through an authorized test; do
not inject production search failures. No-data notifications are disabled
because the event is sparse. Missing logs are unknown health, not proof of
successful search. Check log ingestion separately.

The remaining feat-678 monitoring work is a complete attempt denominator,
success/failure latency distributions, and an approved synthetic search that
asserts valid JSON and visible results. Neither this template nor
`/api/search/health` provides that end-to-end coverage.
