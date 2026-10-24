# feat-240 + feat-241 — operator command sheet (fleet search unblock)

Copy-paste commands for the steps **you** run. The admin abuse-ceiling PR itself
(the code) is specced separately in
`docs/handoffs/2026-07-15-feat-240-abuse-ceiling-and-key-mint.md`; this sheet is
the end-to-end _operator_ runbook that surrounds it. Replace every `<...>`
placeholder. Secrets never go in git or a shared channel.

> **Order matters (receiver-first).** Admin must recognize the keys BEFORE any
> app build ships them, or the first `Query.search` calls 401. Do the steps in
> this order.

---

## Step 0 — Preconditions (must be true before anything ships)

- [ ] **Origin bypass locked** (admin CMS owner) — raw `*.up.railway.app` origin returns 403/refused.
- [ ] **Abuse-ceiling PR merged + admin deployed** with `FLEET_SEARCH_CEILING_ENFORCE=false` (alert-only) and `commandTimeout` in `redis.ts` — see the abuse-ceiling handoff.

---

## Step 1 — Mint the two fleet keys (generate the secrets yourself)

One key per surface — **never shared** between TV and mobile.

```bash
openssl rand -base64 32   # → TV fleet key
openssl rand -base64 32   # → mobile fleet key
```

Keep both somewhere safe (1Password / secret manager). You'll paste them into Doppler (Step 2) and EAS (Step 5).

---

## Step 2 — Add the keys to admin Doppler + deploy admin (receiver-first)

`FLEET_ADMIN_API_KEYS` is a **comma-separated CSV** and must stay **disjoint** from every other bearer CSV (a reused value fails admin boot).

**Safe path — Doppler dashboard:** open project `forge-admin` → prod config → set
`FLEET_ADMIN_API_KEYS` to `<tv-fleet-key>,<mobile-fleet-key>`. If it already has
values, **append** (don't overwrite).

**CLI alternative** (⚠️ `secrets set` overwrites the whole value — include any existing entries):

```bash
doppler configs --project forge-admin           # find the prod config name (e.g. prd)
doppler secrets set FLEET_ADMIN_API_KEYS "<tv-fleet-key>,<mobile-fleet-key>" \
  --project forge-admin --config <prod-config>
```

Then **deploy admin** the normal way (merge/redeploy → Railway autodeploy). Do **not** `railway up` from a worktree.

---

## Step 3 — Verify the keys are live in admin (before you spend a build)

Run per key (swap in each value). Expect `HTTP 200`. `401` = not live yet → stop, don't build.

```bash
curl -sS -m 30 -o /dev/null -w 'fleet: HTTP %{http_code}\n' -X POST \
  https://admin.jesusfilm.org/api/graphql \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <fleet-key>' \
  -d '{"query":"query($q:String!,$locale:String!){ search(q:$q, locale:$locale, limit:1){ hasMore } }","variables":{"q":"jesus","locale":"en"}}'
```

Optional gate check — same request with the `-H 'authorization…'` line removed should return **401** (confirms the gate is on).

---

## Step 4 — Set the token in EAS (TV + mobile, production + preview)

Each surface gets its **own** key. Use `--visibility sensitive` (masked in the EAS dashboard + build logs) — **NOT `secret`**: `EXPO_PUBLIC_*` vars are inlined into the app bundle at build time, so EAS rejects `secret` visibility for them. The key is extractable from the shipped binary **by design**; feat-240's global per-key abuse ceiling is the mitigation, which is why the keys are per-surface + rotatable. `env:create` fails if the var already exists → use `env:update` (or add `--force`) on a re-run.

**TV:**

```bash
cd apps/tv
npx eas-cli env:create --environment production --name EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN --value <tv-fleet-key>     --visibility sensitive
npx eas-cli env:create --environment preview    --name EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN --value <tv-fleet-key>     --visibility sensitive
```

**Mobile:**

```bash
cd apps/mobile
npx eas-cli env:create --environment production --name EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN --value <mobile-fleet-key> --visibility sensitive
npx eas-cli env:create --environment preview    --name EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN --value <mobile-fleet-key> --visibility sensitive
```

The token is inlined at **build time** — an env change alone does nothing until you rebuild (Step 5).

---

## Step 5 — Build

**TV** (`EXPO_TV=1` is baked into every `apps/tv/eas.json` profile):

```bash
cd apps/tv
npx eas-cli build --platform android --profile preview       # sideloadable APK link (internal)
npx eas-cli build --platform ios     --profile production    # store-signed tvOS .ipa
```

**Mobile:**

```bash
cd apps/mobile
npx eas-cli build --platform ios     --profile production
npx eas-cli build --platform android --profile production
```

---

## Step 6 — Ship

- **TV Android:** give stakeholders the EAS APK install link (preview profile). See `apps/tv/DISTRIBUTION.md`.
- **TV Apple TV:** TestFlight via `altool` — **NOT `eas submit`** (it delivers tvOS as iOS and is rejected). Full recipe in `apps/tv/DISTRIBUTION.md`:
  ```bash
  # download the latest tvOS .ipa, then:
  xcrun altool --validate-app -f /tmp/jfw.ipa -t appletvos --apiKey <KeyID> --apiIssuer <IssuerID>   # dry run first
  xcrun altool --upload-app   -f /tmp/jfw.ipa -t appletvos --apiKey <KeyID> --apiIssuer <IssuerID>
  ```
- **Mobile:** `eas submit` is fine for the phone app (the tvOS gotcha is TV-only):
  ```bash
  cd apps/mobile
  npx eas-cli submit --platform ios     --profile production
  npx eas-cli submit --platform android --profile production
  ```

---

## Step 7 — Verify on a real build

- [ ] On a TestFlight/production TV + mobile build, search returns **results** (not 401 / "Search isn't available in this app version").
- [ ] Admin logs show `source=fleet` bucketing per client IP; the `consumer:*:unknown` share stays near-zero (a rising share = a `cf-connecting-ip` drop / AOP regression).
- [ ] Datadog `service:forge-tv` / mobile sessions show search succeeding on real devices.

---

## Step 8 — Calibrate + turn enforcement on (after builds reach users)

In `forge-admin` Doppler (see the abuse-ceiling handoff for the vars):

1. Read `event=fleet_ceiling.near count=` from admin logs over a representative window.
2. Set `FLEET_SEARCH_GLOBAL_CEILING_PER_MIN` to ~3–5× the observed p99 aggregate (never below realistic concurrent-fleet peak). Redeploy.
3. Set `FLEET_SEARCH_CEILING_ENFORCE=true`. Redeploy. Verify a synthetic over-ceiling key gets 429 on **both** GraphQL and REST.
4. Confirm `SEARCH_AUTH_REQUIRED=true` (per the feat-240 ticket it's already on — verify the live value). Only after this is the ceiling a real abuse bound.

---

## Step 9 — Rotation overlap (ongoing)

Keep the **old** fleet key valid in `FLEET_ADMIN_API_KEYS` for a multi-week overlap until install metrics confirm the new binaries reached the fleet — store builds update at user discretion. Only then remove the old value + redeploy. Env-CSV keys have **no** sub-second revocation: to revoke a compromised key, rotate the CSV + redeploy (breaks fleet search until a new build ships), with a Cloudflare edge block of the abusive pattern as the no-user-impact interim.
