# Simulator feedback on this Mac

`/tv/local` reuses the photo, drawing and note flow. It saves reports on the Mac
running this app. It does not use Redis, production grants, Turnstile or Linear
for local capture. QR context is untrusted simulator information, never proof of
a verified TV device.

Set these values in `apps/tv-feedback/.env.local`:

```ini
FEEDBACK_LOCAL_ENABLED=true
FEEDBACK_LOCAL_BASE_URL=http://192.168.1.25:3210
FEEDBACK_LOCAL_LINEAR_ENABLED=false
```

Replace the private IP with this Mac's Wi-Fi/LAN IP. The TV development
configuration must use the same base and `/tv/local`. Start the receiver with
`pnpm --filter @forge/tv-feedback dev --hostname 0.0.0.0`. Keep the phone and Mac
on the same trusted network. The Mac and receiver must stay running. This is a
local HTTP development tool, not a public hosted feedback service.

The local route and APIs require `NODE_ENV=development` and the explicit server
switch. They return 404 in production even when both local flags are true.
Requests must match the configured Host and Origin; they use a separate HttpOnly
SameSite cookie scoped to `/api/feedback/local`. Production feedback endpoints,
their attestation rules and release app configurations are unchanged.

## What is saved

The default directory is `.local-tools/tv-feedback-captures` at the repository
root when the app runs through its package script. Set
`FEEDBACK_LOCAL_STORAGE_DIR` to an absolute directory to choose another location.
Keep it outside `public/` and outside tracked source. Each private session folder
contains `session.json`, the submitted photo bytes (`*.source`) and a normalized
JPEG. The photo already includes the drawn annotation; annotation geometry and
TV context are also retained in the JSON. The unannotated camera original is not
uploaded. Long drawings retain their full appearance in the submitted photo;
their supplementary geometry is sampled/rounded to a bounded JSON summary
(`annotationMetadataSimplified: true`). No submitted image is publicly served.

Receipts say **Saved on this Mac**. They never imply delivery to the team.
Sessions expire after two hours; expiration does not delete evidence. Limits are
32 retained sessions per capture directory, 12 reservations / 60 MB admitted
image bytes and three reports per session, with 10 MB per image. Normalized
copies add disk usage. A full directory fails closed; preserve or archive its
evidence and select a new directory before starting another run. Removed uploads
remain on disk for evidence but cannot be submitted.

The receiver uses an on-disk `.writer-lock` for quota, upload and delivery
updates. A killed process can leave this lock behind. Stop the receiver, inspect
the saved report/Linear state, then remove only that stale empty lock directory.
Do not delete captures to unblock a delivery retry.

## Optional Send to Linear

### Create a key for local feedback

In the Jesus Film Project Linear workspace:

1. Open **Settings → Account → Security & Access → Personal API keys**.
2. Create a personal API key named **Watch TV Local Feedback**.
3. Enable **Read**, **Create issues** and **Write**. Photo delivery needs Write:
   the deployed feedback runbook records Linear rejecting `fileUpload` without
   it with `Invalid scope: write required`. Do not enable Admin.
4. Restrict the key to the **TV** team. Select TV itself, not its parent Forge
   team or all teams. Write also permits changes to TV-team data, so keep this
   team restriction.
5. Copy the key directly into the server's private configuration below. Keep a
   recoverable copy in your approved secret manager. Do not paste it into chat,
   shell commands/history, screenshots or logs.

