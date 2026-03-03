# Android Agent Guide

Scope: `mobile/android`.

## Rules

- Kotlin + Compose only.
- Keep platform-specific code isolated.
- Operations are NOT shared with iOS — each platform owns its `.graphql` files.

## Before every task

1. **Fetch and rebase** — `git fetch origin && git rebase origin/main`.
   The CMS schema (`apps/cms/schema.graphql`) changes frequently because it is
   shared across web, Android, and iOS. Always start from the latest `main`.
2. **Run the build** — `cd mobile/android && ./gradlew assembleDebug`.
   This triggers Apollo codegen. If `compileDebugKotlin` fails, the generated
   types have changed and Kotlin source files need updating.
3. **Create your feature branch** only after the build passes on latest `main`.

## Git setup in containers

If `ssh` is not available but `gh` CLI is authenticated:

```bash
gh auth setup-git
git config --global url."https://github.com/".insteadOf "git@github.com:"
```

## GraphQL / Apollo 4

- Schema source: `apps/cms/schema.graphql` (read directly, not copied).
- Generated package: `com.forge.mobile.graphql`.
- Apollo 4 uses **composition, not inheritance** for inline fragments.
  Access fragment fields via nullable properties on the wrapper:

  ```kotlin
  // Correct
  section?.onComponentSectionsCta?.heading

  // Wrong — no such subtype exists
  section is ExperienceBySlugQuery.ComponentSectionsCtaSections
  ```

- When the schema adds/removes/renames fields or changes nullability, update
  Kotlin call sites to match the regenerated types in
  `app/build/generated/source/apollo/forge/com/forge/mobile/graphql/`.

## Configuration

`GRAPHQL_ENDPOINT` and `GRAPHQL_TOKEN` resolve via:
`local.properties` → env var (`STRAPI_GRAPHQL_ENDPOINT` / `STRAPI_GRAPHQL_TOKEN`) → default.

Never hardcode tokens in tracked files. See `local.properties.example`.

## Common pitfalls

| Issue                                     | Fix                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `~/.gradle` owned by root                 | `export GRADLE_USER_HOME=/tmp/.gradle` or fix ownership                               |
| `~/.config` owned by root                 | `export XDG_CONFIG_HOME=/tmp/.config`                                                 |
| Port 1337 already in use                  | `lsof -ti:1337 \| xargs kill` then retry                                              |
| `gradle.properties` missing               | Must contain `android.useAndroidX=true` at minimum                                    |
| Apollo types mismatch after schema change | Read generated types in `app/build/generated/source/apollo/` and update Kotlin source |
