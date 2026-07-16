# Fleet-search abuse-ceiling — Datadog monitor spec (feat-240)

Implementation spec for the Datadog monitors that watch admin's fleet-key global
abuse ceiling. **Self-contained** — everything you need to build the monitors is
here; you do not need the originating chat.

- **Owner:** Urim · **Feature:** feat-240 (fleet search abuse ceiling) + feat-241 (client rollout)
- **Source of the signals:** `apps/admin/src/auth/fleet-ceiling.ts` (log emitters), `apps/admin/src/auth/fleet-key-id.ts` (the non-secret `fleetKeyId`)
- **Related runbooks:** `docs/handoffs/2026-07-15-feat-240-241-operator-command-sheet.md` (Step 8 = calibrate + flip enforce), `docs/handoffs/2026-07-15-feat-240-abuse-ceiling-and-key-mint.md`, `docs/observability/datadog.md` (log pipeline)

---

## 0. Background (why these monitors exist)

The **fleet abuse ceiling** is a global per-fleet-key rate limit on admin's
public search path. There is **one counter per fleet KEY** (`fleet-global:<fleetKeyId>`)
spanning all devices/IPs/viewer_ids that use that key, over a **60s fixed window**.

- TV and mobile each ship their **own distinct** fleet key (`FLEET_ADMIN_API_KEYS`
  CSV in admin's `forge-admin` Doppler), so each gets its **own** ceiling counter.
- Web (`WEB_ADMIN_API_KEYS`, `source=consumer`) is **excluded** — this ceiling is
  fleet-only.
- `fleetKeyId` = `sha256(rawKey).slice(0,12)` — a **non-secret** deterministic id
  used for the bucket name and every log field. The raw key is **never** logged.

**Env vars** (admin, `forge-admin` Doppler):

| Var                                   | Type               | Default       | Meaning                                                                           |
| ------------------------------------- | ------------------ | ------------- | --------------------------------------------------------------------------------- |
| `FLEET_SEARCH_GLOBAL_CEILING_PER_MIN` | int ≥ 0            | **6000**      | Per-key/min ceiling. `0` = kill-switch (disable ceiling, no redeploy).            |
| `FLEET_SEARCH_CEILING_ENFORCE`        | `"true"`/`"false"` | **`"false"`** | Alert-first. `false` = compute + log only, **no 429**. `true` = hard-block (429). |

**Current state:** `enforce=false` (alert-first). These monitors are the
**calibration instrument**: watch the signals under real fleet traffic, size the
ceiling, then flip `enforce=true`. A log event firing under `enforce=false` means
"the ceiling _would_ have acted" — not that any request was actually shed.

---

## 1. Where the data comes from (log pipeline — verify FIRST)

Admin's server `console.warn`/`console.error` lines are forwarded to Datadog:

```
admin (Railway)  --syslog/UDP:514-->  @forge/datadog-agent (Railway)  --HTTPS-->  Datadog
```

- **Tags on arrival:** `service:forge-admin`, `source:nodejs`, `env:prod` (see `infra/datadog-agent/syslog.yaml`, `docs/observability/datadog.md`).
- **Datadog site:** `datadoghq.com` (US1). API base: `https://api.datadoghq.com`.
- **Log shape:** plain-string `[search] event=<name> key=value key=value`. **Not JSON** — Railway logsV2 silences `JSON.stringify` payloads, so admin deliberately uses `event=name key=value`. Query these with a **quoted substring** on the message.

> ⚠️ **Precondition — do this before building any monitor.** In Datadog → Logs,
> run `service:forge-admin` and confirm recent admin logs are arriving. If none,
> the syslog forwarding isn't active (admin Railway service needs `DD_AGENT_HOST`
> and `DD_AGENT_SYSLOG_PORT=514`) and every monitor below will be silently green.
> Fix the pipeline first. Also note: `.near`/`.exceeded` only appear once a key
> nears/crosses 6000/min — at current traffic they may **never fire**, which is
> healthy (you're well under ceiling), not a broken pipeline.

---

## 2. The log events (exact strings from `fleet-ceiling.ts`)

All lines are prefixed `[search] ` and carry `path=graphql|rest`.

| Event                          | console | DD status | Fires when                                                                             | Extra fields                                | Monitor?                |
| ------------------------------ | ------- | --------- | -------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------- |
| `fleet_ceiling.exceeded`       | `error` | error     | count == ceiling+1 (redis, **once/window**, first-over)                                | `fleetKeyId count ceiling enforce rl=redis` | ✅ **M1**               |
| `fleet_ceiling.missing_key_id` | `error` | error     | a fleet bearer arrives with **no** `fleetKeyId` (derivation bug — should never happen) | `path` only                                 | ✅ **M2**               |
| `fleet_ceiling.near`           | `warn`  | warn      | count == floor(ceiling×0.8) (redis, once/window) — 80% early warning                   | `fleetKeyId count ceiling rl`               | ✅ **M3**               |
| `fleet_ceiling.degraded`       | `warn`  | warn      | Redis down → per-replica **local** fallback AND over the local cap                     | `fleetKeyId count ceiling enforce blocked`  | ➕ **M4** (recommended) |
| `fleet_ceiling.error`          | `error` | error     | the ceiling check **threw** and loud-degraded to allow (bug)                           | `fleetKeyId error`                          | ➕ **M5** (recommended) |

Notes that change interpretation:

- **`.exceeded` semantics depend on enforce:** under `enforce=false` it means "would
  have blocked" (calibration signal, expected while tuning). Under `enforce=true`
  it means **active shedding** (real 429s → abuse or an under-provisioned ceiling).
- **`.near`/`.exceeded` are redis-only and fire at most once per key per 60s window**
  (equality check on the monotonic INCR), so they are low-volume by construction.
- **`.missing_key_id` and `.error` should be flat zero.** Any occurrence = a bug in
  the auth/derivation path; investigate, don't just raise the ceiling.

---

## 3. Monitors to create

Datadog **Log Alert** monitors. Common options for all: `notify_no_data: false`
(absence = healthy), `evaluation_delay: 60` (syslog ingest lag), `enable_logs_sample: true`
(attach a sample line to the alert), 5-minute rollup.

**Fill in the notification target** (`@REPLACE_WITH_ALERT_CHANNEL`) — copy the exact
handle from the existing `service:forge-tv` monitor (id **303307205**) or your team's
alert channel. Replace `team:forge` with your real team tag if different.

### M1 — `fleet_ceiling.exceeded` (P2 · abuse / under-provisioned ceiling)

- **Query:** `logs("service:forge-admin \"event=fleet_ceiling.exceeded\"").index("*").rollup("count").last("5m") >= 1`
- **Threshold:** critical ≥ 1
- **Message:**
  > A fleet key crossed its per-minute search ceiling (`event=fleet_ceiling.exceeded`).
  > If `FLEET_SEARCH_CEILING_ENFORCE=false`: this is "would-have-blocked" — a
  > calibration signal, verify it's legit fleet load and consider the ceiling size.
  > If `enforce=true`: search is being **429'd** for this key — investigate abuse
  > vs. an under-sized ceiling. The key is `fleetKeyId=<12-hex>` (non-secret; TV vs
  > mobile). Runbook: `docs/handoffs/2026-07-15-feat-240-241-operator-command-sheet.md` §8.
  > `@REPLACE_WITH_ALERT_CHANNEL`
- **Priority:** 2 (bump toward P1 once `enforce=true`). **renotify_interval:** 60.

### M2 — `fleet_ceiling.missing_key_id` (P2 · correctness, must be zero)

- **Query:** `logs("service:forge-admin \"event=fleet_ceiling.missing_key_id\"").index("*").rollup("count").last("5m") >= 1`
- **Threshold:** critical ≥ 1
- **Message:**
  > A fleet bearer reached the ceiling gate with **no** `fleetKeyId` — a derivation
  > bug in `search-bearer.ts`/`fleet-key-id.ts`. Should never happen. The request was
  > allowed (loud-degrade), so no user impact, but the ceiling is not counting this
  > caller. Investigate the fleet-branch of `isAnyKnownBearer`. `@REPLACE_WITH_ALERT_CHANNEL`
- **Priority:** 2. **renotify_interval:** 120.

### M3 — `fleet_ceiling.near` (P4 · calibration / early warning)

- **Query:** `logs("service:forge-admin \"event=fleet_ceiling.near\"").index("*").rollup("count").last("5m") >= 1`
- **Threshold:** critical ≥ 1 (low priority — informational)
- **Message:**
  > A fleet key hit **80%** of its search ceiling (`event=fleet_ceiling.near`). Not an
  > incident — the calibration tripwire. Sustained firing means real load is close to
  > the ceiling: either raise `FLEET_SEARCH_GLOBAL_CEILING_PER_MIN` or investigate a
  > traffic spike. Prefer routing this to a low-urgency channel or a dashboard.
  > `@REPLACE_WITH_ALERT_CHANNEL`
- **Priority:** 4. Consider a non-paging channel. (Alternatively make this a
  dashboard timeseries instead of a monitor.)

### M4 — `fleet_ceiling.degraded` (P3 · Redis health, recommended)

- **Query:** `logs("service:forge-admin \"event=fleet_ceiling.degraded\"").index("*").rollup("count").last("5m") >= 1`
- **Threshold:** critical ≥ 1
- **Message:**
  > The fleet ceiling fell back to the **per-replica local cap** because Redis was
  > unreachable (`event=fleet_ceiling.degraded`). Rate limiting is degraded (bounded at
  > ceiling×replicas, not the true global ceiling). Check Redis / other Redis alerts.
  > `@REPLACE_WITH_ALERT_CHANNEL`
- **Priority:** 3.

### M5 — `fleet_ceiling.error` (P2 · correctness, recommended)

- **Query:** `logs("service:forge-admin \"event=fleet_ceiling.error\"").index("*").rollup("count").last("5m") >= 1`
- **Threshold:** critical ≥ 1
- **Message:**
  > The ceiling check **threw** and loud-degraded to allow (`event=fleet_ceiling.error`).
  > Search still works (defensive catch), but the ceiling isn't bounding this request.
  > A bug in `fleet-ceiling.ts`/`incrementFixedWindow`. Investigate the attached
  > `error=` field. `@REPLACE_WITH_ALERT_CHANNEL`
- **Priority:** 2.

---

## 4. How to create them

> **The committed payloads in [`infra/datadog-monitors/`](../../infra/datadog-monitors/)
> are canonical** (M1–M3 + `create.sh` + README, with an error-checked apply). The
> inline JSON/curl below is illustrative; if it drifts from the committed files,
> the committed files win.

### Option A — Datadog UI (quickest)

Monitors → New Monitor → **Logs**. For each: paste the search from §3 (the part
inside `logs("…")`), set "over" = `count`, evaluation window `last 5 minutes`,
alert threshold `>= 1`, then paste the message, tags, priority, and set
**"Don't notify on no-data"** (notify_no_data = false) and evaluation delay 60s.

### Option B — API (repeatable; paste-ready payloads)

Needs a Datadog **API key** (the `Forge-production` key) **and an Application key**
(create one under Organization Settings → Application Keys if you don't have one).

```bash
export DD_API_KEY=<Forge-production API key>
export DD_APP_KEY=<your Datadog application key>

create () {  # usage: create <json-file>
  curl -sS -X POST "https://api.datadoghq.com/api/v1/monitor" \
    -H "DD-API-KEY: ${DD_API_KEY}" \
    -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" \
    -H "Content-Type: application/json" \
    -d @"$1" | python3 -m json.tool | grep -E '"id"|"name"'
}
```

**`m1-exceeded.json`** (repeat the shape for M2–M5, swapping `event=…`, name, message, priority):

```json
{
  "name": "[forge-admin] fleet_ceiling.exceeded — fleet key over search ceiling",
  "type": "log alert",
  "query": "logs(\"service:forge-admin \\\"event=fleet_ceiling.exceeded\\\"\").index(\"*\").rollup(\"count\").last(\"5m\") >= 1",
  "message": "A fleet key crossed its per-minute search ceiling. enforce=false => would-have-blocked (calibration); enforce=true => active 429s (abuse or under-sized ceiling). Runbook: docs/handoffs/2026-07-15-feat-240-241-operator-command-sheet.md section 8. @REPLACE_WITH_ALERT_CHANNEL",
  "tags": [
    "service:forge-admin",
    "env:prod",
    "team:forge",
    "feature:feat-240",
    "area:fleet-search"
  ],
  "priority": 2,
  "options": {
    "thresholds": { "critical": 1 },
    "notify_no_data": false,
    "evaluation_delay": 60,
    "renotify_interval": 60,
    "enable_logs_sample": true,
    "include_tags": true,
    "groupby_simple_monitor": false
  }
}
```

Query strings for the other four (drop into the same payload shape):

- M2: `logs("service:forge-admin \"event=fleet_ceiling.missing_key_id\"").index("*").rollup("count").last("5m") >= 1`
- M3: `logs("service:forge-admin \"event=fleet_ceiling.near\"").index("*").rollup("count").last("5m") >= 1`
- M4: `logs("service:forge-admin \"event=fleet_ceiling.degraded\"").index("*").rollup("count").last("5m") >= 1`
- M5: `logs("service:forge-admin \"event=fleet_ceiling.error\"").index("*").rollup("count").last("5m") >= 1`

(In JSON, the inner quotes are escaped `\\\"` as shown in M1.)

### Option C — Datadog MCP / terraform

The repo has **no** monitors-as-code today (no terraform `datadog_monitor`). If you
adopt IaC later, port these five; for now UI or API is the path. The `datadog` MCP
(in `.mcp.json`) can also create/verify monitors interactively.

---

## 5. Calibration → flip enforcement (the point of it all)

Currently `enforce=false`, ceiling `6000`/key/min. Sequence:

1. **Measure real per-key peak.** 6000/min/key is a guess; find the true peak so the
   ceiling is a meaningful bound. Two sources:
   - **Client RUM (direct):** count `watch_search` per minute on `service:forge-tv`
     and `service:forge-mobile` RUM — that's the real fleet search rate per platform
     (≈ per key). Take the busiest 1-min bucket over a representative week.
   - **Server tripwire (indirect):** `.near`/`.exceeded` events. If they **never**
     fire at 6000, real peak is < 4800/min/key. To find the real peak faster, you may
     temporarily **lower** `FLEET_SEARCH_GLOBAL_CEILING_PER_MIN` (keep `enforce=false`)
     until `.near` starts firing, read the level, then restore.
2. **Set the ceiling** to ~**3–5× observed per-key peak** (never below realistic
   concurrent-fleet peak). Redeploy admin.
3. **Flip** `FLEET_SEARCH_CEILING_ENFORCE=true`. Redeploy. Verify a synthetic
   over-ceiling key returns **429 on both** `POST /api/graphql` (search) and `POST /api/search`.
4. **Confirm** `SEARCH_AUTH_REQUIRED=true` (should already be on). Only after this is
   the ceiling a real abuse bound.
5. After flip, treat **M1 (`.exceeded`)** as a higher priority (active shedding).

---

## 6. Manual query cheatsheet (Logs Explorer)

```
service:forge-admin "event=fleet_ceiling.exceeded"        # who crossed the ceiling
service:forge-admin "event=fleet_ceiling.near"            # who's near 80%
service:forge-admin "event=fleet_ceiling.missing_key_id"  # derivation bug (should be empty)
service:forge-admin "event=fleet_ceiling.degraded"        # redis fallback active
service:forge-admin "event=fleet_ceiling.error"           # ceiling threw (should be empty)
service:forge-admin "event=fleet_ceiling"                 # everything ceiling-related
```

`fleetKeyId=<12 hex>` in each line distinguishes TV from mobile (non-secret). To map
a `fleetKeyId` back to a surface, run `sha256(rawKey)[:12]` for each fleet key.

---

## 7. Definition of done

- [ ] Pipeline verified: `service:forge-admin` logs visible in Datadog.
- [ ] M1 exceeded, M2 missing_key_id, M3 near created (the 3 requested).
- [ ] M4 degraded, M5 error created (recommended).
- [ ] Each has the right notification channel, `notify_no_data:false`, and tags.
- [ ] Calibration done → ceiling sized → `FLEET_SEARCH_CEILING_ENFORCE=true` → `SEARCH_AUTH_REQUIRED=true` confirmed.
