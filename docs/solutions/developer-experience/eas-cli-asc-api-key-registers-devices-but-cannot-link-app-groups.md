---
title: "eas-cli with an App Store Connect API key: device registration works, a new App Group link does not"
date: 2026-10-08
category: developer-experience
module: apps/mobile
problem_type: developer_experience
component: tooling
severity: medium
applies_when:
  - "An agent or a script must register an iPhone for an internal (ad hoc) EAS build, and nobody is at the Apple ID prompt"
  - "The first `eas build` of a profile adds a new iOS target or capability, such as an App Group for a widget extension"
  - "Deciding whether an iOS `eas build` can run with `--non-interactive`"
  - "Checking whether the saved Apple ID session on this machine is still valid, without a password or a two-factor code"
symptoms:
  - "`eas device:create` has no flags, and by default it stops at an Apple ID login"
  - "`eas build --non-interactive` on a new ad hoc profile stops with 'Provisioning profile is not configured correctly. Run this command again in interactive mode.'"
  - "eas-cli prints 'Skipping capability identifier syncing because the current Apple authentication session is not using Cookies (username/password).'"
resolution_type: workflow_improvement
related_components:
  - authentication
tags:
  - eas-cli
  - eas-device-create
  - asc-api-key
  - ad-hoc-distribution
  - app-groups
  - capability-sync
  - apple-id-2fa
  - expo-widgets
retire_when: "eas-cli links App Groups (capability identifiers) under App Store Connect API-key auth; check that build/credentials/ios/appstore/capabilityIdentifiers.js in the installed eas-cli no longer returns early on isAppStoreConnectTokenOnlyContext"
---

# eas-cli with an App Store Connect API key: device registration works, a new App Group link does not

## Context

The Daily Bible Pause review needed an internal-distribution ("ad hoc") iOS build on
one stakeholder's iPhone: the `pause-preview` profile in `apps/mobile/eas.json:31`,
run by `apps/mobile/scripts/build-pause.sh`. Two eas-cli steps normally ask for an
Apple ID password and a two-factor code: `eas device:create`, and the first build of
the profile. An agent has neither.

This machine already holds an App Store Connect (ASC) API key: the `.p8` under
`~/.appstoreconnect/private_keys/`, whose key ID and issuer ID are kept next to it
(`apps/tv/DISTRIBUTION.md` describes where). So the question was which eas-cli steps the key can do.
The answers below come from eas-cli 21.0.1's source (the npm package's `build/` folder) and from what happened on 2026-10-08. The plan for this build assumed that
the owner runs the first build by hand, so it never weighed the API key against an
Apple ID login (session history). The question came up only when an agent was asked
to run every step.

## Guidance

### 1. Register a device with the API key, not an Apple ID

eas-cli switches to API-key mode when any `EXPO_ASC_*` variable is set
(`hasAscEnvVars`, `eas-cli/build/credentials/ios/appstore/resolveCredentials.js:32`, read
by `eas-cli/build/credentials/ios/appstore/AppStoreApi.js:18`). Set all five:

| Variable                | Value                                                              |
| ----------------------- | ------------------------------------------------------------------ |
| `EXPO_ASC_API_KEY_PATH` | path to the `.p8`                                                  |
| `EXPO_ASC_KEY_ID`       | the key ID                                                         |
| `EXPO_ASC_ISSUER_ID`    | the issuer ID                                                      |
| `EXPO_APPLE_TEAM_ID`    | `DQ48D9BF2V`                                                       |
| `EXPO_APPLE_TEAM_TYPE`  | `COMPANY_OR_ORGANIZATION` (without it, a team-type prompt appears) |

`eas device:create` has no flags, so two prompts remain: "use the
jesus-film-project account?" and the registration method. Drive them with
`/usr/bin/expect` (see Examples). Choose **Website**, the first option. The command
prints `https://expo.dev/register-device/<id>`. The device owner opens it in Safari
on the iPhone, then installs the profile from the iPhone's Settings app. Then
`eas device:list --apple-team-id DQ48D9BF2V` shows the UDID.

This path is safe to automate:

- The Website method only calls EAS GraphQL
  (`createAppleDeviceRegistrationRequestAsync`,
  `eas-cli/build/devices/actions/create/registrationUrlMethod.js:22`). It makes no Apple call.
- In API-key mode the team has no name (`resolveAppleTeamAsync`,
  `resolveCredentials.js:142`). The EAS team record is renamed only when a name is
  given (`eas-cli/build/credentials/ios/api/GraphqlClient.js:141`), so the stored name stays.

Send the registration link only to the device owner. Anyone with it can register a
device on the team, and Apple limits device registrations per membership year.

### 2. A first build that links a new App Group needs an Apple ID session

`apps/mobile/app.json:140-143` adds the expo-widgets extension
`org.jesusfilm.forgewatch.ExpoWidgetsTarget` with the App Group
`group.org.jesusfilm.forgewatch`. The first build must register that App ID and link
it to the group. Under the API key, eas-cli skips the link:
`syncCapabilityIdentifiersForEntitlementsAsync` returns early on
`isAppStoreConnectTokenOnlyContext` and warns "Skipping capability identifier syncing
because the current Apple authentication session is not using Cookies"
(`eas-cli/build/credentials/ios/appstore/capabilityIdentifiers.js:28-29`). The code comment says token
auth is not supported there, because creating capability identifiers needs the
team ID.

