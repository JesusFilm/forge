# Add a New Entity — Step-by-Step Playbook

This guide walks through adding a new content type to the admin app.
Follow Experience as the reference implementation. Every step cites an
exact file. If any step requires guesswork, that is a bug in this guide.

## Prerequisites

- The entity's data model is designed (fields, relations, enums)
- You know its classification: `abac-gated` (ownership/state-based
  access) or `public-shape` (tier-only auth, no ownership)

## Steps

### 1. Prisma Schema

**File:** `prisma/schema.prisma`

Add the model with `@@map("snake_case_table")`. Core-sourced entities
need `coreId String @unique`, `source SourceTier`, `syncedAt DateTime?`,
`deletedAt DateTime?`. Add `///` doc comments on non-obvious fields.

Reference: `model Experience` (line ~745), `model Video` (line ~270).

Run `npx prisma migrate dev --name <description>` to generate the
migration.

### 2. Prisma Client Regeneration

```bash
npx prisma generate
```

This also regenerates Pothos types (via `generator pothos`).

### 3. Pothos Type

**File:** `src/graphql/types/<entity>.ts`

- Add `/** @classification abac-gated */` or `/** @classification
public-shape */` JSDoc before `builder.prismaObject(...)`.
- Explicit field list — never spread the full Prisma row. Omit
  `embedding` and any internal-only columns.
- If abac-gated and the type has nested relations, add a `query`
  callback that applies ABAC filtering (see `Experience.locales` in
  `src/graphql/types/experience.ts`).
- Register the type via side-effect import in `src/graphql/schema.ts`.
  Order matters: import after `reference.ts`.

Reference: `src/graphql/types/experience.ts`.

### 4. Zod Input Schemas

**File:** `src/services/<entity>.schemas.ts`

One schema per mutation operation (Create, Update, Publish, Archive).
Use `.strict()` for complex JSON fields. Reference Experience:
`src/services/experience.schemas.ts`.

### 5. Service

**File:** `src/services/<entity>.service.ts`

Each method follows: (1) Zod parse, (2) ABAC check, (3) Prisma call.

- Import ABAC helpers from `src/auth/permissions.ts`
- Import `ForbiddenError` / `NotFoundError` from `src/services/errors.ts`
- Read methods: tier check via `hasPermission()` + role-based WHERE
- Mutation methods: named ABAC check (`canEdit*`, `canPublish*`, etc.)
  after loading the entity

Reference: `src/services/experience.service.ts`.

### 6. Permission Keys + ABAC Helpers

**File:** `src/auth/permissions.ts`

- Add new `PermissionKey` entries (e.g., `read:<entities>`,
  `write:<entities>`). TypeScript will error until the `permissionMatrix`
  has an entry for each key.
- Add named ABAC helpers (`canEdit<Entity>`, `canView<Entity>`, etc.)
  following the Pick<Entity, 'fields'> convention.

Reference: existing helpers in `src/auth/permissions.ts`.

### 7. Query Resolvers

**File:** `src/graphql/types/<entity>.ts` (in the queryFields block)

Delegate to the service. Use `authScopes: { hasPermission: 'read:...' }`
for tier gating. The service applies ABAC.

### 8. Mutation Resolvers

**File:** `src/graphql/mutations/<entity>.ts`

- Create the file with `builder.mutationFields(...)`.
- Register via side-effect import in `src/graphql/schema.ts`.
- Each mutation delegates to the service. Resolvers are thin wiring.

Reference: `src/graphql/mutations/experience.ts`.

### 9. Classification Test Update

**File:** `src/graphql/classification.test.ts`

- If the new type has `t.relation(...)` calls, add entries to the
  `RELATION_TARGETS` registry so the test can verify cross-classification
  safety.

### 10. Tests

- **Service test:** `src/services/<entity>.service.test.ts` — cover the
  full ABAC matrix (ADMIN/EDITOR ownership/VIEWER/PUBLIC/SYSTEM).
- **Schema test:** verify new fields appear in `src/graphql/schema.test.ts`
  snapshot.
- **Security test:** `src/graphql/schema.security.test.ts` auto-scans
  new fields for embedding leaks — no manual update needed.

### 11. CLAUDE.md Update

Add a section to `apps/admin/CLAUDE.md` documenting the entity's key
decisions (like the Unit 4 data model highlights for Experience/Video).

## Verification Checklist

- [ ] Prisma migration applies cleanly
- [ ] `@classification` JSDoc tag present on every Pothos type
- [ ] No `embedding`/`vector`/`similarity` field name in schema
      (security test catches this)
- [ ] Service method calls ABAC helper before every mutation
- [ ] Tests cover ADMIN, EDITOR (own + other's), VIEWER, PUBLIC, SYSTEM
- [ ] `typecheck`, `test`, `lint`, `build` all pass
