# Watch delivery outcome observations — September 21, 2026

## Why HTTP and persisted rows were insufficient

The [64-hour review](watch-recommendation-corpus-review-2026-09-21.md) counted
28,931 seeded-delivery HTTP 200s but could not count their `delivery_timeout`
envelopes. Admin issuance can time out before persisting a request; Web can then
recover contextual cards while preserving that reason and returning HTTP 200.
Neither a successful HTTP status nor persisted retrieval latency counts this
failure population. Selection HTTP 503 is a separate outcome and route.

## Event contract

Both Web delivery handlers emit one `event=recommendation.delivery` line after
constructing their final response, including session-cookie attachment, or
constructing an HTTP error response. An oversized serialized response emits a
502 failure, never a preceding successful-delivery event.

| Field            | Meaning                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `endpoint`       | `seeded` or `for_you`                                                                      |
| `httpStatus`     | Actual constructed response status                                                         |
| `result`         | Final `served`, `fallback`, `empty`, `unavailable`; `rejected` for 4xx or `failed` for 5xx |
| `reason`         | Closed allowlist of operational reasons; `none` or `unknown` otherwise                     |
| `itemCount`      | 0–6, or `out_of_range` for a contract violation                                            |
| `upstreamResult` | Admin envelope result before contextual recovery, or `not_observed` for an HTTP error      |

For example, a recovered timeout with six cards is still observable as
`httpStatus=200 result=fallback reason=delivery_timeout itemCount=6 upstreamResult=unavailable`.
An unavailable timeout without contextual cards remains `result=unavailable`.
Both belong in the semantic timeout population. Count `retrieval_timeout`
separately. Admission, missing coverage and disabled-control outcomes have their
own reasons, rather than being mislabeled as timeouts.

The helper adds no database writes, awaited requests or new retry. It reads only
the response result/reason and array length. It never serializes items, request
identifiers, capabilities, profile fields, content paths or input bodies. Unknown
strings are replaced with constants; exceptions from logging cannot change the
response. Existing console forwarding attaches deployment service/env/version and
trace correlation. The console payload adds no identity fields.

## Production verification and limits

Use a fixed UTC window after Railway confirms the new revision. First inspect
one event with all attributes: this production syslog pipeline stores environment
and release in `@ddtags`, not searchable bare `env`/`version` tags. A bare
`env:prod` filter returned zero despite indexed events. Search
`service:forge-web "recommendation.delivery"`, declare `@ddtags` as a varchar
column and constrain its observed exact value in DDSQL, for example:

```sql
SELECT message, COUNT(*) AS events
FROM logs
WHERE "@ddtags" = 'env:prod,service:forge-web,version:4e31f822781f44df06e91c8194142a6c4b51646a'
GROUP BY message
```

The surrounding logs tool supplies the fixed time window. Confirm metadata anew
if the forwarding pipeline changes. Extract the fixed key/value fields if they
are not indexed attributes. Group by endpoint, status, result, reason, item count
and upstream result. Do not group by trace IDs or mix other routes.

Reconcile event counts separately against primary Web request metrics for
`post_/api/recommendations` and `post_/api/recommendations/for-you`, grouped by
HTTP status over the identical revision/window. Report HTTP 5xx, semantic HTTP
200 timeout envelopes, non-timeout fallbacks, empty responses, admission
rejections and six-card responses separately. Keep selection metrics under
`post_/api/recommendations/select` separate.

These events describe a completed route handler, not confirmed browser receipt.
Requests rejected before the handler, process exits and forwarding/indexing loss
can create discrepancies. Existing forwarding uses UDP and is not a durable
counter. A missing event is not evidence of a served response; report count
coverage and any mismatch before interpreting a zero. Sampled traces and a short
healthy window remain insufficient to close feat-496.

## Validation before release

- Test-first route regressions failed before the observer was added.
- 54 focused tests pass, including timeout recovery, final-status reporting,
  privacy/log-injection boundaries, ordinary non-timeout reasons and logger failure.
- Full Web suite: 4,438 passed, 10 skipped, one todo; lint and typecheck passed.
  The subsequent closed-vocabulary additions passed the focused tests above.
- No browser rendering, deadlines, GraphQL contracts, admission policy, homepage
  flag or authored content changed. [Exact deployment and observation](watch-ticket-execution-2026-09-21.md)
  confirm the Web revision and reconcile indexed events with primary requests.

This change closes the code-level measurement gap. It does not identify or fix
the remaining Admin capability-budget delay. feat-496 remains in progress.
