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

## Terraform Linting (tflint)

### Run lint

```bash
# Format check (all infra)
terraform fmt -check -recursive infra/

# Validate
cd infra/aws && terraform init -backend=false && terraform validate
cd infra/vercel && terraform init -backend=false && terraform validate

# TFLint
cd infra/aws && tflint --config=../.tflint.hcl --recursive
cd infra/vercel && tflint --config=../.tflint.hcl
```

### Configuration

Config: `infra/.tflint.hcl`

Uses:
- Terraform recommended preset
- AWS ruleset for AWS-specific checks
- Naming convention rules
- Documentation rules

### Install

```bash
# macOS
brew install tflint

# Linux
curl -s https://raw.githubusercontent.com/terraform-linters/tflint/master/install_linux.sh | bash
```

## CI Integration

All lint checks run in CI (`forge-ci` workflow):

| Job | Tool | Mode |
|-----|------|------|
| `build-and-test` | ESLint | `--max-warnings=0` |
| `lint-ios` | SwiftLint | `--strict` |
| `lint-android` | ktlint | `ktlintCheck` |
| `lint-terraform` | tflint + terraform fmt/validate | strict |

CI fails on any lint error or warning.
