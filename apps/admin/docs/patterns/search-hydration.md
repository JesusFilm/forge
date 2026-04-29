# Search Hydration Pattern

Used when raw SQL returns IDs (e.g., pgvector cosine search) and the
response needs full Prisma rows with Pothos field selection.

## Flow

1. **Raw SQL** — `$queryRaw` returns `{ id, distance }` tuples
2. **Hydrate** — `prisma.entity.findMany({ ...query, where: { id: { in: ids }, ...permissionWhere } })`
3. **Reorder** — Map projection to restore search order (Prisma returns arbitrary order)
4. **ABAC re-applied** — permission WHERE at hydration step (defense-in-depth)

## Reference implementation

`src/services/experience.search.ts`

## Key rules

- SET LOCAL + search query must be in the same `$transaction` (SET LOCAL
  has no effect outside a transaction block)
- Always validate the vector input before passing to `toPgVector()`
- The hydration step re-applies ABAC even though the raw SQL also
  filters — catches rows that changed state between the two queries
- Use `ORDER BY distance` (column alias) instead of repeating the
  `<=>` expression to avoid duplicate vector parameter binding
