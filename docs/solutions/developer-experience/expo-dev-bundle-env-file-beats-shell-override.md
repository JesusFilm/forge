---
title: "Expo dev bundle: a .env file value beats a shell EXPO_PUBLIC_* override"
date: 2026-10-19
category: developer-experience
module: apps/mobile
problem_type: developer_experience
component: development_workflow
severity: medium
root_cause: config_error
resolution_type: environment_setup
related_components: [tooling]
applies_when:
  - "A shell EXPO_PUBLIC_* value must override a key that a loaded .env file also sets, in a dev bundle"
  - Pointing the apps/mobile or apps/tv dev client at another Admin, a proxy, or a LAN address
  - A one-off local change to an EXPO_PUBLIC_* value, such as a feature flag
retire_when: "@expo/metro-config stops merging .env file values after process.env in its dev expo/virtual/env module; after an Expo SDK upgrade, check build/transform-worker/transform-worker.js for the `{ ...process.env, ...[...] }` order"
tags:
  [expo, env, dotenv, expo-public, metro, dev-client, admin-endpoint, feat-339]
---

# Expo dev bundle: a .env file value beats a shell `EXPO_PUBLIC_*` override

## Context

On 2026-10-19, the task was to run the `apps/mobile` dev client on the iPhone
17 Pro Max simulator against production Admin.
`apps/mobile/.env.development.local` set
`EXPO_PUBLIC_ADMIN_GRAPHQL_URL=http://localhost:3003/api/graphql`. To leave
that file unchanged, Metro started with shell values:

```bash
EXPO_PUBLIC_ADMIN_GRAPHQL_URL=https://admin.jesusfilm.org/api/graphql \
EXPO_PUBLIC_ALLOW_PRODUCTION_ADMIN=1 \
npx expo start --dev-client --port 8090 --clear
```

Every check on the bundler side said that the override worked:

- `ps eww <metro-pid>` showed both values in the Metro process.
- The CLI's `env: export ...` line did not list
  `EXPO_PUBLIC_ADMIN_GRAPHQL_URL`, because `@expo/env` does not overwrite a key
  that the shell already set. The missing key reads as "the shell won".