See Linear's [API and webhooks guide](https://linear.app/docs/api-and-webhooks)
and [Security & Access guide](https://linear.app/docs/security-and-access).
The app's [deployment runbook](./DEPLOYMENT.md) documents the verified upload
permission requirement. A read-only Linear key cannot deliver feedback.

### Configure the receiving server

Create or edit **`apps/tv-feedback/.env.local`**, not the TV app's environment
file. Use this minimal configuration; replace the IP and API-key placeholder:

```ini
FEEDBACK_LOCAL_ENABLED=true
FEEDBACK_LOCAL_BASE_URL=http://<MacPrivateIPv4>:3210
FEEDBACK_LOCAL_LINEAR_ENABLED=true
FEEDBACK_LINEAR_API_KEY=replace-with-your-private-linear-key
FEEDBACK_LINEAR_TEAM_ID=53806f68-05a4-4145-b10d-e47653d3d712
FEEDBACK_LINEAR_PROJECT_ID=df3c00b4-5172-43c6-9edc-0df795d565d7
FEEDBACK_LINEAR_LABEL_ID=08605e27-df2d-4ea1-973e-98c90db78c89
```

These destination IDs were verified on 21 October 2026: TV team,
[TV Beta Feedback project](https://linear.app/jesus-film-project/project/tv-beta-feedback-0b56740fdc10/overview),
and its TV Beta Feedback issue label. The IDs are configuration identifiers, not
secrets. `FEEDBACK_LINEAR_LABEL_ID` is optional if your destination has no label.
Other workspaces must use their own team/project/label IDs.

Do not copy all blank production-only variables from `.env.example` into this
local configuration. The existing server configuration validates supplied
optional secrets; an empty value can fail that validation. Local capture does
not require Redis, attestation keys, Turnstile or `FEEDBACK_SESSION_SECRET`.
Omit unused settings entirely. If they already exist for other development work,
keep their valid values and merge the local settings deliberately.

From the repository root, verify that the private file is ignored, then limit
its filesystem permissions:

```sh
git check-ignore --quiet apps/tv-feedback/.env.local
chmod 600 apps/tv-feedback/.env.local
```

`git check-ignore --quiet` must exit successfully before adding the key. Never
force-add the file to Git. Never put the key in the TV app, a QR URL,
`NEXT_PUBLIC_*` or `EXPO_PUBLIC_*` settings. Credentials belong only on this
receiving server.

Restart the receiver after changing its environment:

```sh
pnpm --filter @forge/tv-feedback dev --hostname 0.0.0.0
```

Keep the Mac and phone on the same trusted network. The TV QR must use the exact
configured HTTP origin and `/tv/local`. To disable Linear delivery again, set
`FEEDBACK_LOCAL_LINEAR_ENABLED=false` and restart; local saving still works.

### Save locally, then choose whether to send

After a local save, **Send to Linear** explicitly shares the note, TV context and
selected photo with that configured project. The issue is marked
`[SIMULATOR TEST]` in its title and carries a unique `LOCAL-SIMULATOR-<report UUID>`
reference. **Delivered** appears only after Linear confirms the issue and all
selected attachments; the receipt links to the real returned issue URL.

If a request times out or an attachment fails, the report remains local and says
**Delivery needs review**. The persisted attempt prevents a duplicate issue or
attachment on retry. A repeated API request may look up the existing issue by
reference; it never repeats an uncertain create. Inspect Linear using the report
reference and the saved delivery state before any manual recovery. There is no
background queue or automatic retry.

## Hosted signed simulator links (any network)

Use `/tv/simulator` on the existing feedback staging server when the phone cannot
reach the Mac over Wi-Fi. This mode uses the normal hosted photo/upload/Linear
flow with a separate signed authorization. No same-network, phone-device or
daily simulator report-count requirement applies. Native beta users retain
their existing verification and limits. File validation, per-report upload
bounds, service capacity bounds, session ownership and idempotency still apply.

### Create a dedicated signing key on the Mac

From the repository root, with Node 20 or later:

```sh
mkdir -p .local-tools/feedback-signing
node apps/tv-feedback/scripts/simulator-token.mjs init \
  --public-key-out .local-tools/feedback-signing/public.pem
```

The private Ed25519 key is generated directly into macOS Keychain under service
`org.jesusfilm.forge.tv.feedback-simulator.signing`, account
`simulator-issuer-v1`, label **Watch TV Simulator Signing**. Repeating `init`
reuses that key; it never silently rotates or exports it. The PEM file contains
only the public key. Apple signing keys and Linear API keys have separate roles.

On the **feedback staging service only**, configure:

```ini
FEEDBACK_SIMULATOR_SIGNED_ENABLED=true
FEEDBACK_SIMULATOR_AUDIENCE=https://web-staging-920a.up.railway.app
FEEDBACK_SIMULATOR_PUBLIC_KEY=<complete public.pem contents, including newlines>
```

Keep the existing `FEEDBACK_BASE_URL` on the same staging origin and preserve
the existing Redis, session secret and Linear configuration. Never put the
private signing key on Railway or in an `EXPO_PUBLIC_*` variable. One issuer is
configured at a time: coordinate a public-key change with the staging owner.
Rotating that key or disabling the flag invalidates its simulator sessions;
normal device sessions remain unaffected.

### Generate a QR link

```sh
node apps/tv-feedback/scripts/simulator-token.mjs issue \
  --output .local-tools/feedback-signing/link.private.txt \
  --tv-env apps/tv/.env.local \
  --ttl 3600
```

The command writes the bearer link to a mode-0600 file and updates only the TV
feedback URL and simulator flag. It prints expiry and file paths, never the
token. Restart Metro after updating the TV environment. The TV mode still
requires a development build and native simulator/emulator confirmation.

The signed link carries its token in `#token=...`, so it is not sent in the URL
to the web server. The page exchanges it in a same-origin POST, then removes
the fragment. The token lasts one hour by default (maximum two hours); each
explicit start creates a separate single-report session lasting at most
30 minutes and never beyond token expiry. **Done** can start another report
while the in-memory token remains valid, or rescan the same QR. Refreshing after
the token was removed may require another scan. Generate a new link when it
expires. Anyone holding the link can submit simulator reports while it is valid.

Hosted simulator submissions are always marked `[SIMULATOR TEST]` by the
server. They use the existing server-side Linear key; other developers do not
need to copy that Linear key onto their machines to use a hosted signed link.
The local receiver's optional **Send to Linear** mode described above is the
case that needs a separate local Linear credential.

## Verification

Run `pnpm --filter @forge/tv-feedback test`, `typecheck`, `lint` and `build`.
The local server tests use temporary directories, real image normalization and
mocked Linear calls. They cover ownership, origin, production exclusion, quotas,
idempotency, local evidence and uncertain delivery. Runtime QR scanning,
phone-browser annotation, production-route checks and any authorized real
Linear delivery require separate evidence; unit tests do not establish those.

Run the issuer tests with
`node --test apps/tv-feedback/scripts/simulator-token.test.mjs`.
For actual Redis/Lua quota checks, set `FEEDBACK_TEST_REDIS_BINARY` to a local
Redis 7+ executable when running the feedback tests. That suite starts a
temporary Unix-socket-only server, never reads `REDIS_URL`, and removes only its
own temporary data. Without this variable it is explicitly skipped, not passed.