`--non-interactive` does not help either. With no ad hoc credentials stored for the
profile, it throws `MissingCredentialsNonInteractiveError`
(`eas-cli/build/credentials/ios/actions/SetUpAdhocProvisioningProfile.js:54`).

So the first build of such a profile is a human step: run it interactively and log in
with an Apple ID. We did not run an API-key build to watch it fail. Per this
session's reading of the source, the new App ID's profile would lack the group, and
the build would fail at signing. The owner ran the build with an Apple ID instead,
and it set up ad hoc profiles for both targets with the registered iPhone.

A read-only ASC API query shows the state before the build (see Examples). On
2026-10-08, `org.jesusfilm.forgewatch` already had `APP_GROUPS`, `IN_APP_PURCHASE`
and `PUSH_NOTIFICATIONS`, and the extension App ID was not registered.

### 3. Test the saved Apple ID session before you plan a build

eas-cli first tries to restore a saved cookie session
(`Auth.tryRestoringAuthStateFromUserCredentialsAsync`,
`eas-cli/build/credentials/ios/appstore/authenticate.js:47`). The cookie is under
`~/.app-store/auth/<apple id>/cookie`. Call the same function directly (see
Examples): it needs no password and sends no two-factor code. On 2026-10-08 a
cookie from 2026-09-23 printed "Session expired". If it restores, an agent can run
the build. If it has expired, hand the build to the human, and do not let eas-cli
try a password: a password login sends a two-factor prompt to the owner's devices.

After the owner's interactive build, the session is fresh again, and the profile's
ad hoc credentials are stored on EAS. Later builds of the same profile, with the
same targets and devices, need no new Apple setup.

### 4. The App ID is shared with apps/tv

`org.jesusfilm.forgewatch` is the iOS App ID of `apps/mobile` and `apps/tv`. A
capability change for one app (here, App Groups) invalidates the existing profiles
of both. During the review, run every iOS production build with
`EXPO_NO_CAPABILITY_SYNC=1`, for mobile and TV
(`docs/operations/daily-bible-pause-preview.md`, section 9, which names the
shared App ID rather than TV). Otherwise capability
sync on a build without the widget turns App Groups off again.

## Why This Matters

- Without step 1, an agent cannot register a device without the owner's password,
  so the owner does a manual step that the key already covers.
- Without step 2, an agent tries `--non-interactive` or the API key on the first
  build, and it fails, or it builds a profile that cannot sign the widget.
- Without step 3, an agent starts an interactive build and waits at a password
  prompt, or it sends an unexpected two-factor prompt to the owner.
- None of this is in the Expo documentation pages that the build prints. It
  took reading the eas-cli source, including
  `eas-cli/build/devices/manager.js`, where `eas device:create` asks for the
  Apple login.

## When to Apply

- Before any agent-run `eas device:create`.
- Before the first `eas build` of a profile that adds a target, an App Group, an
  iCloud container, or an Apple Pay merchant ID. Those are the capability
  identifiers that `capabilityIdentifiers.js` manages.
- Before an agent plans to run an iOS build that may need new credentials.

## Examples

Register a device. The script checks the account name before it answers:

```bash
cd apps/mobile
export EXPO_ASC_API_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_<key id>.p8" \
  EXPO_ASC_KEY_ID="<key id>" EXPO_ASC_ISSUER_ID="<issuer id>" \
  EXPO_APPLE_TEAM_ID=DQ48D9BF2V EXPO_APPLE_TEAM_TYPE=COMPANY_OR_ORGANIZATION
expect -c '
set timeout 90
spawn eas device:create
expect -re {use the (\S+) account} {
  if {$expect_out(1,string) ne "jesus-film-project"} { send "\003"; exit 2 }
  send "y"
}
expect -re {register your devices} { sleep 1; send "\r" }
expect -re {https://expo\.dev/register-device/\S+}
expect eof'
```

Test the saved Apple ID session (no password, no two-factor code):

```js
// node test-apple-session.cjs
const eas = "<global node_modules>/eas-cli"
const { Auth } = require(require.resolve("@expo/apple-utils", { paths: [eas] }))
Auth.tryRestoringAuthStateFromUserCredentialsAsync(
  { username: "<apple id>", teamId: "DQ48D9BF2V" },
  { autoResolveProvider: true },
).then((session) => console.log(session ? "RESTORED" : "NOT VALID"))
```

Read an App ID's capabilities with the API key (read-only). Sign an ES256 JWT with
Node's `crypto.sign("sha256", data, { key, dsaEncoding: "ieee-p1363" })`, then:

```text
GET https://api.appstoreconnect.apple.com/v1/bundleIds
    ?filter[identifier]=org.jesusfilm.forgewatch.ExpoWidgetsTarget
    &include=bundleIdCapabilities
```

Match `attributes.identifier` exactly, because the filter also matches longer
identifiers. No result means the App ID is not registered yet.

## Related

- `docs/operations/daily-bible-pause-preview.md`: the operator guide for the
  `pause-preview` build. Section 1 registers the device, section 4 is the first
  interactive build, and section 9 covers production builds on the shared App ID.
- `docs/solutions/build-errors/eas-managed-react-native-tvos-build-gotchas-20260615.md`:
  the same App ID and the interactive-first-build pattern, for apps/tv.
- `docs/solutions/mobile/eas-update-stakeholder-preview-setup.md`: the earlier
  stakeholder-preview route (Expo Go), which avoided device registration.
- `apps/tv/DISTRIBUTION.md`: where the ASC API key and its IDs are kept on this
  machine.
