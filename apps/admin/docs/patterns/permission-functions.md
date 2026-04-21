# Permission Functions Pattern

Two layers, kept deliberately separate:

## Layer 1: `hasPermission(user, key)` — tier-only gate

- Used by Pothos scope-auth: `authScopes: { hasPermission: 'read:experiences' }`
- Runs BEFORE resolvers execute (no entity loaded yet)
- Resolves a `PermissionKey` against a 4-tier ladder (PUBLIC → VIEWER →
  EDITOR → ADMIN) plus orthogonal SYSTEM workflow tier
- ADMIN is the operational override and satisfies all gates including SYSTEM

## Layer 2: Named ABAC helpers — entity-level gate

- `canEditExperience(user, experience)`, `canPublishExperienceLocale(...)`, etc.
- Called at the top of every service mutation AFTER the entity is loaded
- Encode ownership (`ownerId === user.id`) and state rules (`archivedAt`)
- Accept `Pick<Entity, 'fieldsWeRead'>` so callers can pass partial rows

## Adding a new permission

1. Add the key to `PermissionKey` union in `src/auth/permissions.ts`
2. Add an entry to `permissionMatrix` — TypeScript errors if missing
3. Add a named ABAC helper if the entity has ownership or state rules
4. Add tests in `src/auth/permissions.test.ts` covering every role

## Reference

`src/auth/permissions.ts`, `src/auth/permissions.test.ts`
