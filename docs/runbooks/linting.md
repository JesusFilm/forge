# Linting

Code style and quality enforcement across the Forge repository.

## JS/TS Linting (ESLint)

### Run lint

```bash
# All workspaces
pnpm lint

# Specific workspace
pnpm --filter @forge/web lint
pnpm --filter @forge/cms lint
pnpm --filter @forge/ai-orchestrator lint

# Strict mode (fail on warnings)
pnpm lint -- --max-warnings=0
```

### Configuration

Root config: `eslint.config.mjs` (ESLint flat config)

**Excluded paths:**
- `packages/clients/**` - generated clients (per AGENTS.md)
- `**/dist/**`, `**/.next/**`, `**/build/**` - build outputs
- `mobile/**` - separate lint tools (SwiftLint, ktlint)
- `infra/**` - Terraform (not JS/TS)

**Base rules:**
- TypeScript recommended rules
- Unused vars (allows `_` prefix)
- No undefined variables
- Async safety checks

## iOS Linting (SwiftLint)

### Run lint

```bash
cd mobile/ios
swiftlint

# Strict mode
swiftlint --strict
```

### Configuration

Config: `mobile/ios/.swiftlint.yml`

**Excluded paths:**
- `packages/clients/swift-ios` - generated Swift client

### Install (macOS)

```bash
brew install swiftlint
```

## Android Linting (ktlint)

### Run lint

```bash
cd mobile/android
./gradlew ktlintCheck

# Auto-format
./gradlew ktlintFormat
```

### Configuration

Plugin: `org.jlleitschuh.gradle.ktlint` in `build.gradle.kts`

**Excluded paths:**
- `packages/clients/kotlin-android` - generated Kotlin client

## CI Integration

All lint checks run in CI (`forge-ci` workflow):

| Job | Tool | Mode |
|-----|------|------|
| `build-and-test` | ESLint | `--max-warnings=0` |
| `lint-ios` | SwiftLint | `--strict` |
| `lint-android` | ktlint | `ktlintCheck` |

CI fails on any lint error or warning.