- The served bundle's prelude,
  `/* HMR env vars from Expo CLI (dev-only) */ process.env=Object.defineProperties(process.env, {...})`,
  held the production URL and `"1"`. The bundle URL that the dev client loads
  (from the manifest's `launchAsset.url`) held the same prelude.

The app still logged
`[admin-endpoint] admin_endpoint.url=http://localhost:3003/api/graphql admin_endpoint.kind=local`
on each launch. `reportAdminEndpoint` in `apps/mobile/src/lib/adminEndpoint.ts`
prints that line once per JS load.

The cause was in the same bundle: a module named `.env.development.local` with
`var _default = { "EXPO_PUBLIC_ADMIN_GRAPHQL_URL": "http://localhost:3003/api/graphql" }`.
The app reads its env through that module, and the module's value wins.

## Guidance

**To change an `EXPO_PUBLIC_*` value in a dev bundle, change the `.env` file
that sets it, then cold-restart Metro with `--clear`.** For `apps/mobile`, that
file is `apps/mobile/.env.development.local`, the per-machine slot that
`apps/mobile/CLAUDE.md` names ("Admin endpoint resolution (feat-339)"). A shell
variable cannot override a key that a loaded `.env` file also sets.

**Confirm the value at the layer that the app reads.** Read the app's own log,
not the Metro log and not the prelude. For the admin endpoint, read the
`[admin-endpoint] admin_endpoint.url=... admin_endpoint.kind=...` line. In a
grep of the served bundle, look for the `.env` module shape,
`"EXPO_PUBLIC_ADMIN_GRAPHQL_URL": "<value>"`. Do not use the prelude shape,
`"EXPO_PUBLIC_ADMIN_GRAPHQL_URL": { enumerable: true, value: ... }`: it holds
the losing value when a file also sets the key.

**The mechanism, read from the installed packages.** Each path below is
relative to its package's folder under `node_modules`:

1. In a dev bundle, `babel-preset-expo` does not inline
   `process.env.EXPO_PUBLIC_*`. It rewrites each read to `env.<KEY>`, imported
   from `expo/virtual/env` (`babel-preset-expo` 57.0.16,
   `build/plugins/inline-env-vars.js:50-55`).
2. On disk, `expo/virtual/env.js` holds a one-line comment and
   `export const env = process.env` (`expo` 57.0.30). Metro does not serve that file in development. The
   transform worker replaces it with a module that loads the project's `.env`
   files through `require.context` and spreads them after `process.env`
   (`@expo/metro-config` 57.0.13,
   `build/transform-worker/transform-worker.js:144-165`; the generated module,
   reformatted):

   ```js
   export const env = !dotEnvModules.keys().length
     ? process.env
     : {
         ...process.env,
         ...[
           ".env",
           ".env.development",
           ".env.local",
           ".env.development.local",
         ].reduce((acc, file) => {
           return { ...acc, ...(dotEnvModules(file)?.default ?? {}) }
         }, {}),
       }
   ```

3. The `process.env` side holds the shell values, through the prelude. Each
   `.env` file value comes later in the spread, so it wins. Among the files, a
   later name wins: `.env.development.local` beats `.env.local`, which beats
   `.env.development` and `.env`.

The source comment on that block gives the purpose: the module exists so that a
`.env` edit can hot-reload in development, and the prelude carries the
`EXPO_PUBLIC_` values "defined in the script or bash". So a shell-only key
still reaches the app. A shell value loses only to a key that a `.env` file
also sets.

## Why This Matters

**Production works the other way.** In a production bundle (`expo export`,
`eas update`), `babel-preset-expo` inlines `process.env[key]` at transform time
(`inline-env-vars.js:50-52`). `@expo/env` does not overwrite a key that the
shell set (`@expo/env` 2.4.3, `build/index.js:289-296`, in `loadEnvFiles`,
which `@expo/cli` 57.0.31 reaches through `loadProjectEnv` at
`build/src/utils/nodeEnv.js:112`). So in production the
shell value wins. A rule that is true in one mode is false in the other. This
production half comes from the source; this session did not test it. The
repo's `update:*` scripts avoid the question, because they set
`EXPO_NO_DOTENV=1` and name an EAS environment.

**The failure gives no signal.** Every bundler-side check shows the override.
So the usual next steps, such as `--clear`, a second restart, or a check of
the process env, all appear to confirm the wrong theory. In this session the
cost was small: the app stayed on local admin. In the other direction, the
cost is real. If the file points at production (with
`EXPO_PUBLIC_ALLOW_PRODUCTION_ADMIN=1`, which the production switch sets) and
a shell value points at local admin, the session still writes
`RecordWatchSearchEvent` rows and search traces into the production database
(`apps/mobile/CLAUDE.md`, feat-339).

## When to Apply

- Any dev bundle in this repo that reads `EXPO_PUBLIC_*` through
  `process.env`. `apps/mobile` (Expo SDK 57) is where this was seen.
  `apps/tv` (Expo SDK 54) has the same merge in `@expo/metro-config` 54.0.15,
  `build/transform-worker/transform-worker.js:159-163`. That was read from the
  source and not tested on a TV dev client.
- A dev client pointed at another Admin, a fake-admin proxy, or a LAN address.
- A one-off local change to any `EXPO_PUBLIC_*` value that a `.env` file
  already sets.
- Not EAS builds or `update:*` publishes. Those take the EAS environment, and
  the update scripts disable dotenv.

## Examples

**Before.** This has no effect while `.env.development.local` sets the key:

```bash
EXPO_PUBLIC_ADMIN_GRAPHQL_URL=https://admin.jesusfilm.org/api/graphql \
EXPO_PUBLIC_ALLOW_PRODUCTION_ADMIN=1 \
npx expo start --dev-client --port 8090 --clear
# app log: admin_endpoint.kind=local
```

**After.** Back up `apps/mobile/.env.development.local`. The file is
gitignored, so its content differs between checkouts. Comment out the local
line, and add or uncomment the two production lines. The copy on the machine
where this was found already held them as a commented switch.

```bash
# EXPO_PUBLIC_ADMIN_GRAPHQL_URL=http://localhost:3003/api/graphql
EXPO_PUBLIC_ADMIN_GRAPHQL_URL=https://admin.jesusfilm.org/api/graphql
EXPO_PUBLIC_ALLOW_PRODUCTION_ADMIN=1
```

Then run `npx expo start --dev-client --port 8090 --clear` and relaunch the dev
client. The app logged `admin_endpoint.kind=production`.

A file edit lasts longer than a shell variable. Every later session on that
checkout uses production until someone reverts the file, so switch it back
when the work ends. Each worktree has its own gitignored
`.env.development.local`, and worktree copies have held different admin URLs
(session history). `scripts/setup-sim-env.sh` deliberately does not copy the
admin URL into a new worktree (`apps/mobile/CLAUDE.md`, "Running on a
simulator").

**Check the bundle without a launch.** Read the bundle URL that the dev client
loads from the manifest, then grep that bundle for the `.env` module shape:

```bash
URL=$(curl -s -H 'expo-platform: ios' -H 'accept: application/expo+json,application/json' \
  http://localhost:8090 | grep -oE '"launchAsset":\{[^}]*"url":"[^"]+"' | grep -oE 'http[^"]+' | head -1)
curl -s "$URL" | grep -oE '"EXPO_PUBLIC_ADMIN_GRAPHQL_URL": "[^"]*"'
```

## Related

- `docs/solutions/mobile/expo-env-file-handling.md`: the env file priority
  order and the per-machine slot. Its "Shell Env Vars vs Metro" section says
  that a shell export does not reach Metro. That is not the mechanism in SDK
  57; see the Guidance above.
- `docs/solutions/developer-experience/physical-android-dev-build-local-admin-emulator-alias.md`:
  the same `.env.development.local` switch, the `--clear` restart, and the
  `admin_endpoint` log line, for a physical Android phone.
- `docs/solutions/developer-experience/expo-dev-client-cached-bundle-verification.md`:
  how to grep a served dev bundle. Such a bundle holds two env sources, and
  only the `.env` module value is the one the app reads.
- `docs/solutions/runtime-errors/metro-env-inlining-eas-update-white-screen-20260410.md`:
  env inlining in production bundles.
